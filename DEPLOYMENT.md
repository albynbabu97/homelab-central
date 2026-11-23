# Deployment guide — Debian 13

## 1. Prepare the server

Confirm Docker, Compose and the existing Traefik network:

```bash
docker --version
docker compose version
docker network ls
```

The Compose file defaults to the existing network name `homelab`. Change `TRAEFIK_NETWORK` if your actual Traefik network differs.

Create persistent directories:

```bash
sudo mkdir -p /opt/homelab/data/homelab-central/{postgres,redis,backups}
sudo chown -R 999:999 /opt/homelab/data/homelab-central/postgres
```

Copy the extracted `homelab-central` directory to:
`/opt/homelab/stacks/homelab-central/`.

## 2. Configure secrets

```bash
cd /opt/homelab/stacks/homelab-central
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

Generate different random values for `SESSION_SECRET`, `PIN_PEPPER`, `HOST_HELPER_TOKEN`, `DOCKER_GATEWAY_TOKEN` and `DB_PASSWORD`. Set `DATABASE_URL` to use the exact same database password as `DB_PASSWORD`, URL-encoding special characters if present. Set a strong unique `ADMIN_PASSWORD`; do not use the four-digit PIN as the login password.

Set:
- `ADMIN_EMAIL` to your administrator email.
- `APP_ORIGIN=https://central.albyn.site`.
- `TRAEFIK_HOST=central.albyn.site`.
- `TRAEFIK_NETWORK` to the actual Traefik Docker network.
- SMTP settings before attempting email notifications.

## 3. Start the stack

```bash
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs -f api web
```

The API entrypoint applies the initial Prisma schema. On first startup, wait for the API log to report that it is listening. Bootstrap the administrator by signing in with the matching `ADMIN_EMAIL` and `ADMIN_PASSWORD` values; the account is created on first successful bootstrap login.

## 4. Configure the host helper before enabling host controls

Read `host-helper/README.md` fully. Install the helper as a native systemd service, create its restricted system user, install only the three allowlisted sudoers commands, and configure host firewall rules so port 4200 is reachable only from the Homelab Central API container/network. Never expose port 4200 via Traefik or Cloudflare.

Verify locally from the server before using host actions:

```bash
sudo systemctl status homelab-host-helper
curl -fsS -H "Authorization: Bearer YOUR_HOST_HELPER_TOKEN" http://127.0.0.1:4200/health
```

The helper must listen on `0.0.0.0:4200` (not only `127.0.0.1`) so containers can reach it via `host.docker.internal`. Restrict port 4200 with the host firewall.

From the API container (after the stack is up):

```bash
docker compose exec api wget -qO- \
  --header="Authorization: Bearer $(grep '^HOST_HELPER_TOKEN=' .env | cut -d= -f2-)" \
  http://host.docker.internal:4200/health
```

If you see `Network unreachable`, the API service must also be attached to the non-internal `host_access` network in `compose.yaml` ( `app` / `ops` are `internal: true` and cannot reach the Docker host by design).

The helper is not installed automatically by Compose. Do not enable reboot/shutdown controls until this is tested.

## 5. Cloudflare and Traefik

Create/confirm the `central.albyn.site` route in the existing Cloudflare Tunnel so it reaches Traefik on the origin address/port used by your current tunnel. Apply a Cloudflare Access application/policy for this hostname, restrict it to your administrator identity, and require MFA. Confirm there is no direct public origin path that bypasses Access.

## 6. First login and PWA installation

1. Open `https://central.albyn.site` after the Cloudflare Access check.
2. Sign in with the administrator email/password from `.env`.
3. Open Settings and set the four-digit critical-action PIN.
4. On desktop Chrome/Edge, use the browser install icon or menu → Install Homelab Central.
5. On Android Chrome, use menu → Add to Home screen / Install app.

PWA installation requires HTTPS. The service worker caches only the app shell; authenticated API data and actions remain network-only.

## 7. Operational validation checklist

- Verify Cloudflare Access and MFA from a separate browser session.
- Verify API login/logout and session persistence across API container restart.
- Set the PIN and test a wrong PIN; confirm no action is executed.
- Test a harmless container restart only after confirming the Docker gateway allowlist.
- Test host-helper health before reboot/shutdown; perform a reboot test only during a safe maintenance window.
- Configure SMTP and send a test maintenance notice to yourself.
- Verify database backup and restore procedures before storing critical data.
- Confirm backup files are encrypted and stored outside the server before relying on them.

## Implementation status

The initial codebase includes the PWA shell, login/session foundation, PIN-gated critical-action endpoint, restricted Docker gateway, host helper, container listing/control UI, host metrics, application listing, SMTP notification sending, activity records, and initial persistence models.

Backup execution/restore, Docker image update scanning/apply, automated domain/SSL checks, full settings CRUD, recipient management UI, and long-term metric aggregation still need implementation and integration testing. Their screens/API starting points are present, but do not treat those modules as production-ready yet.
