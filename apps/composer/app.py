"""VideoZombieCouple composer: POST /score and POST /compose (spec §3, §4.2). Stateless.

Inputs and outputs travel through short-lived signed R2 URLs; nothing is kept after a request.
"""

import json
import subprocess
import tempfile
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from caption import render_caption
from grade import Part, build_compose_cmd, build_poster_cmd

app = FastAPI()
TIMEOUT = httpx.Timeout(60.0)


def fetch_bytes(url: str) -> bytes:
    with httpx.Client(timeout=TIMEOUT, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        return r.content


def fetch_to(url: str, path: Path) -> None:
    path.write_bytes(fetch_bytes(url))


def put_file(url: str, path: Path, content_type: str) -> None:
    with httpx.Client(timeout=TIMEOUT) as client:
        r = client.put(url, content=path.read_bytes(), headers={"content-type": content_type})
        r.raise_for_status()


def duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(json.loads(out.stdout)["format"]["duration"])


class Candidate(BaseModel):
    id: str
    url: str
    frame: str


class Sources(BaseModel):
    survivor: str
    infected: str | None = None


class ScoreBody(BaseModel):
    sources: Sources
    candidates: list[Candidate]
    requiredFaces: dict[str, list[str]]
    checkAge: bool = True


class Shot(BaseModel):
    url: str
    seconds: float
    grade: str


class Caption(BaseModel):
    line1: str
    line2: str | None = None


class ComposeBody(BaseModel):
    shots: list[Shot]
    musicUrl: str
    caption: Caption
    outUrl: str
    posterUrl: str


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/score")
def score_route(body: ScoreBody):
    from score import score

    sources = {
        "survivor": fetch_bytes(body.sources.survivor),
        "infected": fetch_bytes(body.sources.infected) if body.sources.infected else None,
    }
    candidates = [{"id": c.id, "frame": c.frame, "bytes": fetch_bytes(c.url)} for c in body.candidates]
    return score(sources, candidates, body.requiredFaces, body.checkAge)


@app.post("/compose")
def compose_route(body: ComposeBody):
    if not body.shots or any(s.grade not in ("cold", "warm") for s in body.shots):
        raise HTTPException(400, "bad shots")
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        parts = []
        for i, s in enumerate(body.shots):
            p = d / f"shot{i + 1}.mp4"
            fetch_to(s.url, p)
            parts.append(Part(str(p), s.seconds, s.grade))
        music = d / "music.m4a"
        fetch_to(body.musicUrl, music)
        cap = render_caption(body.caption.line1, body.caption.line2, str(d / "caption.png"))
        out = d / "video.mp4"
        poster = d / "poster.jpg"
        subprocess.run(build_compose_cmd(parts, str(music), cap, str(out)), check=True)
        subprocess.run(build_poster_cmd(str(out), parts, str(poster)), check=True)
        put_file(body.outUrl, out, "video/mp4")
        put_file(body.posterUrl, poster, "image/jpeg")
        return {"ok": True, "durationSec": round(duration(out), 2)}
