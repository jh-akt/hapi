#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_HOME="${HAPI_DEPLOY_HOME:-$HOME/.hapi-deploy/public}"
ENV_FILE="$DEPLOY_HOME/hub.env"
PID_FILE="$DEPLOY_HOME/hub.pid"
LOG_DIR="$DEPLOY_HOME/logs"
LOG_FILE="$LOG_DIR/hub.log"
DATA_DIR="$DEPLOY_HOME/hapi-home"
LAUNCHD_LABEL="${HAPI_LAUNCHD_LABEL:-com.hapi.hub.public}"

# GUI apps, launchd jobs, and non-interactive shells often skip shell rc files.
# Bootstrap Bun from its default install location so the deploy script is self-contained.
BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
if [[ -x "$BUN_INSTALL/bin/bun" ]]; then
    export PATH="$BUN_INSTALL/bin:$PATH"
fi

DEFAULT_PUBLIC_URL="${HAPI_PUBLIC_URL:-https://hapi.example.com}"
DEFAULT_LISTEN_HOST="${HAPI_LISTEN_HOST:-127.0.0.1}"
DEFAULT_LISTEN_PORT="${HAPI_LISTEN_PORT:-3006}"

usage() {
    cat <<'EOF'
Usage:
  ./scripts/public-deploy.sh init [public-url]
  ./scripts/public-deploy.sh build
  ./scripts/public-deploy.sh start
  ./scripts/public-deploy.sh stop
  ./scripts/public-deploy.sh restart
  ./scripts/public-deploy.sh status
  ./scripts/public-deploy.sh logs
  ./scripts/public-deploy.sh print-token

Environment:
  HAPI_DEPLOY_HOME   Deployment runtime directory
  HAPI_PUBLIC_URL    Default public URL used by init
  HAPI_LISTEN_HOST   Default listen host used by init
  HAPI_LISTEN_PORT   Default listen port used by init

Notes:
  - This script manages the local hub only.
  - Pair it with a reverse proxy or Cloudflare Tunnel for public access.
  - Native attach currently supports codex tmux sessions only.
EOF
}

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 1
    fi
}

use_launchd() {
    [[ "$(uname -s)" == "Darwin" ]] && command -v launchctl >/dev/null 2>&1
}

launchd_job_pid() {
    if ! use_launchd; then
        return 1
    fi

    launchctl list | awk -v label="$LAUNCHD_LABEL" '$3 == label { print $1 }'
}

launchd_is_running() {
    local pid
    pid="$(launchd_job_pid 2>/dev/null || true)"
    if [[ -z "$pid" || "$pid" == "-" ]]; then
        return 1
    fi

    kill -0 "$pid" >/dev/null 2>&1
}

is_running() {
    if use_launchd && launchd_is_running; then
        return 0
    fi

    if [[ ! -f "$PID_FILE" ]]; then
        return 1
    fi

    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -z "$pid" ]]; then
        return 1
    fi

    kill -0 "$pid" >/dev/null 2>&1
}

generate_token() {
    node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
}

ensure_dirs() {
    mkdir -p "$DEPLOY_HOME" "$LOG_DIR" "$DATA_DIR"
}

write_env_file() {
    local public_url="$1"
    local token
    token="$(generate_token)"

    cat > "$ENV_FILE" <<EOF
# Public URL exposed by your tunnel or reverse proxy.
HAPI_PUBLIC_URL=$public_url

# Keep the hub local-only. Let the tunnel/proxy expose it.
HAPI_LISTEN_HOST=$DEFAULT_LISTEN_HOST
HAPI_LISTEN_PORT=$DEFAULT_LISTEN_PORT
CORS_ORIGINS=$public_url

# Local runtime data.
HAPI_HOME=$DATA_DIR
DB_PATH=$DATA_DIR/hapi.db

# Browser login token.
CLI_API_TOKEN=$token

# Optional: keep Telegram off for a pure browser/PWA deployment.
TELEGRAM_NOTIFICATION=false
EOF
}

load_env() {
    if [[ ! -f "$ENV_FILE" ]]; then
        echo "Missing env file: $ENV_FILE" >&2
        echo "Run './scripts/public-deploy.sh init https://your-domain.example' first." >&2
        exit 1
    fi

    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
}

build() {
    require_command bun
    (cd "$ROOT_DIR" && bun run build:web && bun run build:hub)
}

