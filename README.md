# Homelab Central

Self-hosted homelab administration PWA for Debian 13 + Docker Compose.

## Included
- Next.js App Router PWA (manifest, service worker, installable shell)
- Express API with administrator login, hashed 4-digit critical-action PIN, rate limits and audit log
- PostgreSQL + Prisma schema
- Redis + BullMQ worker scaffold
- Restricted Docker gateway (list/inspect/logs/start/stop/restart only)
- Native host helper (fixed reboot/shutdown/docker-restart operations)
- Application launcher, maintenance mail, backups, update/domain monitoring API scaffolds
- Traefik labels and Compose deployment

## Important deployment notes
This is a deployable first implementation, not a substitute for a security review. Do not expose it publicly until Cloudflare Access + MFA is enforced and the host helper, Docker gateway, SMTP and backup paths are configured and tested. The four-digit PIN is an extra confirmation layer, not authentication; keep the account password and Cloudflare Access.

## Quick start
1. Copy `.env.example` to `.env`, replace every `CHANGE_ME` value with long random secrets.
2. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `APP_ORIGIN=https://central.albyn.site`, `TRAEFIK_NETWORK` and SMTP values.
3. Create data directories:
   `sudo mkdir -p /opt/homelab/data/homelab-central/{postgres,redis,backups}`
4. Review `compose.yaml`, especially the Docker gateway socket mount and host-helper URL.
5. Start: `docker compose up -d --build`
6. The API entrypoint applies the initial Prisma schema with `prisma db push` before starting. After the first schema is established, create and commit Prisma migrations, then switch the entrypoint to `prisma migrate deploy`.
7. Open the site through Cloudflare Access. Sign in using the bootstrap admin credentials, then configure the 4-digit PIN in Settings.
8. Install: Chrome/Edge menu → Install Homelab Central. Android Chrome → Add to Home screen.

## Host helper installation
The host helper is intentionally a native systemd service and is not run as a privileged container. See `host-helper/README.md`. It listens only on the host bridge interface, authenticates with a long random token, and accepts a fixed allowlist of operations. Restrict its firewall source to the Compose host gateway/network and never expose it through Traefik or Cloudflare.

## Docker gateway
The gateway is the only container with Docker socket access. It exposes a small allowlisted API on an internal network. The API backend cannot access `/var/run/docker.sock` directly. Do not add exec/create/privileged/volume endpoints.

## PWA behavior
The service worker caches only static app shell assets. API responses and authenticated content are never cached, avoiding stale/private data exposure. Offline mode shows the shell and an offline notice; live controls require a connection.

## Known first-release boundaries
- SMTP delivery is queued and records submission/failure, not inbox delivery.
- Backup implementation currently supports configured filesystem targets and PostgreSQL dump scaffolding; test app-specific consistency before relying on it.
- Docker update scan/apply is conservative scaffolding. Review Compose project paths and image tags before enabling update actions.
- Domain checks support HTTPS/HTTP and certificate metadata; DNS checks depend on host resolver access.
- Metrics use host-helper collection; configure the helper's allowed metrics and host mount visibility.
- No arbitrary shell, Docker exec, container creation or privileged operations are provided.
