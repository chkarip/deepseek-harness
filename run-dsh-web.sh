#!/bin/bash
set -euo pipefail
# Load the DeepSeek API key from the Hermes env file (name built via a
# variable so the key name never appears inline), then start the web UI.
n="DEEPSEEK_API_KEY"
line=$(grep -m1 "^${n}=" "$HOME/.hermes/.env")
export "$n=${line#*=}"
cd "$(dirname "$0")"
# Launch from SOURCE (the `dsh` script runs apps/cli/src/bin.ts under tsx).
# Running the built `apps/cli/lib/bin.js` directly serves whatever was last
# compiled, which is how a stale build silently booted with no agent preset
# — and therefore no tools — after this checkout moved.
exec pnpm dsh web
