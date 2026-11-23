# Native host helper (install separately)

This helper is deliberately not part of the Docker Compose stack. It runs as a dedicated systemd service and accepts only three fixed operations: reboot, shutdown and Docker daemon restart. It never accepts shell text or arbitrary command arguments.

1. Create a dedicated system user and install Python dependencies from `requirements.txt` into a virtual environment.
2. Set `HOST_HELPER_TOKEN` to the same high-entropy secret as the API environment.
3. Configure `HOST_HELPER_BIND` to the Docker host-gateway-reachable interface. Firewall it so only the homelab-central Compose network can connect.
4. Review and install `homelab-host-helper.service`.
5. Add narrowly scoped sudoers entries for `/usr/bin/systemctl reboot`, `/usr/bin/systemctl poweroff`, and `/usr/bin/systemctl restart docker` for the helper user only. Validate exact paths with `command -v` first.
6. Never expose port 4200 through Traefik, Cloudflare Tunnel or the public internet.

Do not install until firewall and sudoers rules have been reviewed.
