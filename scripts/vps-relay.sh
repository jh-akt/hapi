#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELAY_HOME="${HAPI_VPS_RELAY_HOME:-$HOME/.hapi-deploy/vps-relay}"
ENV_FILE="$RELAY_HOME/relay.env"
PID_FILE="$RELAY_HOME/relay.pid"
LOG_DIR="$RELAY_HOME/logs"
LOG_FILE="$LOG_DIR/relay.log"
LAUNCHD_LABEL="${HAPI_VPS_RELAY_LABEL:-com.hapi.vps.relay}"

DEFAULT_PUBLIC_URL="${HAPI_PUBLIC_URL:-https://hapi.example.com}"
DEFAULT_REMOTE_BIND_HOST="${HAPI_VPS_REMOTE_BIND_HOST:-127.0.0.1}"
DEFAULT_REMOTE_BIND_PORT="${HAPI_VPS_REMOTE_BIND_PORT:-33006}"
DEFAULT_LOCAL_FORWARD_HOST="${HAPI_VPS_LOCAL_FORWARD_HOST:-127.0.0.1}"
DEFAULT_LOCAL_FORWARD_PORT="${HAPI_VPS_LOCAL_FORWARD_PORT:-3006}"
DEFAULT_SSH_PORT="${HAPI_VPS_SSH_PORT:-22}"

