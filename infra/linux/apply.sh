#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
if [[ ! -f .env ]]; then
  echo 'Missing infra/.env; copy .env.example and configure service secrets on this host.' >&2
  exit 1
fi
# Serialize manual Compose operations with release deploys and public route changes.
server_root=/srv/business-suite
if [[ -d "$server_root/shared" && ! -L "$server_root/shared" ]]; then
  lock_file="$server_root/shared/deploy.lock"
else
  lock_file="${TMPDIR:-/tmp}/business-suite-infra-${UID:-0}.lock"
fi
exec 9>"$lock_file"
flock -n 9 || { echo 'Another release or infrastructure operation is running; apply was not started.' >&2; exit 1; }
chmod 600 .env
export COMPOSE_PROJECT_NAME=business-suite
route_mode=$(python3 linux/mes_public_route.py get .env)
export MES_PUBLIC_UPSTREAM
MES_PUBLIC_UPSTREAM=$(python3 linux/mes_public_route.py config "$route_mode" | python3 -c 'import json,sys; print(json.load(sys.stdin)["upstream"])')
args=(--project-name business-suite --env-file .env -f compose.yaml)
for option in "$@"; do
  case "$option" in
    --https) args+=(-f linux/compose.https.yaml);;
    --web) args+=(-f linux/compose.web.yaml);;
    --public-web) args+=(-f linux/compose.web.yaml -f linux/compose.public-web.yaml);;
    --public-sites)
      args+=(-f linux/compose.web.yaml -f linux/compose.public-sites.yaml)
      if [[ "$route_mode" == isolated ]]; then
        network=business-suite-mes_default
        network_project=$(docker network inspect --format '{{ index .Labels "com.docker.compose.project" }}' "$network" 2>/dev/null || true)
        network_kind=$(docker network inspect --format '{{ index .Labels "com.docker.compose.network" }}' "$network" 2>/dev/null || true)
        [[ "$network_project" == business-suite-mes && "$network_kind" == default ]] || { echo 'Isolated MES Docker network is missing or not owned by business-suite-mes.' >&2; exit 1; }
        mapfile -t mes_containers < <(docker ps -aq --filter label=com.docker.compose.project=business-suite-mes --filter label=com.docker.compose.service=mes-station)
        [[ ${#mes_containers[@]} -eq 1 ]] || { echo 'Expected exactly one container for the isolated mes-station service.' >&2; exit 1; }
        mes_state=$(docker inspect --format '{{.State.Status}}' "${mes_containers[0]}")
        mes_health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}not_configured{{end}}' "${mes_containers[0]}")
        [[ "$mes_state" == running && "$mes_health" == healthy ]] || { echo 'Isolated mes-station must be running and healthy before enabling its public route.' >&2; exit 1; }
        curl --fail --silent --show-error --max-time 5 http://127.0.0.1:18095/api/health | python3 linux/mes_public_route.py check-health >/dev/null
        args+=(-f linux/compose.mes-public-route.yaml)
      elif [[ "$route_mode" == rootless ]]; then
        sudo -n python3 linux/mes_public_route.py check-unix-health >/dev/null
        args+=(-f linux/compose.mes-rootless-route.yaml)
      fi
      ;;
    *) echo 'Usage: bash linux/apply.sh [--https | --web | --public-web | --public-sites]' >&2; exit 1;;
  esac
done
docker compose "${args[@]}" config --quiet
docker compose "${args[@]}" pull --ignore-buildable
docker compose "${args[@]}" up -d --build --wait --wait-timeout 180
python3 tests/smoke.py
docker compose "${args[@]}" ps --format '{{.Service}} {{.State}}'
