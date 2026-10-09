# Pilot deployment on a Hostinger VPS (justforfewtests.in)

Single-VPS pilot. Not production: no DR, and the VPS is probably not in an Australian region (BRD §18 / APP 8). Use demo or synthetic data only unless that is resolved. CCS and payments stay mocked.

## 1. DNS (at your domain registrar)
Create three A records pointing at the VPS IPv4 address:
`api.justforfewtests.in`, `portal.justforfewtests.in`, `media.justforfewtests.in`.

## 2. VPS setup (Ubuntu 22.04/24.04 with Docker, e.g. Hostinger's Docker template)
```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable   # nothing else is public
git clone <your-repo-url> /opt/childcare && cd /opt/childcare
git checkout owna-gap-closure          # or main once merged
cp infra/prod/.env.example infra/prod/.env
nano infra/prod/.env                   # set ACME_EMAIL; leave secrets blank
bash infra/prod/scripts/deploy.sh --seed   # --seed loads DEMO data; omit on later runs
curl -s https://api.justforfewtests.in/health
```
Secrets are generated on first run and stored in `infra/prod/.env` (chmod 600, gitignored). Keep a copy somewhere safe: losing `POSTGRES_PASSWORD` or the S3 keys means losing access to the data volumes.

Demo logins are printed by the seed script. They use a published password, so do not leave `--seed` data on a server real families can reach.

## 3. Updates
`git pull && bash infra/prod/scripts/deploy.sh`

## 4. Backups
Add the cron line from `infra/prod/scripts/backup.sh`, and copy `/opt/childcare-backups` off the VPS. Photos live in the `s3_data` Docker volume and are not covered by `pg_dump`.

## 5. Mobile apps (educator app exists; parent app is not scaffolded yet, U3)
Both iOS and Android use EAS (`apps/educator-mobile/eas.json`, API URL baked in):
```bash
npm i -g eas-cli && eas login
cd apps/educator-mobile
eas build --profile preview --platform android   # .apk install link
eas device:create && eas build --profile preview --platform ios   # ad hoc, needs Apple Developer account
```
For iOS at larger scale use TestFlight (`--profile production` + `eas submit`).

## Why media.justforfewtests.in exists
Photo URLs are presigned against `S3_ENDPOINT`, and the signature is bound to that hostname. It must be a public HTTPS name the phones can reach, so Caddy proxies it to the private bucket. Requests without a valid signature are rejected.
