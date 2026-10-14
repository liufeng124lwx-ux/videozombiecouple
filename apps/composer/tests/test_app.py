import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

import app as composer


@pytest.fixture()
def files(tmp_path, monkeypatch):
    """URLs are local paths; uploads land in tmp_path/uploads."""
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setattr(composer, "fetch_bytes", lambda url: Path(url).read_bytes())
    monkeypatch.setattr(composer, "fetch_to", lambda url, path: shutil.copy(url, path))
    monkeypatch.setattr(composer, "put_file", lambda url, path, ctype: shutil.copy(path, uploads / url))
    return tmp_path, uploads


def clip(path: Path, seconds: float, color: str) -> str:
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=c={color}:s=480x854:r=24:d={seconds}", "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )
    return str(path)


def tone(path: Path, seconds: float) -> str:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"sine=frequency=220:duration={seconds}", "-c:a", "aac", str(path)], check=True)
    return str(path)


def probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    w, h = out.split(",")
    return {"width": int(w), "height": int(h), "duration": composer.duration(path)}


def test_health():
    assert TestClient(composer.app).get("/health").json() == {"ok": True}


def test_compose_makes_a_12_second_720x1280_film_and_poster(files):
    tmp, uploads = files
    shots = [
        {"url": clip(tmp / "a.mp4", 4, "navy"), "seconds": 3, "grade": "cold"},
        {"url": clip(tmp / "b.mp4", 4, "gray"), "seconds": 2.5, "grade": "cold"},
        {"url": clip(tmp / "c.mp4", 4, "teal"), "seconds": 2.5, "grade": "cold"},
        {"url": clip(tmp / "d.mp4", 4, "orange"), "seconds": 3, "grade": "warm"},
    ]
    body = {
        "shots": shots,
        "musicUrl": tone(tmp / "m.m4a", 15),
        "caption": {"line1": "Even at the end of the world.", "line2": "Tom & Amy · 2019"},
        "outUrl": "video.mp4",
        "posterUrl": "poster.jpg",
    }
    res = TestClient(composer.app).post("/compose", json=body)
    assert res.status_code == 200, res.text
    info = probe(uploads / "video.mp4")
    assert info["width"] == 720 and info["height"] == 1280
    assert abs(info["duration"] - 12) < 0.3
    assert abs(res.json()["durationSec"] - 12) < 0.3
    assert (uploads / "poster.jpg").stat().st_size > 1000


def test_compose_rejects_unknown_grades(files):
    body = {"shots": [{"url": "x", "seconds": 1, "grade": "sepia"}], "musicUrl": "m", "caption": {"line1": "x"}, "outUrl": "o", "posterUrl": "p"}
    assert TestClient(composer.app).post("/compose", json=body).status_code == 400


def test_score_reports_missing_faces_without_crashing(files):
    import cv2

    tmp, _ = files
    blank = tmp / "blank.jpg"
    cv2.imwrite(str(blank), np.zeros((640, 360, 3), np.uint8))
    body = {
        "sources": {"survivor": str(blank), "infected": str(blank)},
        "candidates": [{"id": "kf:A:1", "url": str(blank), "frame": "A"}],
        "requiredFaces": {"A": ["infected"], "B": [], "C": []},
        "checkAge": True,
    }
    res = TestClient(composer.app).post("/score", json=body)
    assert res.status_code == 200
    assert res.json() == {"scores": {"kf:A:1": None}, "sourceFaces": {"survivor": False, "infected": False}, "minAge": None}
