# /// script
# requires-python = ">=3.12"
# dependencies = ["insightface==0.7.3", "onnxruntime==1.20.1", "opencv-python-headless==4.10.0.84", "numpy<2.1"]
# ///
"""Christmas keyframes: identity and gender against each pair's own photos (christmas content spec §5).

usage: uv run eval/scripts/xmas_face.py eval/results/<run>

Finds <run>/kf/<scene>/<pair>/<frame>[-<cand>].jpg (run-xmas-keyframes.ts) and
<run>/films/<scene>/<pair>/frames/<frame>.jpg (run-staging-films.ts). Which faces each frame must
show comes from the catalog's CHRISTMAS.keyframes[].faces. Writes:
  faces.csv          frame, pair, sim_survivor, sim_infected, gender_ok (+ missing, scene, cand, score, selected, file)
  xmas-picks.json    per scene/pair/frame, the best-scoring candidate (same rule as the composer)
  faces-summary.json gender flips, frames missing a person (not flips), per-frame similarity medians
Face features live only in this process's memory: never written, never printed.
"""
import csv
import json
import re
import statistics
import subprocess
import sys
from pathlib import Path

import numpy as np

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


_app = None


def face_app():
    """insightface, loaded on first use (the pairing logic is testable without it)."""
    global _app
    if _app is None:
        from insightface.app import FaceAnalysis

        _app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        _app.prepare(ctx_id=-1, det_size=(640, 640))
    return _app


def area(f):
    return (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1])


def sim(f, r) -> float:
    return float(np.dot(f.normed_embedding, r.normed_embedding))


def match_roles(found, refs, roles):
    """One face per role, never the same face for two roles.

    One role: the best-matching face. Two roles: the two largest faces, both assignments tried, the
    higher summed similarity kept; with fewer than two faces, the face goes to the role it matches
    best and the other role is missing. Returns (sims, gender_ok, missing): a missing role has
    sim None and makes gender_ok None — it is counted as missing, never as a gender flip.
    """
    roles = [r for r in roles if refs.get(r) is not None]
    sims = {r: None for r in roles}
    chosen = {}
    if len(roles) == 1 and found:
        chosen[roles[0]] = max(found, key=lambda f: sim(f, refs[roles[0]]))
    elif len(roles) == 2:
        a, b = roles
        top = sorted(found, key=area, reverse=True)[:2]
        if len(top) == 2:
            x, y = top
            straight = sim(x, refs[a]) + sim(y, refs[b])
            crossed = sim(y, refs[a]) + sim(x, refs[b])
            chosen = {a: x, b: y} if straight >= crossed else {a: y, b: x}
        elif len(top) == 1:
            f = top[0]
            chosen[a if sim(f, refs[a]) >= sim(f, refs[b]) else b] = f
    for r, f in chosen.items():
        sims[r] = sim(f, refs[r])
    missing = len(roles) - len(chosen)
    gender_ok = None if missing or not roles else all(int(f.gender) == int(refs[r].gender) for r, f in chosen.items())
    return sims, gender_ok, missing


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
    import cv2

    faces_of, scenes = christmas()
    app = face_app()
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
        img = cv2.imread(str(path))
        if img is None:  # a truncated download: report it, don't stop the whole run
            print(f"warning: cannot read {path}; skipped")
            continue
        found = app.get(img) or []
        sims, gender_ok, missing = match_roles(found, {role: ref(pair, role) for role in faces_of[frame]}, faces_of[frame])
        vals = [v for v in sims.values() if v is not None]
        rows.append({
            "scene": scene,
            "frame": frame,
            "cand": cand if cand is not None else "",
            "pair": pair,
            "sim_survivor": sims.get("survivor"),
            "sim_infected": sims.get("infected"),
            "score": sum(vals) / len(vals) if vals else None,
            "gender_ok": gender_ok,
            "missing": missing,
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
        cols = ["frame", "pair", "sim_survivor", "sim_infected", "gender_ok", "missing", "scene", "cand", "score", "selected", "file"]
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r[k] is None else (f"{r[k]:.4f}" if isinstance(r[k], float) else r[k])) for k in cols})
    (run_dir / "xmas-picks.json").write_text(json.dumps(
        {s: {p: {f: str(run_dir / v["file"]) for f, v in fr.items()} for p, fr in ps.items()} for s, ps in picks.items()}, indent=1))

    sel = [r for r in rows if r["selected"]]
    summary: dict = {"frames": len(rows), "selected": len(sel), "gender_flips_selected": sum(1 for r in sel if r["gender_ok"] is False),
                     "gender_flips_all": sum(1 for r in rows if r["gender_ok"] is False),
                     "missing_face_selected": sum(1 for r in sel if r["missing"]),
                     "missing_face_all": sum(1 for r in rows if r["missing"]), "median": {}}
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
          f" ({summary['gender_flips_all']} of all); a person missing in {summary['missing_face_selected']} selected frames"
          f" ({summary['missing_face_all']} of all) — missing is not counted as a flip")
    for scene, per in summary["median"].items():
        print(f"  {scene}: " + "; ".join(f"{f} " + "/".join(f"{k[0]}={v}" for k, v in m.items()) for f, m in per.items()))
    print("acceptance (spec §5): 0 gender flips in selected frames; memory median ≥ 0.6; aged frames recorded only")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: uv run eval/scripts/xmas_face.py eval/results/<run>")
    main(Path(sys.argv[1]).resolve())
