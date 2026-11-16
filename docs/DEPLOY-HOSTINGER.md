# Putting LoyalFlow on GitHub and hosting it on Hostinger

For the developer doing the hosting (Karan's team). Written 16 Nov 2026 for LoyalFlow v1.17.1.
The code is on the COO's laptop in `C:\Users\loyal\Desktop\loyalflow`. Allow about an hour.

## What you need before you start
| Need | Why |
|---|---|
| A GitHub account in the company's name, with a **private** repository | The code and seeded employee list must not be public |
| A Hostinger **VPS** (KVM 2: 2 vCPU, 8 GB, or larger) | LoyalFlow is one always-on Node.js process with a database file on disk |
| Access to the DNS of `loyalstring.com` | To point `flow.loyalstring.com` at the server |
| A mailbox such as `noreply@loyalstring.com` (Microsoft 365) | Password links and notifications; can be added later |

**Hostinger web hosting (Premium, Business, Cloud) will not do.** On those plans a Node.js app is stopped when nobody is using it, so the scheduler (SLA checks, nightly backup, Monday digest) would not run, the attendance machine could not push punches, and the start file must be `.js`. If the company account has only web hosting, add a VPS to the same account (hPanel → VPS → Get VPS). KVM 1 (4 GB) is enough for testing; use KVM 2 for the whole company.

## Part 1 — GitHub (10 minutes)
1. On github.com create a repository named `loyalflow`. Choose **Private**. Do not add a README, .gitignore or licence.
2. On the laptop install Git for Windows (git-scm.com) if it is not there, then in a terminal:
   ```bash
   cd %USERPROFILE%\Desktop\loyalflow
   git init -b main
   git add .
   git status
   ```
3. **Check before you commit.** `git status` must not list any of these (the `.gitignore` already leaves them out):
   - `data/` — the database, uploaded CVs and documents, backups, the session secret
   - `.env` — passwords and keys
   - `node_modules/`
   If any of them appears, stop and fix `.gitignore` first.
4. Commit and push:
   ```bash
   git commit -m "LoyalFlow v1.17.1"
   git remote add origin https://github.com/<account>/loyalflow.git
   git push -u origin main
   ```
5. In the repository's Settings → Collaborators, add only the people who should see the code.

Notes:
- The repository contains the company's employee names, designations and reporting lines (`src/db/seed-master.ts`). That is why it must stay private.
- GitHub will run the checks in `.github/workflows/ci.yml` on each push. The type check and the browser tests have not been run since the screens were redesigned, so the first run may show failures. That does not stop the server from running. Fix or switch off those two steps as you see fit; `npm test` (174 tests) passes.

## Part 2 — Hostinger VPS (30 minutes)
### 1. Create the server
- hPanel → VPS → set up. Location **India (Mumbai)**. Operating system **Ubuntu 24.04** (if a "with Docker" version is offered, take it).
- Set a root password or, better, add your SSH key.
- hPanel → VPS → Security → Firewall: allow inbound **22** (your office IP only, if it is fixed), **80** and **443**. Nothing else.
- Turn on the weekly backups Hostinger offers.

### 2. Point the address at it
In the DNS of `loyalstring.com` add an **A record**: `flow` → the VPS IP address. Wait until `ping flow.loyalstring.com` answers with that IP. HTTPS cannot be issued before this works.

### 3. Install Docker (skip if you chose the Docker image)
```bash
ssh root@<VPS IP>
apt update && apt -y upgrade
curl -fsSL https://get.docker.com | sh
adduser --disabled-password --gecos "" deploy && usermod -aG docker deploy
```

### 4. Get the code from GitHub
The repository is private, so give the server a read-only key:
```bash
su - deploy
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```
Copy the line it prints into GitHub → the repository → Settings → **Deploy keys** → Add deploy key (leave "Allow write access" off). Then:
```bash
sudo mkdir -p /opt/loyalflow && sudo chown deploy:deploy /opt/loyalflow   # run the sudo part as root if deploy has no sudo
cd /opt/loyalflow
git clone git@github.com:<account>/loyalflow.git .
cp .env.example .env
nano .env
```

### 5. Settings in `.env`
```
BASE_URL=https://flow.loyalstring.com
DOMAIN=flow.loyalstring.com
LOYALFLOW_DEMO=0
SESSION_SECRET=<paste the output of: openssl rand -base64 48>
SEED_PASSWORD=<a starter password you choose; everyone must change it at first sign-in>
MAIL_TRANSPORT=console
```
- `LOYALFLOW_DEMO=0` starts with the real employee list and **no sample data**. Use `1` only for a trial server.
- **Decide this before the first start.** The first start creates the database. Changing demo on or off later means deleting the data volume and starting again.
- Keep `MAIL_TRANSPORT=console` until the mailbox is ready, then follow section B of `docs/DEPLOY.md`.
- Never commit `.env`.

### 6. Start
```bash
docker compose up -d --build
docker compose logs -f loyalflow
```
Wait for "LoyalFlow listening". Open `https://flow.loyalstring.com`. The certificate is issued automatically on the first visit.

### 7. First sign-in
- Sign in as the COO or CEO with the starter password and change it.
- Settings → Administrators: name the administrator who will look after LoyalFlow.
- Settings → Targets: team managers set their monthly targets.
- Settings → General: company details, shifts, holidays. Settings → System: click "Back up now" once and confirm a file appears.

## Part 3 — Updating after a change
On the laptop (or wherever the change was made):
```bash
git add . && git commit -m "what changed" && git push
```
On the server:
```bash
cd /opt/loyalflow && git pull && docker compose up -d --build
```
The database is kept; new versions upgrade it themselves on start. Check `docker compose logs --tail 50 loyalflow` afterwards.

If you want the server to update itself on every push, add a GitHub Actions job that connects over SSH and runs the two commands above. Do this only after the manual way has worked a few times.

## Part 4 — Looking after it
- **Backups:** LoyalFlow writes a database backup every night at 02:00 into its data volume and keeps recent ones. That protects against mistakes, not against losing the server. Also keep Hostinger's weekly backup on, and set up `scripts/backup-offsite.sh` (see `docs/RUNBOOK.md`) to copy backups somewhere else.
- **Restore, logs, resetting a password, moving servers:** `docs/RUNBOOK.md`.
- **Security checklist:** `docs/SECURITY.md`. At minimum: SSH keys instead of passwords, firewall as above, `apt upgrade` monthly.
- **Health check:** `https://flow.loyalstring.com/health` answers `ok` when the app is up. Point any uptime monitor at it.

## Things that only work once it is hosted
- Links sent to customers (estimates) and candidates (assessments) open from outside the office.
- The ZKTeco attendance machine can push punches: set its server address to `flow.loyalstring.com` (People → Attendance → Punching machine shows the exact address and steps). This has not yet been tried with the real machine.
- Zoho Books and Blue Dart links, when they are built, need this public address.

## Not done yet (decide before go-live)
- Statutory payroll rates need the company's CA to confirm them before any live payroll run.
- The demo data on the laptop is not carried to the server. Real customers, open tickets and deals come in through Settings → General → Import data, or are typed in.
- Mail is switched off until the mailbox is set up, so password links appear only in the server log until then.
