# /// script
# requires-python = ">=3.12"
# dependencies = ["insightface==0.7.3", "onnxruntime==1.20.1", "opencv-python-headless==4.10.0.84", "numpy<2.1"]
# ///
"""Christmas keyframes: identity and gender against each pair's own photos (christmas content spec §5).

usage: uv run eval/scripts/xmas_face.py eval/results/<run>

Finds <run>/kf/<scene>/<pair>/<frame>[-<cand>].jpg (run-xmas-keyframes.ts) and
<run>/films/<scene>/<pair>/frames/<frame>.jpg (run-staging-films.ts). Which faces each frame must
show comes from the catalog's CHRISTMAS.keyframes[].faces. Writes:
  faces.csv          frame, pair, sim_survivor, sim_infected, gender_ok (+ scene, cand, score, selected, file)
  xmas-picks.json    per scene/pair/frame, the best-scoring candidate (same rule as the composer)
  faces-summary.json gender flips and per-frame similarity medians
Face features live only in this process's memory: never written, never printed.
"""
import csv
import json
import re
import statistics
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from insightface.app import FaceAnalysis

EVAL = Path(__file__).resolve().parent.parent
ROOT = EVAL.parent
CATALOG = ROOT / "packages" / "catalog" / "src" / "stories" / "christmas.ts"
PAIR = re.compile(r"^[pq]\d\d$")
STEM = re.compile(r"^([A-Za-z]+)(?:-(\d+))?$")


def christmas():
    """{frame: [roles]} and the scene ids, read from the catalog by Node (one source of truth)."""
    js = (
        f"const {{ CHRISTMAS }} = await import({json.dumps(CATALOG.as_uri())});"
        "console.log(JSON.stringify({faces: Object.fromEntries(CHRISTMAS.keyframes.map(k => [k.id, k.faces])),"
        " scenes: Object.keys(CHRISTMAS.scenes)}));"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, check=True).stdout
    data = json.loads(out.strip().splitlines()[-1])
    return data["faces"], set(data["scenes"])


def main_face(found):
    if not found:
        return None
    return max(found, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))


def frames_in(run_dir: Path, faces: dict, scenes: set):
    """(scene, pair, frame, cand, path, selected-by-construction) for every Christmas frame found."""
    for path in sorted(run_dir.rglob("*.jpg")):
        parts = path.relative_to(run_dir).parts
        if parts[0] not in ("kf", "films"):
            continue
        idx = next((i for i, p in enumerate(parts) if PAIR.match(p)), None)
        m = STEM.match(path.stem)
        if idx is None or idx == 0 or not m or m.group(1) not in faces or parts[idx - 1] not in scenes:
            continue
        cand = int(m.group(2)) if m.group(2) else None
        yield parts[idx - 1], parts[idx], m.group(1), cand, path, parts[0] == "films"


def main(run_dir: Path):
    faces_of, scenes = christmas()
    app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
    app.prepare(ctx_id=-1, det_size=(640, 640))
    pairs = {p["id"]: p for p in json.loads((EVAL / "data" / "pairs.json").read_text())}

    refs: dict = {}  # pair -> role -> insightface Face (memory only)

    def ref(pair: str, role: str):
        if pair not in refs:
            refs[pair] = {}
            for who in ("survivor", "infected"):
                found = app.get(cv2.imread(str(EVAL / "data" / pairs[pair][who])))
                refs[pair][who] = main_face(found)
                if refs[pair][who] is None:
                    print(f"warning: no face in the {who} photo of {pair}")
        return refs[pair][role]

    rows = []
    for scene, pair, frame, cand, path, from_film in frames_in(run_dir, faces_of, scenes):
        if pair not in pairs:
            continue
        found = app.get(cv2.imread(str(path))) or []
        sims: dict = {}
        genders: list = []
        for role in faces_of[frame]:
            r = ref(pair, role)
            if r is None or not found:
                sims[role] = None
                continue
            scored = [(float(np.dot(f.normed_embedding, r.normed_embedding)), f) for f in found]
            best, face = max(scored, key=lambda x: x[0])
            sims[role] = best
            genders.append(int(face.gender) == int(r.gender))
        vals = [v for v in sims.values() if v is not None]
        rows.append({
            "scene": scene,
            "frame": frame,
            "cand": cand if cand is not None else "",
            "pair": pair,
            "sim_survivor": sims.get("survivor"),
            "sim_infected": sims.get("infected"),
            "score": sum(vals) / len(vals) if vals else None,
            "gender_ok": (all(genders) if len(genders) == len(faces_of[frame]) else None) if faces_of[frame] else "",
            "selected": from_film,
            "file": str(path.relative_to(run_dir)),
        })

    # The composer's rule: the highest mean similarity wins; a candidate without a face loses.
    picks: dict = {}
    for r in rows:
        if r["file"].startswith("films"):
            continue
        slot = picks.setdefault(r["scene"], {}).setdefault(r["pair"], {})
        cur = slot.get(r["frame"])
        cur_row = next((x for x in rows if x["file"] == cur["file"]), None) if cur else None
        if cur_row is None or (r["score"] is not None and (cur_row["score"] is None or r["score"] > cur_row["score"])):
            slot[r["frame"]] = {"file": r["file"]}
    chosen = {v["file"] for s in picks.values() for p in s.values() for v in p.values()}
    for r in rows:
        r["selected"] = r["selected"] or r["file"] in chosen

    with (run_dir / "faces.csv").open("w", newline="") as fh:
        cols = ["frame", "pair", "sim_survivor", "sim_infected", "gender_ok", "scene", "cand", "score", "selected", "file"]
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r[k] is None else (f"{r[k]:.4f}" if isinstance(r[k], float) else r[k])) for k in cols})
    (run_dir / "xmas-picks.json").write_text(json.dumps(
        {s: {p: {f: str(run_dir / v["file"]) for f, v in fr.items()} for p, fr in ps.items()} for s, ps in picks.items()}, indent=1))

    sel = [r for r in rows if r["selected"]]
    summary: dict = {"frames": len(rows), "selected": len(sel), "gender_flips_selected": sum(1 for r in sel if r["gender_ok"] is False),
                     "gender_flips_all": sum(1 for r in rows if r["gender_ok"] is False),
                     "no_face_selected": sum(1 for r in sel if r["score"] is None), "median": {}}
    for scene in sorted({r["scene"] for r in sel}):
        per: dict = {}
        for frame in faces_of:
            here = [r for r in sel if r["scene"] == scene and r["frame"] == frame]
            if not here:
                continue
            per[frame] = {role: (round(statistics.median(v), 4) if (v := [r[f"sim_{role}"] for r in here if r[f"sim_{role}"] is not None]) else None)
                          for role in faces_of[frame]}
        summary["median"][scene] = per
    (run_dir / "faces-summary.json").write_text(json.dumps(summary, indent=1))

    print(f"{len(rows)} frames scored, {len(sel)} selected; gender flipped in {summary['gender_flips_selected']} selected frames"
          f" ({summary['gender_flips_all']} of all); {summary['no_face_selected']} selected frames without a detectable face")
    for scene, per in summary["median"].items():
        print(f"  {scene}: " + "; ".join(f"{f} " + "/".join(f"{k[0]}={v}" for k, v in m.items()) for f, m in per.items()))
    print("acceptance (spec §5): 0 gender flips in selected frames; memory median ≥ 0.6; aged frames recorded only")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: uv run eval/scripts/xmas_face.py eval/results/<run>")
    main(Path(sys.argv[1]).resolve())
