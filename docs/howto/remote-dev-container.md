# Run the Dev Container on a Remote Machine

The dev container does not have to run on the machine you type on. VS Code's **Remote - SSH** and
**Dev Containers** extensions chain: the VS Code window runs locally, while the code, Docker, the
containers, and all their disk usage live on a remote Linux machine you reach over SSH (for
example, through Tailscale). Nothing in the repo changes for this; `.devcontainer/` works as is.

Below, `<host>` is the remote machine's name (with Tailscale's MagicDNS, its machine name) and
`<user>` your account on it.

## One-time setup

### On the remote machine

1. Install Docker Engine with the compose plugin, and add your user to the `docker` group (Dev
   Containers runs `docker` without `sudo`), then log out and back in:

   ```bash
   sudo usermod -aG docker $USER
   ```

2. Clone the repo, for example to `~/workspace/grepdocs`.
3. Create `src/api/.env` there: run `make env` and fill it in, or copy yours from your local
   machine:

   ```bash
   scp src/api/.env <host>:~/workspace/grepdocs/src/api/.env
   ```

4. Check that the clock is synchronized (`timedatectl` should say `System clock synchronized:
   yes`). A clock that lags breaks the image build; see Troubleshooting.

### On your local machine

1. Install the **Remote - SSH** and **Dev Containers** extensions (or the **Remote Development**
   pack, which has both).
2. Add the host to `~/.ssh/config`, so that `ssh <host>` works without a user and without a
   password prompt. VS Code reads this file and lists the host in **Remote-SSH: Connect to Host…**.

   ```sshconfig
   Host <host>
       HostName <host>
       User <user>
       ServerAliveInterval 30
       ServerAliveCountMax 4
   ```

   The keep-alives stop an idle VS Code window from freezing after a network change or sleep. If
   the short name does not resolve, set `HostName` to the full MagicDNS name
   (`<host>.<tailnet>.ts.net`) or to the Tailscale IP (`tailscale ip -4 <host>`).

## Daily workflow

1. In VS Code: **Remote-SSH: Connect to Host…** → `<host>`, then open `~/workspace/grepdocs`.
2. **Dev Containers: Reopen in Container**. The container is built and runs on the remote machine;
   compose starts Postgres, Redis, and pgAdmin there too, since the `dev` service depends on them.
3. In the container's terminal, as usual: `make migrate-up`, `make run`, and `make ui-dev`.
4. For Claude Code, run `claude` in the container's terminal or use the Claude Code extension; the
   container installs both, and they share one login. A session started on your local machine only
   sees the local checkout, not the remote one.

## What to know

- **Ports 3000 and 5173** are forwarded through the SSH tunnel to `localhost:3000` and
  `localhost:5173` on your local machine, so the OAuth redirect URLs and `FRONTEND_URL` work
  unchanged. `requireLocalPort` makes forwarding fail if either port is taken locally: stop any
  local API or Vite dev server first.
- **pgAdmin (8080), Postgres (5432), and Redis (6379)** are published on the remote machine, not
  forwarded. Open `http://<host>:8080` over Tailscale, or add the port in VS Code's **Ports** panel
  to reach it on `localhost`.
- **Those ports listen on every interface of the remote machine**, with the default passwords.
  Reachable only over the tailnet, that is fine; if the machine also has a public or shared-LAN
  interface, firewall them or set `POSTGRES_PASSWORD` and `PGADMIN_PASSWORD`.
- **Run `make infra-*` in an SSH terminal on the remote machine**, not in the container: the
  container's Docker is its own daemon (Docker-in-Docker), so there it would start a separate copy.
  Opening the container already starts the infra.
- **Git uses your local credentials**: VS Code forwards your ssh-agent and git credential helper
  through both hops, so pushing from the container needs no keys on the remote machine.

## Troubleshooting

### `apt-get update` fails with "created after the --not-after date"

```
Sub-process /usr/bin/sqv returned an error code (1), error message is: Signature by … was
created after the --not-after date.
E: The repository 'http://deb.debian.org/debian-security trixie-security InRelease' is not signed.
```

The remote machine's clock is behind. Containers share the host's clock, and apt rejects a
repository signature that looks newer than "now". Check with `timedatectl`.

If NTP cannot reach a server, look at the time service's log (`systemctl status chrony` or
`systemctl status systemd-timesyncd`). Recent Ubuntu releases configure chrony with NTS only, whose
key exchange on TCP port 4460 is often blocked on university and corporate networks
(`NTS-KE session with … timed out`). Add a plain NTP source, ideally the network's own NTP server,
then step the clock:

```bash
echo 'pool <ntp-server> iburst' | sudo tee /etc/chrony/sources.d/plain-ntp.sources
sudo chronyc reload sources
chronyc sources -v        # a ^* or ^+ line means a server is reachable
sudo chronyc makestep
```

Until NTP works, set the clock once from an HTTPS `Date` header, then rebuild the container. The
clock drifts again, so this only buys time:

```bash
sudo date -s "$(curl -sI https://deb.debian.org | grep -i '^date:' | cut -d' ' -f2-)"
```

### `setlocale: LC_ALL: cannot change locale`

Harmless. SSH sends your local locale, and the remote machine has not generated it. Generate it
there (for example, `sudo locale-gen it_IT.UTF-8`) to silence the warning.
