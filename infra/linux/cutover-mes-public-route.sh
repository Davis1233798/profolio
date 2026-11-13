#!/usr/bin/env bash
set -Eeuo pipefail

target=${1:?usage: cutover-mes-public-route.sh <shared|isolated>}
[[ "$target" == shared || "$target" == isolated || "$target" == rootless ]] || { echo 'Route must be shared, isolated or rootless' >&2; exit 2; }

root=/srv/business-suite
[[ -d "$root/shared" && ! -L "$root/shared" ]] || { echo 'Shared release state directory is missing or unsafe' >&2; exit 1; }
exec 9>"$root/shared/deploy.lock"
flock -n 9 || { echo 'Another release or infrastructure operation is running; route cutover was not started.' >&2; exit 1; }

current="$root/current"
release=$(realpath -e -- "$current")
[[ "$release" == "$root/releases/"* && -d "$release/infra" ]] || { echo 'Current release is outside the managed release root' >&2; exit 1; }
env_file="$release/infra/.env"
route_tool="$release/infra/linux/mes_public_route.py"
[[ -f "$env_file" && -f "$route_tool" ]] || { echo 'Current release is missing shared environment or route tooling' >&2; exit 1; }

old_mode=$(python3 "$route_tool" get "$env_file")
route_config() { python3 "$route_tool" config "$1"; }
route_upstream() { route_config "$1" | python3 -c 'import json,sys; print(json.load(sys.stdin)["upstream"])'; }
route_overlay() { route_config "$1" | python3 -c 'import json,sys; print(json.load(sys.stdin)["overlay"] or "")'; }

compose() {
  local mode=$1
  shift
  local upstream overlay
  upstream=$(route_upstream "$mode")
  overlay=$(route_overlay "$mode")
  local files=(-f compose.yaml -f linux/compose.web.yaml -f linux/compose.public-sites.yaml -f linux/compose.stations.yaml)
  if [[ -n "$overlay" ]]; then files+=(-f "$overlay"); fi
  local erp_mode
  erp_mode=$(python3 "$release/infra/linux/erp_public_route.py" "$env_file") || return
  if [[ "$erp_mode" == rootless ]]; then files+=(-f linux/compose.erp-rootless-route.yaml); fi
  (cd "$release/infra" && MES_PUBLIC_UPSTREAM="$upstream" docker compose --project-name business-suite --env-file "$env_file" "${files[@]}" "$@")
}

verify_isolated_service() {
  local network=business-suite-mes_default network_project network_kind
  network_project=$(docker network inspect --format '{{ index .Labels "com.docker.compose.project" }}' "$network" 2>/dev/null || true)
  network_kind=$(docker network inspect --format '{{ index .Labels "com.docker.compose.network" }}' "$network" 2>/dev/null || true)
  [[ "$network_project" == business-suite-mes && "$network_kind" == default ]] || { echo 'MES network is missing or is not the business-suite-mes default network' >&2; return 1; }

  mapfile -t containers < <(docker ps -aq --filter label=com.docker.compose.project=business-suite-mes --filter label=com.docker.compose.service=mes-station)
  [[ ${#containers[@]} -eq 1 ]] || { echo 'Expected exactly one container for the isolated mes-station service' >&2; return 1; }
  local state health
  state=$(docker inspect --format '{{.State.Status}}' "${containers[0]}")
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}not_configured{{end}}' "${containers[0]}")
  [[ "$state" == running && "$health" == healthy ]] || { echo 'Isolated mes-station must be running and healthy before route cutover' >&2; return 1; }

  curl --fail --silent --show-error --max-time 5 http://127.0.0.1:18095/api/health | python3 "$route_tool" check-health >/dev/null
  docker run --rm --network "$network" --entrypoint /bin/sh caddy:2.10-alpine -ec 'wget -q -O - -T 4 http://mes-station:8095/api/health' | python3 "$route_tool" check-health >/dev/null
}

verify_rootless_service() {
  sudo -n python3 "$route_tool" check-unix-health >/dev/null
}

verify_current_edge() {
  mapfile -t edges < <(docker ps -aq --filter label=com.docker.compose.project=business-suite --filter label=com.docker.compose.service=edge)
  [[ ${#edges[@]} -eq 1 ]] || { echo 'Expected exactly one existing central Caddy edge container; refusing to create or replace ingress.' >&2; return 1; }
  [[ "$(docker inspect --format '{{.State.Status}}' "${edges[0]}")" == running ]] || { echo 'Existing central Caddy edge is not running.' >&2; return 1; }
  local expected count
  expected="MES_PUBLIC_UPSTREAM=$(route_upstream "$old_mode")"
  count=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${edges[0]}" | grep -Fxc "$expected" || true)
  [[ "$count" == 1 ]] || { echo 'Running Caddy upstream does not match the persisted MES_PUBLIC_ROUTE; refusing route mutation.' >&2; return 1; }
}

public_health() {
  local mode=$1 url body base_domain
  base_domain=$(compose "$mode" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["edge"]["environment"]["BASE_DOMAIN"])')
  [[ "$base_domain" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && "$base_domain" != *..* ]] || { echo 'BASE_DOMAIN must be a plain DNS hostname' >&2; return 1; }
  url="https://mes.${base_domain}/api/health"
  body=$(curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 2 --max-time 10 "$url") || return 1
  if [[ "$mode" == isolated || "$mode" == rootless ]]; then
    printf '%s' "$body" | python3 "$route_tool" check-health >/dev/null
  else
    printf '%s' "$body" | python3 -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("success") is True else 1)'
  fi
}

verify_current_edge
if [[ "$old_mode" == "$target" ]]; then
  echo "MES public route already uses $target; no change made."
  exit 0
fi
if [[ "$target" == isolated ]]; then verify_isolated_service; fi
if [[ "$target" == rootless ]]; then verify_rootless_service; fi

route_changed=0
rollback() {
  local status=$?
  trap - ERR
  if ((route_changed == 0)); then exit "$status"; fi
  echo "MES public route change failed ($status); restoring $old_mode route" >&2
  local failed=0
  if ! python3 "$route_tool" set "$env_file" "$old_mode" >/dev/null; then
    echo 'Failed to restore MES_PUBLIC_ROUTE in shared environment' >&2
    exit 70
  fi
  if ! compose "$old_mode" config --quiet || \
     ! compose "$old_mode" run --rm --no-deps --entrypoint caddy edge validate --config /etc/caddy/Caddyfile --adapter caddyfile || \
     ! compose "$old_mode" up -d --no-deps --force-recreate --wait --wait-timeout 180 edge; then
    failed=1
  elif ! public_health "$old_mode"; then
    failed=1
  fi
  if ((failed)); then
    echo 'CRITICAL: route mode was restored, but the prior public route did not pass health validation; operator intervention is required.' >&2
    exit 70
  fi
  echo 'Prior route restored and its public health check passed.' >&2
  exit "$status"
}
trap rollback ERR

python3 "$route_tool" set "$env_file" "$target" >/dev/null
route_changed=1
compose "$target" config --quiet
compose "$target" run --rm --no-deps --entrypoint caddy edge validate --config /etc/caddy/Caddyfile --adapter caddyfile
compose "$target" up -d --no-deps --force-recreate --wait --wait-timeout 180 edge
public_health "$target"
trap - ERR
printf 'MES public route switched from %s to %s and passed HTTPS health validation.\n' "$old_mode" "$target"
