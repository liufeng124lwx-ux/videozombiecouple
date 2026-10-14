#!/usr/bin/env bash
# One-time Cloudflare setup for one environment (plan 7C). Run it yourself after `wrangler login`:
#   scripts/setup-cloudflare.sh staging
#   scripts/setup-cloudflare.sh production
# Safe to run again: resources that already exist are kept. It prints the ids to paste into
# apps/api/wrangler(.production).jsonc; it never reads or prints a secret.
set -euo pipefail

env="${1:-}"
case "$env" in
  staging) suffix="-staging"; origin="https://staging.videozombiecouple.com"; config=apps/api/wrangler.jsonc ;;
  production) suffix=""; origin="https://videozombiecouple.com"; config=apps/api/wrangler.production.jsonc ;;
  *) echo "usage: $0 staging|production" >&2; exit 2 ;;
esac
command -v jq >/dev/null || { echo "needs jq" >&2; exit 2; }

cd "$(dirname "$0")/.."
root="$(pwd)"
wr() { pnpm --silent --filter @vzc/api exec wrangler "$@"; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

db="vzc${suffix}"
bucket="vzc${suffix}"
kv="vzc${suffix}-kv"

# Each resource is created only when it is missing; any other failure (a timeout) stops the script.
echo "== D1 $db"
if wr d1 list --json | jq -e --arg n "$db" 'any(.[]; .name == $n)' >/dev/null; then echo "   (exists)"; else wr d1 create "$db" >/dev/null; fi
wr d1 list --json | jq -r --arg n "$db" '.[] | select(.name == $n) | "   database_id: \(.uuid)"'

echo "== KV $kv"
if wr kv namespace list | jq -e --arg n "$kv" 'any(.[]; .title == $n)' >/dev/null; then echo "   (exists)"; else wr kv namespace create "$kv" >/dev/null; fi
wr kv namespace list | jq -r --arg n "$kv" '.[] | select(.title == $n) | "   kv id: \(.id)"'

echo "== R2 $bucket"
if wr r2 bucket list | grep -qx "name: *$bucket"; then echo "   (exists)"; else wr r2 bucket create "$bucket" >/dev/null; fi
jq --arg o "$origin" '.rules[0].allowed.origins = [$o]' "$root/infra/r2-cors.json" >"$tmp/cors.json"
wr r2 bucket cors set "$bucket" --file "$tmp/cors.json" --force
wr r2 bucket lifecycle set "$bucket" --file "$root/infra/r2-lifecycle.json" --force

echo "== R2 vzc-backups (private, weekly D1 exports kept 12 weeks)"
if wr r2 bucket list | grep -qx "name: *vzc-backups"; then echo "   (exists)"; else wr r2 bucket create vzc-backups >/dev/null; fi
cat >"$tmp/backups.json" <<'JSON'
{ "rules": [ { "id": "keep-12-weeks", "enabled": true, "conditions": { "prefix": "" },
  "deleteObjectsTransition": { "condition": { "type": "Age", "maxAge": 7257600 } } } ] }
JSON
wr r2 bucket lifecycle set vzc-backups --file "$tmp/backups.json" --force

echo
echo "Next: paste the ids above into $config (and R2_ACCOUNT_ID), then run"
echo "  pnpm --filter @vzc/api exec wrangler d1 migrations apply DB --remote -c ${config#apps/api/}"
echo "and scripts/launch-secrets.sh $env to see which secrets are still missing."