init() {
    ensure_dirs

    if [[ -f "$ENV_FILE" ]]; then
        echo "Env file already exists: $ENV_FILE"
        return 0
    fi

    local public_url="${1:-$DEFAULT_PUBLIC_URL}"
    write_env_file "$public_url"

    echo "Created: $ENV_FILE"
    echo "Public URL: $public_url"
    echo "Next:"
    echo "  1. Review $ENV_FILE"
    echo "  2. ./scripts/public-deploy.sh start"
    echo "  3. Point your tunnel/proxy to http://$DEFAULT_LISTEN_HOST:$DEFAULT_LISTEN_PORT"
}

start() {
    ensure_dirs
    load_env

    if is_running; then
        if use_launchd && launchd_is_running; then
            echo "Hub already running with launchd PID $(launchd_job_pid)"
        else
            echo "Hub already running with PID $(cat "$PID_FILE")"
        fi
        return 0
    fi

    build

    if use_launchd; then
        launchctl remove "$LAUNCHD_LABEL" >/dev/null 2>&1 || true
        launchctl submit -l "$LAUNCHD_LABEL" -- /bin/zsh -lc "cd '$ROOT_DIR' && set -a && source '$ENV_FILE' && set +a && exec '$BUN_INSTALL/bin/bun' hub/dist/index.js >> '$LOG_FILE' 2>&1"
        rm -f "$PID_FILE"
    else
        (
            cd "$ROOT_DIR"
            nohup bun --env-file "$ENV_FILE" hub/dist/index.js > "$LOG_FILE" 2>&1 &
            echo $! > "$PID_FILE"
        )
    fi

    echo "Hub started."
    if use_launchd && launchd_is_running; then
        echo "Launchd label: $LAUNCHD_LABEL"
        echo "PID: $(launchd_job_pid)"
    else
        echo "PID: $(cat "$PID_FILE")"
    fi
    echo "Public URL: ${HAPI_PUBLIC_URL:-}"
    echo "Local URL: http://${HAPI_LISTEN_HOST:-127.0.0.1}:${HAPI_LISTEN_PORT:-3006}"
    echo "Logs: $LOG_FILE"
}

stop() {
    if use_launchd; then
        if ! launchd_is_running; then
            rm -f "$PID_FILE"
            echo "Hub is not running."
            return 0
        fi

        local pid
        pid="$(launchd_job_pid)"
        launchctl remove "$LAUNCHD_LABEL"

        # launchctl remove is asynchronous enough that an immediate start can race.
        for _ in {1..30}; do
            if ! launchd_is_running; then
                break
            fi
            sleep 0.1
        done

        rm -f "$PID_FILE"
        echo "Stopped hub launchd job $LAUNCHD_LABEL (PID $pid)"
        return 0
    fi

    if ! is_running; then
        rm -f "$PID_FILE"
        echo "Hub is not running."
        return 0
    fi

    local pid
    pid="$(cat "$PID_FILE")"
    kill "$pid"
    rm -f "$PID_FILE"
    echo "Stopped hub PID $pid"
}

status() {
    load_env

    if use_launchd && launchd_is_running; then
        echo "Status: running"
        echo "Launchd label: $LAUNCHD_LABEL"
        echo "PID: $(launchd_job_pid)"
    elif is_running; then
        echo "Status: running"
        echo "PID: $(cat "$PID_FILE")"
    else
        echo "Status: stopped"
    fi

    echo "Env: $ENV_FILE"
    echo "Logs: $LOG_FILE"
    echo "Public URL: ${HAPI_PUBLIC_URL:-}"
    echo "Local URL: http://${HAPI_LISTEN_HOST:-127.0.0.1}:${HAPI_LISTEN_PORT:-3006}"
}

logs() {
    ensure_dirs
    touch "$LOG_FILE"
    tail -f "$LOG_FILE"
}

print_token() {
    load_env
    echo "${CLI_API_TOKEN:-}"
}

main() {
    local command="${1:-}"
    case "$command" in
        init)
            init "${2:-}"
            ;;
        build)
            build
            ;;
        start)
            start
            ;;
        stop)
            stop
            ;;
        restart)
            stop || true
            start
            ;;
        status)
            status
            ;;
        logs)
            logs
            ;;
        print-token)
            print_token
            ;;
        ""|-h|--help|help)
            usage
            ;;
        *)
            echo "Unknown command: $command" >&2
            usage >&2
            exit 1
            ;;
    esac
}

main "$@"
