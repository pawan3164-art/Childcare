#!/usr/bin/env bash
# Nightly Postgres dump, keeping 14 days. Cron (as the deploy user):
#   0 2 * * * bash /opt/childcare/infra/prod/scripts/backup.sh >> /var/log/childcare-backup.log 2>&1
# Also copy /opt/childcare-backups off the VPS (rclone/scp); a backup on the same disk is not a backup.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=/opt/childcare-backups
mkdir -p "$DEST"
STAMP=$(date +%Y%m%d-%H%M%S)
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
  pg_dump -U childcare -d childcare --format=custom > "$DEST/childcare-$STAMP.dump"
find "$DEST" -name 'childcare-*.dump' -mtime +14 -delete
echo "$(date -Is) backup ok: childcare-$STAMP.dump"
