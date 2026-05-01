# VPS Relay Deployment

Deploy HAPI on your local machine, then expose it through a VPS that terminates HTTPS and relays traffic back over a reverse SSH tunnel.

This path is useful when:

- your laptop / desktop has no public IP
- you do not want to expose inbound ports on the local network
- you already have a VPS with a public domain

This guide is written for the current Codex app-server flow:

- HAPI Hub + Web run on your own machine
- Codex runs through an online HAPI runner and app-server on your own machine
- the VPS only does HTTPS ingress + reverse proxy

## Recommended topology

```text
Phone / Browser
    |
HTTPS
    |
VPS + Caddy
    |
127.0.0.1:33006 on VPS
    |
reverse SSH tunnel
    |
127.0.0.1:3006 on your machine
    |
HAPI Hub + Web
    |
HAPI runner -> codex app-server
```

## Prerequisites

- local machine: Bun, `codex`, SSH client
- VPS: public IP, domain / subdomain, SSH server
- VPS: Caddy or Nginx

## 1. Start the local hub

From the repo root on your own machine:

```bash
./scripts/public-deploy.sh start
```

Then update `~/.hapi-deploy/public/hub.env` so the public origin points to the VPS hostname:

```env
HAPI_PUBLIC_URL=https://hapi.example.com
CORS_ORIGINS=https://hapi.example.com
```

Restart after editing:

```bash
./scripts/public-deploy.sh restart
```

## 2. Prepare the VPS reverse proxy

Use `deploy/caddy/Caddyfile.vps-relay.example` as a template.

Example:

```caddyfile
hapi.example.com {
    encode zstd gzip

    reverse_proxy 127.0.0.1:33006 {
        health_uri /health
        header_up X-Forwarded-Host {host}
        header_up X-Forwarded-Proto https
    }
}
```

Important detail:

- the VPS proxy points to `127.0.0.1:33006`
- that port is not public; it is only fed by the reverse SSH tunnel

## 3. Make sure the VPS SSH server allows remote forwarding

On the VPS, the SSH server must allow reverse tunnels.

Typical `sshd_config` requirements:

```text
AllowTcpForwarding yes
```

Using the default `GatewayPorts no` is fine here because we intentionally bind the relayed port to `127.0.0.1` on the VPS.

## 4. Create the reverse tunnel from your local machine

Initialize the relay config:

```bash
./scripts/vps-relay.sh init root@your-vps.example.com https://hapi.example.com 33006
```

This creates:

- `~/.hapi-deploy/vps-relay/relay.env`
- `~/.hapi-deploy/vps-relay/logs/relay.log`

Then start it:

```bash
./scripts/vps-relay.sh start
```

Useful commands:

```bash
./scripts/vps-relay.sh status
./scripts/vps-relay.sh logs
./scripts/vps-relay.sh stop
./scripts/vps-relay.sh restart
```

The script opens a reverse SSH tunnel equivalent to:

```bash
ssh -NT \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -R 127.0.0.1:33006:127.0.0.1:3006 \
  root@your-vps.example.com
```

## 5. Verify the relay path

On the VPS:

```bash
curl http://127.0.0.1:33006/health
```

Expected response:

```json
{"status":"ok","protocolVersion":1}
```

If that works, open your public HTTPS URL:

```text
https://hapi.example.com
```

## 6. First login

Print the browser token on your local machine:

```bash
./scripts/public-deploy.sh print-token
```

Open the VPS-backed public URL and sign in with that token.

## Operational split

- local hub/web process: `./scripts/public-deploy.sh`
- local reverse tunnel: `./scripts/vps-relay.sh`
- VPS HTTPS ingress: Caddy / Nginx service
- Codex work: HAPI runner + app-server

That separation keeps failures isolated:

- local code change: restart hub only
- SSH instability: restart reverse tunnel only
- VPS cert / proxy change: restart Caddy only
- agent work continues through the runner/app-server path

## Troubleshooting

### Public domain opens, but the app is blank or stale

Check:

- `~/.hapi-deploy/public/hub.env` has the final `https://` origin
- `CORS_ORIGINS` matches the same origin
- VPS Caddy points to `127.0.0.1:33006`
- the reverse tunnel is running

### VPS cannot reach `127.0.0.1:33006`

Check:

- `./scripts/vps-relay.sh status`
- VPS `sshd_config` allows remote forwarding
- your SSH user is allowed to open reverse tunnels
- local machine can SSH out to the VPS
