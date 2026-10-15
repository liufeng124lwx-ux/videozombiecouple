#!/usr/bin/env bash
# Takes a film down now (Terms, "Report a video": within 48 hours of a report).
#   scripts/takedown.sh production 01M4ZWE4TRW0HHWNQW5R0EG5VP
# The story expires at once: its page and share link answer 404 immediately, and the cleanup cron
# deletes its photos, keyframes, shots and film from R2 and erases its runner within the hour.
set -euo pipefail
env="${1:-}"; id="${2:-}"
case "$env" in
  staging) config=wrangler.jsonc ;;
  production) config=wrangler.production.jsonc ;;
  *) echo "usage: $0 staging|production STORY_ID" >&2; exit 2 ;;
esac
[[ "$id" =~ ^[0-9A-HJKMNP-TV-Z]{26}$ ]] || { echo "not a story id: $id" >&2; exit 2; }
cd "$(dirname "$0")/../apps/api"
now=$(($(date +%s) * 1000))
pnpm --silent exec wrangler d1 execute DB --remote -c "$config" \
  --command "UPDATE stories SET expires_at=$now WHERE id='$id' AND status!='expired'" >/dev/null
echo "taken down: $id (files deleted by the next cleanup run)"
