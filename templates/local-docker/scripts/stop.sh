#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose down -v
rm -f .nomad-token .bootstrap.json
echo "cluster stopped, volumes removed"
