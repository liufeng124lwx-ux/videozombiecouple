# /// script
# requires-python = ">=3.12"
# dependencies = ["insightface==0.7.3", "onnxruntime==1.20.1", "opencv-python-headless==4.10.0.84", "numpy<2.1"]
# ///
"""Face-identity scores for keyframes and shots; writes scores.json and picks.json.

usage: uv run eval/scripts/face_score.py eval/results/<run>
"""
import json
import statistics
import sys
from pathlib import Path

import cv2
import numpy as np
from insightface.app import FaceAnalysis

EVAL = Path(__file__).resolve().parent.parent
REQUIRED_KF = {"A": ["infected"], "B": ["survivor", "infected"], "C": ["survivor", "infected"]}
REQUIRED_SHOT = {1: ["infected"], 2: [], 3: ["survivor", "infected"], 4: ["survivor", "infected"]}


def rows(path: Path):
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def embeddings(app, img):
    if img is None:
        return []
    return [f.normed_embedding for f in app.get(img)]


def best_sim(faces, ref):
    if ref is None or not faces:
        return None
    return float(max(np.dot(f, ref) for f in faces))


def score_image(app, path, refs, required):
    """Max cosine per required identity; None when no face is found (never raises)."""
    faces = embeddings(app, cv2.imread(str(path)))
    sims = {who: best_sim(faces, refs.get(who)) for who in ("survivor", "infected")}
    vals = [sims[w] for w in required if sims[w] is not None]
    return sims, (sum(vals) / len(vals) if vals else None)


def score_video(app, path, refs, required):
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    per = {"survivor": [], "infected": []}
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if i % int(round(fps)) == 0:
            faces = embeddings(app, frame)
            for who in per:
                s = best_sim(faces, refs.get(who))
                if s is not None:
                    per[who].append(s)
        i += 1
    cap.release()
    sims = {w: (statistics.median(v) if v else None) for w, v in per.items()}
    vals = [sims[w] for w in required if sims[w] is not None]
    return sims, (sum(vals) / len(vals) if vals else None)


def main(run_dir: Path):
    app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
    app.prepare(ctx_id=-1, det_size=(640, 640))
    pairs = {p["id"]: p for p in json.loads((EVAL / "data" / "pairs.json").read_text())}

    refs = {}
    for pid, p in pairs.items():
        r = {}
        for who in ("survivor", "infected"):
            if p["kind"] == "pet" and who == "infected":
                continue  # animals are not scored with a human face model
            faces = embeddings(app, cv2.imread(str(EVAL / "data" / p[who])))
            r[who] = faces[0] if faces else None
            if r[who] is None:
                print(f"warning: no face in source {p[who]}")
        refs[pid] = r

    def req(pid, names):
        return [n for n in names if refs[pid].get(n) is not None]

    out = {"kf": [], "shots": []}
    for r in rows(run_dir / "kf" / "results.jsonl"):
        if r.get("status") != "succeeded":
            continue
        m = r["meta"]
        sims, score = score_image(app, r["outputs"][0], refs[m["pair"]], req(m["pair"], REQUIRED_KF[m["frame"]]))
        out["kf"].append({**{k: m[k] for k in ("model", "pair", "frame", "cand")}, "path": r["outputs"][0], **sims, "score": score})
    for r in rows(run_dir / "shots" / "results.jsonl"):
        if r.get("status") != "succeeded":
            continue
        m = r["meta"]
        sims, score = score_video(app, r["outputs"][0], refs[m["pair"]], req(m["pair"], REQUIRED_SHOT[m["shot"]]))
        out["shots"].append({**{k: m[k] for k in ("kfModel", "model", "pair", "shot")}, "path": r["outputs"][0], **sims, "score": score})

    picks: dict = {}
    for e in sorted(out["kf"], key=lambda e: e["cand"]):
        slot = picks.setdefault(e["pair"], {}).setdefault(e["model"], {})
        cur = slot.get(e["frame"])
        cur_score = next((x["score"] for x in out["kf"] if x["path"] == cur), None) if cur else None
        if cur is None or (e["score"] is not None and (cur_score is None or e["score"] > cur_score)):
            slot[e["frame"]] = e["path"]

    (run_dir / "scores.json").write_text(json.dumps(out, indent=1))
    (run_dir / "picks.json").write_text(json.dumps(picks, indent=1))
    none = sum(1 for e in out["kf"] + out["shots"] if e["score"] is None)
    print(f"scored {len(out['kf'])} keyframes, {len(out['shots'])} shots ({none} without a detectable face)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: uv run eval/scripts/face_score.py eval/results/<run>")
    main(Path(sys.argv[1]).resolve())
