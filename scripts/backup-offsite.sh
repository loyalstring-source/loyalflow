#!/usr/bin/env bash
# Copy the newest database backup off the server. Run from cron on the server, e.g. daily at 03:00:
#   0 3 * * * /opt/loyalflow/scripts/backup-offsite.sh >> /var/log/loyalflow-backup.log 2>&1
# Requires rclone configured with a remote named "offsite" (DigitalOcean Spaces, OneDrive, Google Drive all work).
set -e
VOLUME=$(docker volume inspect loyalflow_loyalflow-data -f '{{.Mountpoint}}')
LATEST=$(ls -t "$VOLUME"/backups/*.sqlite | head -1)
echo "$(date -Is) uploading $LATEST"
rclone copy "$LATEST" offsite:loyalflow-backups/
rclone delete --min-age 60d offsite:loyalflow-backups/
