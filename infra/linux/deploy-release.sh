#!/usr/bin/env bash
# Executed on the existing OCI host. The archive has already been uploaded by CI.
set -Eeuo pipefail
sha=${1:?commit SHA required}
expected=${2:?archive checksum required}
[[ $sha =~ ^[0-9a-f]{40}$ && $expected =~ ^[0-9a-f]{64}$ ]] || exit 2
root=/srv/business-suite
archive="$root/releases/$sha.tgz"
release="$root/releases/${sha}-$(date -u +%Y%m%d%H%M%S)"
exec 9>"$root/shared/deploy.lock"
flock -n 9 || { echo 'Another deployment is running'; exit 1; }
previous=$(readlink -f "$root/current")
printf '%s  %s\n' "$expected" "$archive" | sha256sum -c -
mkdir "$release"
tar -xzf "$archive" -C "$release"
ln -s "$root/shared/infra.env" "$release/infra/.env"
printf 'SUITE_RELEASE_SHA=%s\n' "$sha" > "$release/infra/.revision.env"
chmod 600 "$release/infra/.revision.env"
printf '%s\n' "$sha" > "$release/COMMIT"
route_tool="$release/infra/linux/mes_public_route.py"
route_mode=$(python3 "$route_tool" get "$release/infra/.env")
route_config() { python3 "$route_tool" config "$1"; }
route_upstream() { route_config "$1" | python3 -c 'import json,sys; print(json.load(sys.stdin)["upstream"])'; }
route_overlay() { route_config "$1" | python3 -c 'import json,sys; print(json.load(sys.stdin)["overlay"] or "")'; }
if [[ "$route_mode" == isolated ]]; then
  network=business-suite-mes_default
  network_project=$(sudo -n docker network inspect --format '{{ index .Labels "com.docker.compose.project" }}' "$network" 2>/dev/null || true)
  network_kind=$(sudo -n docker network inspect --format '{{ index .Labels "com.docker.compose.network" }}' "$network" 2>/dev/null || true)
  [[ "$network_project" == business-suite-mes && "$network_kind" == default ]] || { echo 'Isolated MES network is missing or not owned by business-suite-mes' >&2; exit 1; }
  mapfile -t mes_containers < <(sudo -n docker ps -aq --filter label=com.docker.compose.project=business-suite-mes --filter label=com.docker.compose.service=mes-station)
  [[ ${#mes_containers[@]} -eq 1 ]] || { echo 'Expected one container for the isolated mes-station service' >&2; exit 1; }
  mes_state=$(sudo -n docker inspect --format '{{.State.Status}}' "${mes_containers[0]}")
  mes_health=$(sudo -n docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}not_configured{{end}}' "${mes_containers[0]}")
  [[ "$mes_state" == running && "$mes_health" == healthy ]] || { echo 'Isolated mes-station must be running and healthy before deploying the isolated public route' >&2; exit 1; }
  curl --fail --silent --show-error --max-time 5 http://127.0.0.1:18095/api/health | python3 "$route_tool" check-health >/dev/null
elif [[ "$route_mode" == rootless ]]; then
  sudo -n python3 "$route_tool" check-unix-health >/dev/null
fi
compose() {
  local dir=$1; shift
  local env_args=(--env-file .env)
  if [[ -f "$dir/infra/.revision.env" ]]; then env_args+=(--env-file .revision.env); fi
  local upstream overlay
  upstream=$(route_upstream "$route_mode")
  overlay=$(route_overlay "$route_mode")
  local files=(-f compose.yaml -f linux/compose.web.yaml -f linux/compose.public-sites.yaml -f linux/compose.stations.yaml)
  if [[ -n "$overlay" ]]; then files+=(-f "$overlay"); fi
  (cd "$dir/infra" && sudo -n env MES_PUBLIC_UPSTREAM="$upstream" docker compose --project-name business-suite "${env_args[@]}" \
    "${files[@]}" "$@")
}
services=(station web web-mes web-erp web-pos web-crm web-dining web-shop)
# Keep references to the running images: compose builds reuse mutable image names.
for service in "${services[@]}"; do
  id=$(sudo -n docker inspect --format '{{.Image}}' "business-suite-${service}-1")
  sudo -n docker image tag "$id" "business-suite-rollback-${service}:${sha}"
done
compose "$release" config --quiet
compose "$release" build "${services[@]}"
# Snapshot the station database using the newly built binary against the existing
# volume. VACUUM INTO creates a consistent snapshot even while the service runs.
station_backup="/srv/station/data/backup-before-$(basename "$release").sqlite"
compose "$release" run --rm --no-deps station /srv/station/station-server --backup "$station_backup" < /dev/null
# Take a consistent SQLite snapshot in the existing volume before replacing services.
backup="/srv/app/.data/backup-before-$(basename "$release").sqlite"
sudo -n docker exec business-suite-web-1 node --input-type=commonjs -e \
  'const {DatabaseSync}=require("node:sqlite"); const db=new DatabaseSync("/srv/app/.data/portfolio.sqlite"); db.prepare("VACUUM INTO ?").run(process.argv[1]); db.close();' "$backup" < /dev/null
rollback() {
  local status=$?
  trap - ERR
  echo "Deployment failed ($status); restoring previous application images and configuration" >&2
  for service in "${services[@]}"; do
    sudo -n docker image tag "business-suite-rollback-${service}:${sha}" "business-suite-${service}:latest" || true
  done
  compose "$previous" up -d --no-build --no-deps --wait --wait-timeout 180 "${services[@]}" || true
  compose "$previous" up -d --no-build --no-deps --force-recreate --wait --wait-timeout 180 edge || true
  if [[ "$route_mode" == isolated ]]; then
    local base_domain
    base_domain=$(compose "$previous" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["edge"]["environment"]["BASE_DOMAIN"])')
    curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 2 --max-time 10 "https://mes.${base_domain}/api/health" | python3 "$route_tool" check-health >/dev/null || echo 'CRITICAL: isolated MES public route did not pass health after release rollback' >&2
  fi
  exit "$status"
}
trap rollback ERR
compose "$release" up -d --no-build --no-deps --wait --wait-timeout 180 "${services[@]}"
compose "$release" up -d --no-build --no-deps --force-recreate --wait --wait-timeout 180 edge
curl --fail --silent --show-error --retry 5 --retry-delay 2 https://blockchen.duckdns.org/ -o /dev/null
curl --fail --silent --show-error --retry 5 --retry-delay 2 https://station.blockchen.duckdns.org/api/health | python3 "$release/scripts/check-station-revision.py" "$sha"
base_domain=$(compose "$release" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["edge"]["environment"]["BASE_DOMAIN"])')
mes_health_url="https://mes.${base_domain}/api/health"
if [[ "$route_mode" == isolated ]]; then
  curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 2 --max-time 10 "$mes_health_url" | python3 "$route_tool" check-health >/dev/null
else
  curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 2 --max-time 10 "$mes_health_url" | python3 -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("success") is True else 1)'
fi
ln -sfn "$release" "$root/current"
trap - ERR
printf 'Deployed commit %s to %s\n' "$sha" "$release"
