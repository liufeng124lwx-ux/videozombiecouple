#!/usr/bin/env bash
# Deploy one environment from this machine (until CI has a Cloudflare token):
#   scripts/deploy.sh staging
#   scripts/deploy.sh production
# Order: D1 migrations → model routes → scene music to R2 → API (+ composer container) → secrets →
# site build → site deploy → smoke check. Secrets come from ~/.vzc-secrets and only travel through
# pipes; nothing is printed. Uses the wrangler login on this machine.
set -euo pipefail

env="${1:-}"
case "$env" in
  staging)
    api_config=wrangler.jsonc; web_config=wrangler.jsonc; db=vzc-staging; bucket=vzc-staging
    api_origin=https://api-staging.videozombiecouple.com; site_origin=https://staging.videozombiecouple.com
    build=build ;;
  production)
    api_config=wrangler.production.jsonc; web_config=wrangler.production.jsonc; db=vzc; bucket=vzc
    api_origin=https://api.videozombiecouple.com; site_origin=https://videozombiecouple.com
    build=build:production ;;
  *) echo "usage: $0 staging|production" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."
root="$(pwd)"
secrets="$HOME/.vzc-secrets"
# Every step is idempotent; retry the Cloudflare API's occasional "fetch failed".
retry() { local n; for n in 1 2 3; do "$@" && return 0; echo "   (attempt $n failed, retrying)" >&2; sleep $((n * 5)); done; return 1; }
api() { retry sh -c 'cd "$0/apps/api" && pnpm --silent exec wrangler "$@"' "$root" "$@"; }
web() { retry sh -c 'cd "$0/apps/web" && pnpm --silent exec wrangler "$@"' "$root" "$@"; }
value() { grep -E "^$1=" "$2" | head -1 | cut -d= -f2-; }

# One HMAC key per environment, made once and kept.
hmac_file="$secrets/hmac-$env"
[ -s "$hmac_file" ] || { openssl rand -hex 32 >"$hmac_file"; chmod 600 "$hmac_file"; }

echo "== D1 migrations ($db)"
api d1 migrations apply DB --remote -c "$api_config"

echo "== model routes"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
(cd apps/api && pnpm --silent exec tsx scripts/route-sync.ts "$tmp/routes.sql")
api d1 execute DB --remote -c "$api_config" --file "$tmp/routes.sql" >/dev/null

echo "== scene music → r2://$bucket/assets/music/"
for f in assets/music/*.m4a; do
  api r2 object put "$bucket/assets/music/$(basename "$f")" --file "$root/$f" --content-type audio/mp4 --remote >/dev/null
done

echo "== API worker + composer container"
api deploy -c "$api_config"

echo "== secrets (piped)"
# Python reads the secret files itself: no secret value ever appears in a process's arguments.
python3 - "$hmac_file" "$secrets/eval.env" "$secrets/turnstile.env" >"$tmp/secrets.json" <<'PY'
import json, sys
def value(path, name):
    for line in open(path):
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip()
    sys.exit(f"missing {name} in {path}")
print(json.dumps({
    "HMAC_KEY": open(sys.argv[1]).read().strip(),
    "KIE_API_KEY": value(sys.argv[2], "KIE_API_KEY"),
    "TURNSTILE_SECRET": value(sys.argv[3], "TURNSTILE_SECRET"),
}))
PY
chmod 600 "$tmp/secrets.json"
api secret bulk "$tmp/secrets.json" -c "$api_config" >/dev/null
rm -f "$tmp/secrets.json"

echo "== site"
site_key="$(value TURNSTILE_SITE_KEY "$secrets/turnstile.env")"
(cd apps/web && PUBLIC_API_ORIGIN="$api_origin" PUBLIC_SITE_ORIGIN="$site_origin" \
  PUBLIC_TURNSTILE_SITE_KEY="$site_key" pnpm --silent "$build" >/dev/null)
web deploy -c "$web_config"

echo "== smoke"
curl -fsS "$api_origin/health" && echo
curl -fsS -o /dev/null -w "site %{http_code}\n" "$site_origin/"
