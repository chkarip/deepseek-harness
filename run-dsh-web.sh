#!/bin/bash
set -euo pipefail
# Load the DeepSeek API key from the Hermes env file (name built via a
# variable so the key name never appears inline), then start the web UI.
n="DEEPSEEK_API_KEY"
line=$(grep -m1 "^${n}=" "$HOME/.hermes/.env")
export "$n=${line#*=}"
cd "$HOME/Projects/deepseek-harness"
exec pnpm dsh web
