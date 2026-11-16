# Runbook

Day-to-day operation of LoyalFlow. Commands assume the Docker setup in `docs/DEPLOY.md` (`cd /opt/loyalflow`). Laptop equivalents use the same env vars with `node src/cli.ts …`.

## Daily / weekly rhythm (what the system does by itself)
| When | Job | What happens |
|---|---|---|
| every minute | SLA checks | warn assignee + lead at 50 % of the resolve clock; on breach tell the COO; auto-close tickets resolved 3+ days ago |
| every 15 min | KPI snapshot | stores this week's value of every KPI for company, departments and people (history for sparklines) |
| 06:00 IST | SOP generation | creates today's checklists for daily/weekly/monthly SOPs on working days |
| every 10 min | SOP escalation | overdue checklists: level 1 manager, level 2 HOD, level 3 COO (grace in Settings) |
| 02:00 IST | Backup | `VACUUM INTO /data/backups/loyalflow-<timestamp>.sqlite`, 30 kept |
| Monday 08:00 IST | Digest | company page as text to the CEO, COO and HODs (notification + email) |

Any of these can be run by hand from **Settings → System**.

## People
- **Add an employee**: People → *Add employee*. They get a password link by email (60 min). If mail is off, open their profile → *Reset password* and copy the link shown in the toast (demo) or use the CLI below.
- **Leaver**: People → profile → Edit → Status *Inactive*. Sign-in stops immediately; history stays.
- **Change a reporting line / role / department**: same edit screen; loops are refused; changes are audited.
- **Reset a password from the server**: `docker compose exec loyalflow node src/cli.ts set-password name@loyalstring.com 'New-Pass-123x'`
- **Locked out (5 wrong attempts)**: wait 15 minutes, or use the CLI above, or Forgot password.

## Thresholds and rules (Settings, admin only)
- **Roles**: who is CEO / COO / Sales Head / HR owner / Accounts owner / Production HOD. Routing and escalation follow these.
- **SLA**: response/resolve minutes per priority and calendar (business = support shift hours; always = 24×7). Changing it affects new tickets and priority changes.
- **Shifts & holidays**: days, start/end per shift; the holiday list (one date per line). Used by SLA clocks, SOP due times and the attendance export.
- **Approvals**: expense/purchase amounts, discount percentages, leave days.
- **SOPs, production, leave**: grace before escalation, default lead time, QC stage on/off, leave quotas.

## Backups and restore
- Nightly file in the data volume: `docker volume inspect loyalflow_loyalflow-data` → mountpoint → `backups/`.
- Off-site copy: `scripts/backup-offsite.sh` (rclone). Test a restore once a quarter.
- **Restore**:
  ```bash
  docker compose stop loyalflow
  VOL=$(docker volume inspect loyalflow_loyalflow-data -f '{{.Mountpoint}}')
  sudo cp $VOL/backups/loyalflow-2026-11-02T02-00-00.sqlite $VOL/loyalflow.sqlite
  sudo rm -f $VOL/loyalflow.sqlite-wal $VOL/loyalflow.sqlite-shm
  docker compose start loyalflow
  ```
- Uploaded dispatch photos live in `uploads/` next to the database; include that folder in off-site copies if photos matter.

## Troubleshooting
| Symptom | Check |
|---|---|
| Site not reachable | `docker compose ps` (both containers up?), `docker compose logs caddy` (certificate issued? DNS must point at the server), firewall 80/443 |
| "Something went wrong" page | `docker compose logs --tail=200 loyalflow` — the request id on the page matches the log line |
| Emails not arriving | Settings → System shows the mail transport; `MAIL_TRANSPORT=smtp` set? SMTP AUTH enabled on the mailbox? Logs show `[mail:smtp]` errors |
| No SOP checklists today | Is today a working day for that department's shift and not a holiday? Settings → System → *Generate today's SOPs* |
| KPI shows "–" | Manual KPI not entered this week (owner enters on the KPI page), or no data in the period |
| Slow page | Logs print any request over 500 ms; check disk space (`df -h`) and database size (Settings → System) |
| Forgot admin password | CLI `set-password` as above |

## Data retention and growth
Tickets, deals, orders, SOP runs and audit entries are kept indefinitely (the database grows ~10–30 MB/year at current volumes). KPI snapshots are one row per KPI, scope and week. Notifications older than needed can be purged with SQL if ever wanted; nothing depends on them.

## Upgrades
See `docs/DEPLOY.md §7`. Migrations run at start and are logged; a backup is taken nightly, but take one before an upgrade: Settings → System → *Back up now*.