usage() {
    cat <<'EOF'
Usage:
  ./scripts/vps-relay.sh init <ssh-remote> [public-url] [remote-bind-port]
  ./scripts/vps-relay.sh start
  ./scripts/vps-relay.sh stop
  ./scripts/vps-relay.sh restart
  ./scripts/vps-relay.sh status
  ./scripts/vps-relay.sh logs
  ./scripts/vps-relay.sh print-config

Examples:
  ./scripts/vps-relay.sh init root@vps.example.com https://hapi.example.com
  ./scripts/vps-relay.sh init root@203.0.113.10 https://hapi.example.com 33006

Notes:
  - Keep the remote bind address on 127.0.0.1 and let Caddy/Nginx on the VPS publish HTTPS.
  - The VPS sshd must allow remote forwarding.
  - This script only manages the reverse SSH tunnel. Run the local hub via ./scripts/public-deploy.sh.
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

ensure_dirs() {
    mkdir -p "$RELAY_HOME" "$LOG_DIR"
}

write_env_file() {
    local ssh_remote="$1"
    local public_url="$2"
    local remote_bind_port="$3"

    cat > "$ENV_FILE" <<EOF
# Public HTTPS origin served by your VPS reverse proxy.
PUBLIC_URL=$public_url

# SSH destination that the local machine dials out to.
SSH_REMOTE=$ssh_remote
SSH_PORT=$DEFAULT_SSH_PORT

# Bind only on loopback inside the VPS; publish it with Caddy/Nginx there.
REMOTE_BIND_HOST=$DEFAULT_REMOTE_BIND_HOST
REMOTE_BIND_PORT=$remote_bind_port

# Local HAPI Hub endpoint to forward upstream.
LOCAL_FORWARD_HOST=$DEFAULT_LOCAL_FORWARD_HOST
LOCAL_FORWARD_PORT=$DEFAULT_LOCAL_FORWARD_PORT

# Optional SSH settings.
SSH_IDENTITY_FILE=
SSH_EXTRA_ARGS=
EOF
}

load_env() {
    if [[ ! -f "$ENV_FILE" ]]; then
        echo "Missing env file: $ENV_FILE" >&2
        echo "Run './scripts/vps-relay.sh init root@your-vps https://hapi.example.com' first." >&2
        exit 1
    fi

    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
}

run_foreground() {
    require_command ssh
    load_env

    local ssh_args=(
        -NT
        -p "${SSH_PORT:-$DEFAULT_SSH_PORT}"
        -o ExitOnForwardFailure=yes
        -o ServerAliveInterval=30
        -o ServerAliveCountMax=3
        -o TCPKeepAlive=yes
        -o StrictHostKeyChecking=accept-new
        -R "${REMOTE_BIND_HOST}:${REMOTE_BIND_PORT}:${LOCAL_FORWARD_HOST}:${LOCAL_FORWARD_PORT}"
    )

    if [[ -n "${SSH_IDENTITY_FILE:-}" ]]; then
        ssh_args+=(-i "$SSH_IDENTITY_FILE")
    fi

    if [[ -n "${SSH_EXTRA_ARGS:-}" ]]; then
        # shellcheck disable=SC2206
        local extra_args=( $SSH_EXTRA_ARGS )
        ssh_args+=("${extra_args[@]}")
    fi

    ssh_args+=("${SSH_REMOTE}")

    echo "Opening reverse SSH tunnel:"
    echo "  local  ${LOCAL_FORWARD_HOST}:${LOCAL_FORWARD_PORT}"
    echo "  remote ${REMOTE_BIND_HOST}:${REMOTE_BIND_PORT} via ${SSH_REMOTE}:${SSH_PORT:-$DEFAULT_SSH_PORT}"

    exec ssh "${ssh_args[@]}"
}

init() {
    local ssh_remote="${1:-}"
    if [[ -z "$ssh_remote" ]]; then
        echo "Missing required argument: <ssh-remote>" >&2
        usage >&2
        exit 1
    fi

    ensure_dirs

    if [[ -f "$ENV_FILE" ]]; then
        echo "Env file already exists: $ENV_FILE"
        return 0
    fi

    local public_url="${2:-$DEFAULT_PUBLIC_URL}"
    local remote_bind_port="${3:-$DEFAULT_REMOTE_BIND_PORT}"

    write_env_file "$ssh_remote" "$public_url" "$remote_bind_port"

    echo "Created: $ENV_FILE"
    echo "Public URL: $public_url"
    echo "SSH remote: $ssh_remote"
    echo "Remote relay: ${DEFAULT_REMOTE_BIND_HOST}:$remote_bind_port"
    echo "Next:"
    echo "  1. Point the VPS reverse proxy to ${DEFAULT_REMOTE_BIND_HOST}:$remote_bind_port"
    echo "  2. Edit ~/.hapi-deploy/public/hub.env to use $public_url"
    echo "  3. ./scripts/vps-relay.sh start"
}

start() {
    ensure_dirs
    load_env

    if is_running; then
        if use_launchd && launchd_is_running; then
            echo "Reverse tunnel already running with launchd PID $(launchd_job_pid)"
        else
            echo "Reverse tunnel already running with PID $(cat "$PID_FILE")"
        fi
        return 0
    fi

    if use_launchd; then
        launchctl remove "$LAUNCHD_LABEL" >/dev/null 2>&1 || true
        launchctl submit -l "$LAUNCHD_LABEL" -- /bin/zsh -lc "cd '$ROOT_DIR' && exec '$ROOT_DIR/scripts/vps-relay.sh' run-foreground >> '$LOG_FILE' 2>&1"
        rm -f "$PID_FILE"
    else
        (
            cd "$ROOT_DIR"
            nohup "$ROOT_DIR/scripts/vps-relay.sh" run-foreground > "$LOG_FILE" 2>&1 &
            echo $! > "$PID_FILE"
        )
    fi

    echo "Reverse tunnel started."
    if use_launchd && launchd_is_running; then
        echo "Launchd label: $LAUNCHD_LABEL"
        echo "PID: $(launchd_job_pid)"
    else
        echo "PID: $(cat "$PID_FILE")"
    fi
    echo "Logs: $LOG_FILE"
}

stop() {
    if use_launchd; then
        if ! launchd_is_running; then
            rm -f "$PID_FILE"
            echo "Reverse tunnel is not running."
            return 0
        fi

        local pid
        pid="$(launchd_job_pid)"
        launchctl remove "$LAUNCHD_LABEL"

        for _ in {1..30}; do
            if ! launchd_is_running; then
                break
            fi
            sleep 0.1
        done

        rm -f "$PID_FILE"
        echo "Stopped reverse tunnel launchd job $LAUNCHD_LABEL (PID $pid)"
        return 0
    fi

    if ! is_running; then
        rm -f "$PID_FILE"
        echo "Reverse tunnel is not running."
        return 0
    fi

    local pid
    pid="$(cat "$PID_FILE")"
    kill "$pid"
    rm -f "$PID_FILE"
    echo "Stopped reverse tunnel PID $pid"
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

    echo "Public URL: ${PUBLIC_URL:-}"
    echo "SSH remote: ${SSH_REMOTE:-}:${SSH_PORT:-$DEFAULT_SSH_PORT}"
    echo "Remote relay: ${REMOTE_BIND_HOST:-$DEFAULT_REMOTE_BIND_HOST}:${REMOTE_BIND_PORT:-$DEFAULT_REMOTE_BIND_PORT}"
    echo "Local target: ${LOCAL_FORWARD_HOST:-$DEFAULT_LOCAL_FORWARD_HOST}:${LOCAL_FORWARD_PORT:-$DEFAULT_LOCAL_FORWARD_PORT}"
    echo "Env: $ENV_FILE"
    echo "Logs: $LOG_FILE"
}

logs() {
    ensure_dirs
    touch "$LOG_FILE"
    tail -f "$LOG_FILE"
}

print_config() {
    load_env
    cat "$ENV_FILE"
}

main() {
    local command="${1:-}"
    case "$command" in
        init)
            init "${2:-}" "${3:-}" "${4:-}"
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
        print-config)
            print_config
            ;;
        run-foreground)
            run_foreground
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
