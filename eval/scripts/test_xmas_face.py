"""xmas_face.py pairing: one face per role, never the same face twice; a missing person is not a flip.

uv run --with insightface==0.7.3 --with onnxruntime==1.20.1 --with opencv-python-headless==4.10.0.84 \
  --with "numpy<2.1" --with pytest pytest eval/scripts/test_xmas_face.py
"""
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from xmas_face import EVAL, match_roles  # noqa: E402


def face(vec, size, gender):
    v = np.asarray(vec, dtype=float)
    return SimpleNamespace(normed_embedding=v / np.linalg.norm(v), bbox=[0, 0, size, size], gender=gender)


S = face([1, 0, 0], 100, 1)  # survivor photo: a man
I = face([0, 1, 0], 100, 0)  # infected photo: a woman
REFS = {"survivor": S, "infected": I}


def test_one_face_in_a_two_face_frame_is_a_missing_face_not_a_flip():
    sims, gender_ok, missing = match_roles([face([1, 0.1, 0], 80, 1)], REFS, ["survivor", "infected"])
    assert missing == 1
    assert gender_ok is None
    assert sims["survivor"] is not None and sims["infected"] is None


def test_two_faces_are_paired_one_to_one_by_the_higher_sum():
    # Both faces resemble the survivor more than the infected; independent best-match would give
    # the survivor's face to both roles. One-to-one keeps the man as survivor, the woman as infected.
    man = face([1, 0.2, 0], 90, 1)
    woman = face([0.8, 0.6, 0], 70, 0)
    sims, gender_ok, missing = match_roles([woman, man, face([0, 0, 1], 5, 1)], REFS, ["survivor", "infected"])
    assert missing == 0
    assert gender_ok is True
    assert sims["survivor"] == pytest.approx(float(np.dot(man.normed_embedding, S.normed_embedding)))
    assert sims["infected"] == pytest.approx(float(np.dot(woman.normed_embedding, I.normed_embedding)))


def test_swapped_genders_are_a_flip():
    # The survivor role lands on a woman's face (the people were swapped and re-gendered).
    sims, gender_ok, missing = match_roles([face([1, 0, 0], 90, 0), face([0, 1, 0], 80, 1)], REFS, ["survivor", "infected"])
    assert missing == 0 and gender_ok is False


def test_one_role_frame_takes_the_best_face():
    sims, gender_ok, missing = match_roles([face([0, 0, 1], 99, 1), face([0.1, 1, 0], 50, 0)], REFS, ["infected"])
    assert missing == 0 and gender_ok is True and sims["infected"] > 0.9


def test_real_photos_one_face_and_two_faces():
    cv2 = pytest.importorskip("cv2")
    pytest.importorskip("insightface")
    from xmas_face import face_app, main_face

    app = face_app()
    p = EVAL / "data" / "personas"
    sv, inf = cv2.imread(str(p / "p01-survivor.jpg")), cv2.imread(str(p / "p01-infected.jpg"))
    refs = {"survivor": main_face(app.get(sv)), "infected": main_face(app.get(inf))}
    sims, gender_ok, missing = match_roles(app.get(sv), refs, ["survivor", "infected"])
    assert missing == 1 and gender_ok is None
    both = np.hstack([inf, sv])  # infected on the left: order in the image must not matter
    sims, gender_ok, missing = match_roles(app.get(both), refs, ["survivor", "infected"])
    assert missing == 0 and gender_ok is True
    assert sims["survivor"] > 0.9 and sims["infected"] > 0.9
