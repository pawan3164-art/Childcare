#!/usr/bin/env bash
# Deploy / update the pilot stack. Run on the VPS:
#   bash infra/prod/scripts/deploy.sh            # update
#   bash infra/prod/scripts/deploy.sh --seed     # also load DEMO data (first deploy only; WIPES data)
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || cp .env.prod.example .env

fill() { # fill KEY BYTES: set KEY in .env if empty
  if ! grep -Eq "^$1=.+" .env; then
    sed -i "s|^$1=.*|$1=$(openssl rand -hex "$2")|" .env
    echo "generated $1"
  fi
}
fill POSTGRES_PASSWORD 16
fill APP_DB_PASSWORD 16
fill JWT_SECRET 32
fill S3_ACCESS_KEY 8
fill S3_SECRET_KEY 24
chmod 600 .env

set -a; . ./.env; set +a

mkdir -p seaweedfs
cat > seaweedfs/s3.json <<JSON
{
  "identities": [
    {
      "name": "childcare-api",
      "credentials": [{ "accessKey": "${S3_ACCESS_KEY}", "secretKey": "${S3_SECRET_KEY}" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    }
  ]
}
JSON
chmod 644 seaweedfs/s3.json

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"

$COMPOSE build
$COMPOSE up -d postgres s3
$COMPOSE run --rm migrate
$COMPOSE exec -T postgres psql -U childcare -d childcare -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE childcare_app PASSWORD '${APP_DB_PASSWORD}';"
$COMPOSE run --rm storage-init

if [ "${1:-}" = "--seed" ]; then
  echo "Seeding demo data (this truncates all application tables)..."
  $COMPOSE run --rm migrate npx ts-node -r tsconfig-paths/register prisma/seed.ts
fi

$COMPOSE up -d api portal caddy
$COMPOSE ps
echo "Done. Check: curl -s https://api.${DOMAIN}/health"
