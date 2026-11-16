# Deploying LoyalFlow

Three ways to run it, from simplest to production:

1. **Laptop** (your own checks): `npm run demo`. Nothing to configure.
2. **Small team server** (testing with the managers): one DigitalOcean droplet, Docker Compose, HTTPS by Caddy. ~US$24/month (4 GB) is plenty for 44 users.
3. **Production**: the same droplet with demo data off, Microsoft 365 mail, off-site backups and a monitoring ping.

## A. DigitalOcean droplet, step by step

### 1. Create the droplet
- Region **Bangalore (BLR1)**, image **Ubuntu 24.04 LTS**, plan **Basic → Regular, 4 GB / 2 vCPU** (US$24/month). 2 GB works for testing.
- Authentication: SSH key (recommended). Hostname `loyalflow`.
- Enable **Backups** (weekly droplet snapshots, +20 %) — cheap insurance on top of the app's own nightly database backups.
- Add a firewall: allow inbound 22 (your IP only if possible), 80, 443.

### 2. DNS
Create an **A record** `flow.loyalstring.com → <droplet IP>` in the DNS of loyalstring.com (GoDaddy / Cloudflare / wherever the domain is). Wait until `ping flow.loyalstring.com` answers with the droplet IP; Caddy cannot get a certificate before that.

### 3. Install Docker
```bash
ssh root@<droplet IP>
apt update && apt -y upgrade
curl -fsSL https://get.docker.com | sh
adduser --disabled-password --gecos "" deploy && usermod -aG docker deploy
```

### 4. Put the code on the server
Either `git clone` your GitHub repository, or copy the zip:
```bash
su - deploy
mkdir -p /opt/loyalflow && cd /opt/loyalflow
# git clone git@github.com:<org>/loyalflow.git .      (or)   unzip ~/loyalflow.zip -d .
cp .env.example .env
nano .env
```
Set at least:
```
BASE_URL=https://flow.loyalstring.com
DOMAIN=flow.loyalstring.com
LOYALFLOW_DEMO=0            # 1 while the managers are testing with sample data
SESSION_SECRET=<output of: openssl rand -base64 48>
MAIL_TRANSPORT=smtp         # see section B
SMTP_USER=noreply@loyalstring.com
SMTP_PASS=<mailbox password or app password>
```

### 5. Start
```bash
docker compose up -d --build
docker compose logs -f loyalflow      # watch the first start: migrations, seed, "listening"
```
Open `https://flow.loyalstring.com`. The first start creates the 44 employee accounts from the employee master with the starter password; with demo off, everyone must choose their own password at first sign-in. Administrators: the CEO and COO accounts (`is_admin`).

### 6. After the first sign-in (COO)
1. **Settings → Roles**: confirm CEO, COO, Sales Head, HR owner, Accounts owner, Production HOD.
2. **Settings → SLA / Shifts & holidays / Approvals / SOPs, production, leave**: adjust thresholds and the holiday list for the year.
3. **People**: check reporting lines; add anyone missing (they receive a password link by email).
4. **Settings → System**: click *Back up now* once and confirm a file appears.
5. **SOPs → Library**: review the five seeded SOPs; edit steps or add your own.
6. **Company page → Targets**: set the real monthly/weekly targets (each change needs a reason and is logged).

### 7. Updating to a new version
```bash
cd /opt/loyalflow && git pull            # or unzip the new zip over the folder
docker compose up -d --build             # ~1 minute; data is in the volume and survives
docker compose logs --tail=50 loyalflow  # migrations run automatically on start
```
Roll back by checking out the previous commit and running the same command. Database migrations are additive, so an older version still starts on a newer database.

## B. Microsoft 365 mail

LoyalFlow sends emails for: password links, ticket replies/resolutions to customers, dispatch notifications, approval requests and decisions, SLA warnings, overdue SOPs and the Monday digest.

Using a Microsoft 365 Business Basic mailbox:
1. In the Microsoft 365 admin centre create a mailbox `noreply@loyalstring.com` (or a shared mailbox with "send as").
2. Enable **Authenticated SMTP** for that mailbox: Admin centre → Users → Active users → the mailbox → Mail → *Manage email apps* → tick *Authenticated SMTP*.
3. If security defaults / MFA are on (they should be), create an **app password** for the mailbox, or disable MFA for this one service account.
4. In `.env`: `MAIL_TRANSPORT=smtp`, `SMTP_HOST=smtp.office365.com`, `SMTP_PORT=587`, `SMTP_USER=noreply@loyalstring.com`, `SMTP_PASS=<app password>`, `MAIL_FROM=LoyalFlow <noreply@loyalstring.com>`.
5. `docker compose up -d` and test: Settings → System → *Send Monday digest now* (goes to the CEO, COO and HODs).

If Microsoft blocks SMTP AUTH for the tenant, a transactional mail service (Brevo, Postmark, Amazon SES) works with the same four settings.

## C. Backups

- The app writes a consistent copy of the database to the data volume every night at 02:00 (`/data/backups`, 30 kept) and on demand from Settings → System.
- Copy them off the server: `scripts/backup-offsite.sh` uses `rclone` to push the newest file to DigitalOcean Spaces, OneDrive or Google Drive. Install rclone (`apt install rclone`, `rclone config` → remote named `offsite`) and add the cron line in the script header.
- Droplet snapshots (step 1) cover the whole server weekly.
- **Restore**: see `docs/RUNBOOK.md`. In short: stop the app, replace `/data/loyalflow.sqlite` with the backup file, start the app.

## D. Monitoring

- `GET /health` returns `{"ok":true,...}`; point an uptime monitor at `https://flow.loyalstring.com/health` (UptimeRobot free tier, 5-minute checks, SMS/email alerts).
- `docker compose ps` shows the container health check; `docker compose logs loyalflow` shows requests ≥ 500 ms, errors and job runs.
- Disk: the database grows slowly (tens of MB per year at this volume); dispatch photos go to `/data/uploads` — keep an eye on `df -h`.

## E. Running without Docker (optional)

On any machine with Node 22.18+:
```bash
npm install --omit=dev
DATA_DIR=/var/lib/loyalflow BASE_URL=https://flow.loyalstring.com node --no-warnings=ExperimentalWarning src/server.ts
```
Run it under systemd (restart on failure) and put nginx or Caddy in front for HTTPS. The `Caddyfile` in the repository works unchanged with `reverse_proxy 127.0.0.1:3000`.

## F. Laptop notes

- The database and uploads are in `./data`; delete the folder to start fresh.
- `LOYALFLOW_DEMO=1` reseeds sample data only when the customers table is empty, so your own test records survive restarts.
- Emails appear in the terminal as `[mail:console] to=… subject=…`; password-reset links are shown on screen in demo mode.
- To let colleagues on the same Wi-Fi try it, start with `HOST=0.0.0.0 BASE_URL=http://<your laptop IP>:3000` and share that address. Phones can "Add to Home Screen" from it (location and camera features need HTTPS, i.e. the server setup).
