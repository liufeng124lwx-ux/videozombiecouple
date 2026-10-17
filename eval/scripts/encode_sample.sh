#!/usr/bin/env bash
# Encode a finished eval film into the web sample set.
# Usage: eval/scripts/encode_sample.sh <film.mp4> <id>
# Writes apps/web/public/samples/films/<id>.mp4 (whole film, 540x960 H.264 CRF 26 capped at 900 kbit/s, faststart, <= 4 MB),
# <id>-loop.mp4 (silent 4 s around the memory cut at 0:20, <= 250 KB) and
# apps/web/src/assets/samples/film-<id>-poster.jpg (1 s) and -memory.jpg (21 s).
set -euo pipefail

src="${1:?usage: encode_sample.sh <film.mp4> <id>}"
id="${2:?usage: encode_sample.sh <film.mp4> <id>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
films="$root/apps/web/public/samples/films"
assets="$root/apps/web/src/assets/samples"
scale="scale=540:960:flags=lanczos"

mkdir -p "$films" "$assets"
ffmpeg -y -loglevel error -i "$src" -vf "$scale" -c:v libx264 -preset slow -crf 26 -maxrate 900k -bufsize 1800k -pix_fmt yuv420p \
  -c:a aac -b:a 80k -movflags +faststart "$films/$id.mp4"
ffmpeg -y -loglevel error -ss 18 -t 4 -i "$src" -an -vf "$scale" -c:v libx264 -preset slow -crf 30 -maxrate 450k -bufsize 900k \
  -pix_fmt yuv420p -movflags +faststart "$films/$id-loop.mp4"
ffmpeg -y -loglevel error -ss 1 -i "$src" -frames:v 1 -q:v 3 "$assets/film-$id-poster.jpg"
ffmpeg -y -loglevel error -ss 21 -i "$src" -frames:v 1 -q:v 3 "$assets/film-$id-memory.jpg"

for f in "$films/$id.mp4" "$films/$id-loop.mp4"; do
  printf '%s %s bytes\n' "$f" "$(wc -c <"$f" | tr -d ' ')"
done
