#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT_DIR/scripts/public-deploy.sh" stop
"$ROOT_DIR/scripts/debug-deploy.sh" start
