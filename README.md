# @riceawa/dsh-proxy-bridge

Lightweight reverse-proxy bridge for the DeepSeek Harness web GUI, designed to sit behind a TLS-terminating reverse proxy (nginx).

## Why

When DSH is accessed through nginx → gateway → DSH, WebSocket connections break because the gateway's same-site fence compares the client's `Origin` (internal container address) against the `Host` (external nginx address) and rejects the mismatch with a 403.

This bridge skips the strict same-site check — it trusts the upstream terminator (nginx) for access control — so WS upgrades relay cleanly.

## Architecture

```
Browser ──HTTPS──▶ nginx (TLS) ──HTTP──▶ Proxy Bridge (0.0.0.0:3083) ──HTTP──▶ DSH (127.0.0.1:3080)
```

- **HTTP**: forwarded with Host/Origin rewritten to `127.0.0.1:3080`
- **WebSocket**: socket spliced directly to upstream, no same-site fence
- **Optional password gate**: second layer on top of nginx auth

## Usage

```bash
# Enable the bridge (default port 3083 → DSH 3080)
proxy_bridge enable

# With custom ports
proxy_bridge enable --port 3083 --dsh-port 3080

# Check status
proxy_bridge status

# Set a password
proxy_bridge config --password "yourpassword"

# Disable
proxy_bridge disable
```

## nginx config

```nginx
server {
    listen 11007 ssl;
    server_name dsh.poxx.top;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://192.168.123.99:3083;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Differences from @riceawa/dsh-lan-gateway

| | LAN Gateway | Proxy Bridge |
|---|---|---|
| Position | Direct LAN/internet exposure | Behind nginx |
| Security | Default-deny, password required | Trusts nginx, optional password |
| Same-site check | Strict (Origin must match Host) | **Skipped** (nginx handles it) |
| WS through nginx | ❌ 403 | ✅ Works |

## License

MIT
