#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
TSX_BIN="$REPO_DIR/node_modules/.bin/tsx"

if [[ ! -x "$TSX_BIN" ]]; then
  echo "tsx is not installed. Run npm install first." >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/validate-media.sh <validation-request.json> [--write-descriptor]" >&2
  exit 2
fi

exec "$TSX_BIN" "$REPO_DIR/pipeline/validation/MediaValidator.ts" "$@"
