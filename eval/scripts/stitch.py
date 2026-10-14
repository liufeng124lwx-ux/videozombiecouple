# /// script
# requires-python = ">=3.12"
# ///
"""Trim each shot to its target length and concatenate into one 9:16 clip per (kfModel, model, pair).

usage: uv run eval/scripts/stitch.py eval/results/<run>   (needs ffmpeg on PATH)
"""
import json
import shutil
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path


def main(run_dir: Path):
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not found: brew install ffmpeg")
    res = run_dir / "shots" / "results.jsonl"
    if not res.exists():
        sys.exit(f"no {res}")
    groups = defaultdict(dict)
    for line in res.read_text().splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        if r.get("status") == "succeeded":
            m = r["meta"]
            groups[(m["kfModel"], m["model"], m["pair"])][m["shot"]] = (r["outputs"][0], m["targetSec"])
    made = 0
    for (kf, model, pair), shots in sorted(groups.items()):
        if sorted(shots) != [1, 2, 3, 4]:
            print(f"skip {kf}-{model}/{pair}: shots {sorted(shots)} incomplete")
            continue
        out = run_dir / "stitched" / f"{kf}-{model}" / f"{pair}.mp4"
        out.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory() as tmp:
            parts = []
            for i in (1, 2, 3, 4):
                src, sec = shots[i]
                part = Path(tmp) / f"{i}.mp4"
                subprocess.run(
                    ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-t", str(sec),
                     "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=24",
                     "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(part)],
                    check=True,
                )
                parts.append(part)
            lst = Path(tmp) / "list.txt"
            lst.write_text("".join(f"file '{p}'\n" for p in parts))
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(out)], check=True)
        made += 1
    print(f"stitched {made} clips into {run_dir / 'stitched'}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: uv run eval/scripts/stitch.py eval/results/<run>")
    main(Path(sys.argv[1]).resolve())
