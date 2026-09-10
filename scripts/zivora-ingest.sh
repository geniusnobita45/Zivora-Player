#!/usr/bin/env bash
set -euo pipefail
ZIVORA_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ZIVORA_REPO_DIR="$(cd -- "$ZIVORA_SCRIPT_DIR/.." && pwd)"
if [[ ! -x "$ZIVORA_REPO_DIR/node_modules/.bin/tsx" ]]; then
  echo "Install repository dependencies before ingesting media." >&2
  exit 1
fi
cd -- "$ZIVORA_REPO_DIR"
exec node --import tsx "$ZIVORA_REPO_DIR/scripts/zivora-ingest.ts" "$@"
