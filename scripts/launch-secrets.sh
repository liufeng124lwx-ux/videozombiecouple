#!/usr/bin/env bash
# Spec 8.5: the full list of secrets per environment, and which are still missing. It only reads
# secret NAMES from `wrangler secret list`; values are never read or printed.
#   scripts/launch-secrets.sh staging|production
set -euo pipefail

case "${1:-}" in
  staging) config=wrangler.jsonc; ONLY_HERE=(SMOKE_KEY) ;;
  production) config=wrangler.production.jsonc; ONLY_HERE=(CF_ANALYTICS_TOKEN) ;;
  *) echo "usage: $0 staging|production" >&2; exit 2 ;;
esac

# Required for the API to run.
REQUIRED=(
  HMAC_KEY TURNSTILE_SECRET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY KIE_API_KEY
  GOOGLE_CLIENT_SECRET WAFFO_PRIVATE_KEY GA4_API_SECRET
)
# Alerts (spec 8.3), errors (8.4) and the admin (8.1): the API runs without them, but launch needs them.
LAUNCH=(
  TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID ALERT_EMAIL SENTRY_DSN
  ACCESS_TEAM_DOMAIN ACCESS_AUD ADMIN_EMAILS
)

cd "$(dirname "$0")/../apps/api"
have="$(pnpm --silent exec wrangler secret list -c "$config" --format json | jq -r '.[].name')"
missing=0
# CF_ANALYTICS_TOKEN (production only): read-only token for the weekly Cloudflare usage report.
# SMOKE_KEY (staging only, 32+ random characters) lets the post-deploy smoke run one real job;
# the same value goes into the GitHub secret STAGING_SMOKE_KEY. Production ignores it.
for name in "${REQUIRED[@]}" "${LAUNCH[@]}" ${ONLY_HERE[@]+"${ONLY_HERE[@]}"}; do
  if grep -qx "$name" <<<"$have"; then echo "  ok       $name"; else echo "  MISSING  $name"; missing=$((missing + 1)); fi
done
# The smoke key skips Turnstile; it must never exist in production (human-pass.ts ignores it there too).
if [ "$1" = production ] && grep -qx SMOKE_KEY <<<"$have"; then
  echo "  REMOVE   SMOKE_KEY (staging only): wrangler secret delete SMOKE_KEY -c $config"
  missing=$((missing + 1))
fi
echo
if [ "$missing" -eq 0 ]; then echo "All secrets set for $1."; else echo "$missing to fix for $1: wrangler secret put <NAME> -c $config"; exit 1; fi
