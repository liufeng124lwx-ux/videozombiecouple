"""Identity scoring (spec §4.2 S0b, S2). Face features live only in memory: never written or logged."""

import cv2
import numpy as np

_app = None


def face_app():
    global _app
    if _app is None:
        from insightface.app import FaceAnalysis

        _app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        _app.prepare(ctx_id=-1, det_size=(640, 640))
    return _app


def decode(data: bytes):
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)


def faces(img) -> list:
    if img is None:
        return []
    return face_app().get(img)


def best_sim(found: list, ref) -> float | None:
    if ref is None or not found:
        return None
    return float(max(np.dot(f.normed_embedding, ref.normed_embedding) for f in found))


def main_face(found: list):
    """The largest face: a source photo should show one person."""
    if not found:
        return None
    return max(found, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))


def score(sources: dict[str, bytes | None], candidates: list[dict], required: dict[str, list[str]], check_age: bool) -> dict:
    refs = {}
    source_faces: dict[str, bool | None] = {}
    ages = []
    for who in ("survivor", "infected"):
        data = sources.get(who)
        if data is None:
            refs[who] = None
            source_faces[who] = None
            continue
        face = main_face(faces(decode(data)))
        refs[who] = face
        source_faces[who] = face is not None
        if face is not None and check_age and getattr(face, "age", None) is not None:
            ages.append(float(face.age))
    scores: dict[str, float | None] = {}
    for c in candidates:
        found = faces(decode(c["bytes"]))
        need = [w for w in required.get(c["frame"], []) if refs.get(w) is not None]
        sims = [s for s in (best_sim(found, refs[w]) for w in need) if s is not None]
        scores[c["id"]] = sum(sims) / len(sims) if sims else None
    return {"scores": scores, "sourceFaces": source_faces, "minAge": min(ages) if ages else None}
