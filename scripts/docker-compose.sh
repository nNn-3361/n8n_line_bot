#!/usr/bin/env bash
set -euo pipefail

if command -v docker >/dev/null 2>&1; then
  docker_bin="$(command -v docker)"
elif [[ -x /Applications/Docker.app/Contents/Resources/bin/docker ]]; then
  docker_bin=/Applications/Docker.app/Contents/Resources/bin/docker
else
  echo "Docker CLI was not found. Start or install Docker Desktop first." >&2
  exit 1
fi

exec "$docker_bin" compose "$@"
