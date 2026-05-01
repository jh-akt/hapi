#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Standby/debug hub instance.
# Keep it isolated from the main deploy home and launchd label so we can
# start or stop it independently when the primary public hub needs backup.
export HAPI_DEPLOY_HOME="${HAPI_DEPLOY_HOME:-$HOME/.hapi-deploy/debug}"
export HAPI_LAUNCHD_LABEL="${HAPI_LAUNCHD_LABEL:-com.hapi.hub.debug}"
export HAPI_PUBLIC_URL="${HAPI_PUBLIC_URL:-https://hapi-debug.example.com}"
export HAPI_LISTEN_HOST="${HAPI_LISTEN_HOST:-127.0.0.1}"
export HAPI_LISTEN_PORT="${HAPI_LISTEN_PORT:-3007}"

exec "$ROOT_DIR/scripts/public-deploy.sh" "$@"
