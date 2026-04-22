# Public / Tunnel Deployment

Deploy HAPI on your own machine and expose it through a tunnel or reverse proxy.

If your local machine has no public IP and you prefer to front it with your own VPS, see [VPS Relay Deployment](./vps-relay-deployment.md).

This guide is written for the current native session flow:

- HAPI Hub + Web served from your machine
- remote access through your own domain / tunnel
- native attach for `tmux + codex`

> Native attach currently supports `codex` only. Native `claude` attach is intentionally disabled for now.

## Recommended topology

```text
Phone / Browser
    |
HTTPS
    |
Cloudflare Tunnel / Reverse Proxy
    |
127.0.0.1:3006
    |
HAPI Hub + Web
    |
tmux -> codex
```

## Prerequisites

- Bun
- `tmux`
- `codex`
- a public HTTPS hostname
- optional: `cloudflared`

## One-time setup

From the repo root:

```bash
chmod +x ./scripts/public-deploy.sh
./scripts/public-deploy.sh init https://hapi.example.com
```

This creates:

- `~/.hapi-deploy/public/hub.env`
- `~/.hapi-deploy/public/hapi-home/`
- `~/.hapi-deploy/public/logs/hub.log`

Review the generated env file before first start.

## Build and start the hub

```bash
./scripts/public-deploy.sh start
```

Useful commands:

```bash
./scripts/public-deploy.sh status
./scripts/public-deploy.sh logs
./scripts/public-deploy.sh print-token
./scripts/public-deploy.sh stop
./scripts/public-deploy.sh restart
```

The script keeps the hub bound to `127.0.0.1:3006` and expects your tunnel or proxy to publish it.

## Cloudflare Tunnel

Create a named tunnel and point it at the local hub:

```bash
cloudflared tunnel create hapi
cloudflared tunnel route dns hapi hapi.example.com
```

Use the template at `deploy/cloudflared/config.example.yml` and replace:

- `YOUR_TUNNEL_ID`
- credentials file path
- `hapi.example.com`

Then run:

```bash
cloudflared tunnel --config /path/to/config.yml --protocol http2 run
```

## Optional reverse proxy

If you prefer to terminate HTTPS locally with Caddy or Nginx, keep the hub on `127.0.0.1:3006` and proxy traffic to it.

Template: `deploy/caddy/Caddyfile.example`

Example Caddy block:

```caddyfile
hapi.example.com {
    reverse_proxy 127.0.0.1:3006
}
```

## First login

Print the browser token:

```bash
./scripts/public-deploy.sh print-token
```

Open your public URL and sign in with that token.

## Native codex attach flow

Start Codex in `tmux` on the deployment machine:

```bash
tmux new -s work-a
codex
```

Then in HAPI Web:

1. open `Create Session`
2. use `Attach Native Session`
3. pick the detected `codex` pane

## Recommended operational split

- Hub/Web: managed by `./scripts/public-deploy.sh`
- Tunnel: managed by `cloudflared` / system service
- Native sessions: managed inside `tmux`

That split keeps restart scope small:

- restart hub when code changes
- restart tunnel when networking changes
- keep `tmux + codex` alive independently

## Troubleshooting

### The public page opens but updates do not stream

Check:

- tunnel points to `http://127.0.0.1:3006`
- `HAPI_PUBLIC_URL` matches the public HTTPS origin
- `CORS_ORIGINS` matches the same origin
- do not use Cloudflare Quick Tunnel; use a named tunnel

### Native session list is empty

Check:

- `tmux` is installed
- `codex` is running inside `tmux`
- pane command resolves to `codex`

### I can open the site but cannot log in

Check the token:

```bash
./scripts/public-deploy.sh print-token
```

If needed, edit `~/.hapi-deploy/public/hub.env` and restart the hub.
