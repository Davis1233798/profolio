#!/usr/bin/env bash
# Executed on the existing OCI host. The archive has already been uploaded by CI.
set -Eeuo pipefail
sha=${1:?commit SHA required}
expected=${2:?archive checksum required}
[[ $sha =~ ^[0-9a-f]{40}$ && $expected =~ ^[0-9a-f]{64}$ ]] || exit 2
root=/srv/business-suite
archive="$root/releases/$sha.tgz"
release="$root/releases/${sha}-$(date -u +%Y%m%d%H%M%S)"
previous=$(readlink -f "$root/current")
exec 9>"$root/shared/deploy.lock"
flock -n 9 || { echo 'Another deployment is running'; exit 1; }
printf '%s  %s\n' "$expected" "$archive" | sha256sum -c -
mkdir "$release"
tar -xzf "$archive" -C "$release"
ln -s "$root/shared/infra.env" "$release/infra/.env"
printf 'SUITE_RELEASE_SHA=%s\n' "$sha" > "$release/infra/.revision.env"
chmod 600 "$release/infra/.revision.env"
printf '%s\n' "$sha" > "$release/COMMIT"
compose() {
  local dir=$1; shift
  local env_args=(--env-file .env)
  if [[ -f "$dir/infra/.revision.env" ]]; then env_args+=(--env-file .revision.env); fi
  (cd "$dir/infra" && sudo -n docker compose --project-name business-suite "${env_args[@]}" \
    -f compose.yaml -f linux/compose.web.yaml -f linux/compose.public-sites.yaml \
    -f linux/compose.stations.yaml "$@")
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
  exit "$status"
}
trap rollback ERR
compose "$release" up -d --no-build --no-deps --wait --wait-timeout 180 "${services[@]}"
compose "$release" up -d --no-build --no-deps --force-recreate --wait --wait-timeout 180 edge
curl --fail --silent --show-error --retry 5 --retry-delay 2 https://blockchen.duckdns.org/ -o /dev/null
curl --fail --silent --show-error --retry 5 --retry-delay 2 https://station.blockchen.duckdns.org/api/health | python3 "$release/scripts/check-station-revision.py" "$sha"
ln -sfn "$release" "$root/current"
trap - ERR
printf 'Deployed commit %s to %s\n' "$sha" "$release"
