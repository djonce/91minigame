#!/usr/bin/env bash
set -euo pipefail

release_id="${1:?Usage: activate.sh RELEASE_ID}"
[[ "$release_id" =~ ^[0-9]{8}-[0-9]{6}$ ]] || { echo 'Invalid release ID' >&2; exit 1; }
deployment_root=/opt/minigames
export RELEASE_ID="$release_id"
export RELEASE_DIR="$deployment_root/releases/$release_id"
export DATA_DIR="$deployment_root/data"
compose_file="$RELEASE_DIR/deploy/compose.yaml"
test -f "$compose_file"
test -f "$DATA_DIR/games.json"
previous_release=''
if [[ -f "$deployment_root/current-release" ]]; then previous_release="$(cat "$deployment_root/current-release")"; fi

docker compose -p minigames -f "$compose_file" build
if ! docker compose -p minigames -f "$compose_file" up -d --no-build --wait --wait-timeout 90; then
  echo 'Deployment health check failed; restoring previous release.' >&2
  docker compose -p minigames -f "$compose_file" logs --tail=60
  if [[ "$previous_release" =~ ^[0-9]{8}-[0-9]{6}$ ]]; then
    export RELEASE_ID="$previous_release"
    export RELEASE_DIR="$deployment_root/releases/$previous_release"
    docker compose -p minigames -f "$RELEASE_DIR/deploy/compose.yaml" up -d --no-build --wait --wait-timeout 90
  else
    docker compose -p minigames -f "$compose_file" down
  fi
  exit 1
fi
printf '%s\n' "$release_id" > "$deployment_root/current-release"
ln -sfn "releases/$release_id" "$deployment_root/current"
curl --fail --silent --show-error http://127.0.0.1:5178/api/health
printf '\nActive release: %s\n' "$release_id"
