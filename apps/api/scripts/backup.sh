#!/bin/bash
# Nightly backup script for TangkayScan
# Intended to be run via crontab: 0 3 * * * /path/to/backup.sh >> /var/log/tangkayscan-backup.log 2>&1
set -euo pipefail

UPLOADS_DIR="${UPLOADS_DIR:-/var/www/tangkayscan/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/tangkayscan}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_PREFIX="[TangkayScan Backup $TIMESTAMP]"

mkdir -p "$BACKUP_DIR"
echo "$LOG_PREFIX Starting backup of $UPLOADS_DIR → $BACKUP_DIR"
rsync -a --delete "$UPLOADS_DIR/" "$BACKUP_DIR/uploads/"
echo "$LOG_PREFIX Backup complete"
