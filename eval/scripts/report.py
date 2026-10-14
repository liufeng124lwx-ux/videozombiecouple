# /// script
# requires-python = ">=3.12"
# ///
"""Summary table + blind review page for one eval run.

usage: uv run eval/scripts/report.py eval/results/<run>
"""
import html
import json
import os
import random
import statistics
import sys
from collections import defaultdict
from pathlib import Path

EVAL = Path(__file__).resolve().parent.parent


def rows(path: Path):
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def pct(values, q):
    if not values:
        return None
    s = sorted(values)
    return s[min(len(s) - 1, int(round(q * (len(s) - 1))))]


def summary(stage, results, scores):
    by = defaultdict(list)
    for r in results:
        by[r["meta"]["model"]].append(r)
    sc = defaultdict(list)
    for s in scores:
        if s["score"] is not None:
            sc[s["model"]].append(s["score"])
    out = []
    for model, rs in sorted(by.items()):
        ok = [r for r in rs if r["status"] == "succeeded"]
        lat = [r.get("latencyMs", 0) / 1000 for r in ok]
        cost = [r.get("costUsd", 0) for r in rs]
        out.append(
            f"<tr><td>{stage}</td><td>{model}</td><td>{len(ok)}/{len(rs)}</td>"
            f"<td>${statistics.mean(cost):.3f}</td><td>{pct(lat, .5) or 0:.0f}s</td><td>{pct(lat, .9) or 0:.0f}s</td>"
            f"<td>{statistics.mean(sc[model]) if sc[model] else 0:.3f}</td></tr>"
        )
    return "".join(out)


def rel(run_dir, p):
    return html.escape(os.path.relpath(p, run_dir))


def rating(item_id):
    radios = "".join(f'<label><input type="radio" name="{item_id}" value="{n}">{n}</label>' for n in range(1, 6))
    return f'<div class="rate" data-id="{item_id}">{radios}<label><input type="checkbox" name="{item_id}-veto">⚠</label></div>'


def main(run_dir: Path):
    kf = rows(run_dir / "kf" / "results.jsonl")
    shots = rows(run_dir / "shots" / "results.jsonl")
    scores = json.loads((run_dir / "scores.json").read_text()) if (run_dir / "scores.json").exists() else {"kf": [], "shots": []}
    pairs = json.loads((EVAL / "data" / "pairs.json").read_text())

    models = sorted({r["meta"]["model"] for r in kf} | {f'{r["meta"]["kfModel"]}-{r["meta"]["model"]}' for r in shots})
    rng = random.Random(run_dir.name)
    shuffled = models[:]
    rng.shuffle(shuffled)
    blind = {m: f"M{i + 1}" for i, m in enumerate(shuffled)}
    (run_dir / "blind-key.json").write_text(json.dumps({v: k for k, v in blind.items()}, indent=1))

    body = [
        "<h1>Eval run " + html.escape(run_dir.name) + "</h1>",
        "<table><tr><th>stage</th><th>model</th><th>ok</th><th>avg $</th><th>p50</th><th>p90</th><th>avg face sim</th></tr>",
        summary("keyframe", kf, scores["kf"]),
        summary("shot", shots, scores["shots"]),
        "</table><p>Summary shows real model names; the sections below are blind (M1, M2…). Key: blind-key.json.</p>",
    ]
    for p in pairs:
        pid = p["id"]
        kf_items = [e for e in scores["kf"] if e["pair"] == pid]
        clips = sorted((run_dir / "stitched").glob(f"*/{pid}.mp4")) if (run_dir / "stitched").exists() else []
        if not kf_items and not clips:
            continue
        body.append(f'<h2>{pid}</h2><div class="src"><img src="{rel(run_dir, EVAL / "data" / p["survivor"])}"><img src="{rel(run_dir, EVAL / "data" / p["infected"])}"></div>')
        for frame in ("A", "B", "C"):
            items = [e for e in kf_items if e["frame"] == frame]
            if not items:
                continue
            rng.shuffle(items)
            cells = "".join(
                f'<figure><img src="{rel(run_dir, e["path"])}"><figcaption>{blind[e["model"]]} #{e["cand"]}</figcaption>'
                f'{rating(f"{pid}-{frame}-{blind[e["model"]]}-{e["cand"]}")}</figure>'
                for e in items
            )
            body.append(f"<h3>Keyframe {frame}</h3><div class=grid>{cells}</div>")
        if clips:
            rng.shuffle(clips)
            cells = "".join(
                f'<figure><video src="{rel(run_dir, c)}" controls loop playsinline></video><figcaption>{blind.get(c.parent.name, c.parent.name)}</figcaption>'
                f'{rating(f"{pid}-video-{blind.get(c.parent.name, c.parent.name)}")}</figure>'
                for c in clips
            )
            body.append(f"<h3>Videos</h3><div class=grid>{cells}</div>")

    page = f"""<!doctype html><meta charset=utf-8><title>Eval {html.escape(run_dir.name)}</title>
<style>body{{font:14px system-ui;margin:16px;background:#111;color:#eee}}table{{border-collapse:collapse}}td,th{{border:1px solid #444;padding:4px 8px}}
.grid{{display:flex;flex-wrap:wrap;gap:12px}}figure{{margin:0;width:220px}}img,video{{width:220px;border-radius:6px}}.src img{{width:120px;margin-right:8px}}
.rate label{{margin-right:6px}}button{{position:fixed;top:12px;right:12px;padding:8px 14px}}</style>
<button id=export>Export ratings.json</button>
{''.join(body)}
<script>
const KEY = "vzc-ratings-{html.escape(run_dir.name)}";
let saved = {{}};
try {{ saved = JSON.parse(localStorage.getItem(KEY) || "{{}}"); }} catch (e) {{}}
for (const el of document.querySelectorAll("input")) {{
  const v = saved[el.name];
  if (el.type === "radio" && v === el.value) el.checked = true;
  if (el.type === "checkbox" && v === true) el.checked = true;
  el.addEventListener("change", () => {{
    saved[el.name] = el.type === "checkbox" ? el.checked : el.value;
    try {{ localStorage.setItem(KEY, JSON.stringify(saved)); }} catch (e) {{}}
  }});
}}
document.getElementById("export").onclick = () => {{
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(saved, null, 1)], {{ type: "application/json" }}));
  a.download = "ratings.json";
  a.click();
}};
</script>"""
    (run_dir / "review.html").write_text(page)
    print(f"wrote {run_dir / 'review.html'}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: uv run eval/scripts/report.py eval/results/<run>")
    main(Path(sys.argv[1]).resolve())
