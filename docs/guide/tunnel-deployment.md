# Public / Tunnel Deployment

Deploy HAPI on your own machine and expose it through a tunnel or reverse proxy.

If your local machine has no public IP and you prefer to front it with your own VPS, see [VPS Relay Deployment](./vps-relay-deployment.md).

This guide is written for the current Codex app-server flow:

- HAPI Hub + Web served from your machine
- remote access through your own domain / tunnel
- Codex sessions spawned through an online HAPI runner

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
HAPI runner -> codex app-server
```

## Prerequisites

- Bun
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

## Recommended operational split

- Hub/Web: managed by `./scripts/public-deploy.sh`
- Tunnel: managed by `cloudflared` / system service
- Codex work: managed through HAPI runner + app-server

That split keeps restart scope small:

- restart hub when code changes
- restart tunnel when networking changes
- keep runner health separate from network changes

## Troubleshooting

### The public page opens but updates do not stream

Check:

- tunnel points to `http://127.0.0.1:3006`
- `HAPI_PUBLIC_URL` matches the public HTTPS origin
- `CORS_ORIGINS` matches the same origin
- do not use Cloudflare Quick Tunnel; use a named tunnel

### I can open the site but cannot log in

Check the token:

```bash
./scripts/public-deploy.sh print-token
```

If needed, edit `~/.hapi-deploy/public/hub.env` and restart the hub.
