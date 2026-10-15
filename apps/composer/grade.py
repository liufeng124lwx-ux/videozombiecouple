"""ffmpeg command builders for the story film (spec §4.2 S5, §5.1).

Shots are cut to their storyboard length, scaled to 720x1280 at 24 fps and graded cold (standoff),
warm (memory) or dawn (the ending back in the ruins). The last frame is held for one more second
while the end title fades in over it; light film grain over everything; the scene music is trimmed
to the film and fades out gently.
"""

from dataclasses import dataclass

WIDTH, HEIGHT, FPS = 720, 1280, 24
# The last frame is held this long after the final shot, under the title.
CAPTION_SEC = 1
# The title fades in over this long, ending this long before the film ends.
TITLE_FADE_SEC = 0.8
TITLE_LEAD_SEC = 1.6
FADE_OUT_SEC = 2

GRADES = {
    "cold": "eq=saturation=0.72:contrast=1.06,colorbalance=bs=0.10:bm=0.06:bh=0.04:rs=-0.04",
    "warm": "eq=saturation=1.08,colorbalance=rs=0.08:rm=0.03:bs=-0.06",
    # First light in the ruins: still cool in the shadows, gold coming into the highlights.
    "dawn": "eq=saturation=0.9,colorbalance=rs=0.04:rh=0.06:bs=0.05",
}


@dataclass
class Part:
    path: str
    seconds: float
    grade: str
    # "end": the clip ends on a keyframe (shot 3 ends on the embrace), so keep its last seconds.
    anchor: str = "start"


def fmt(x: float) -> str:
    return f"{x:g}"


def total_seconds(parts: list[Part]) -> float:
    return sum(p.seconds for p in parts) + CAPTION_SEC


def build_compose_cmd(
    parts: list[Part], music: str, caption_png: str, out: str, mark_png: str | None = None
) -> list[str]:
    total = total_seconds(parts)
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    for p in parts:
        if p.anchor == "end":
            cmd += ["-sseof", f"-{fmt(p.seconds)}"]
        cmd += ["-t", fmt(p.seconds), "-i", p.path]
    cap = len(parts)
    cmd += ["-loop", "1", "-i", caption_png]
    cmd += ["-i", music]
    if mark_png:
        cmd += ["-i", mark_png]
    frame = f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,crop={WIDTH}:{HEIGHT},fps={FPS},setsar=1"
    chains = []
    for i, p in enumerate(parts):
        chains.append(f"[{i}:v]{frame},{GRADES[p.grade]},format=yuv420p[v{i}]")
    labels = "".join(f"[v{i}]" for i in range(len(parts)))
    chains.append(f"{labels}concat=n={len(parts)}:v=1:a=0,tpad=stop_mode=clone:stop_duration={fmt(CAPTION_SEC)}[cat]")
    title_at = total - TITLE_LEAD_SEC - TITLE_FADE_SEC
    chains.append(
        f"[{cap}:v]format=rgba,fade=t=in:st={fmt(round(title_at, 3))}:d={fmt(TITLE_FADE_SEC)}:alpha=1[title]"
    )
    chains.append("[cat][title]overlay=0:0:shortest=1,format=yuv420p[titled]")
    if mark_png:
        chains.append("[titled]noise=alls=6:allf=t[grain]")
        chains.append(f"[grain][{cap + 2}:v]overlay=W-w-24:H-h-28[vout]")
    else:
        chains.append("[titled]noise=alls=6:allf=t[vout]")
    chains.append(
        f"[{cap + 1}:a]atrim=0:{fmt(total)},asetpts=PTS-STARTPTS,"
        f"afade=t=out:st={fmt(total - FADE_OUT_SEC)}:d={fmt(FADE_OUT_SEC)}[aout]"
    )
    cmd += ["-filter_complex", ";".join(chains), "-map", "[vout]", "-map", "[aout]"]
    cmd += ["-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p"]
    cmd += ["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-t", fmt(total), out]
    return cmd


def build_poster_cmd(video: str, parts: list[Part], poster: str) -> list[str]:
    """The poster is the warm memory: one second into the first warm shot."""
    warm = next((i for i, p in enumerate(parts) if p.grade == "warm"), len(parts) - 1)
    at = sum(p.seconds for p in parts[:warm]) + 1
    return ["ffmpeg", "-y", "-loglevel", "error", "-ss", fmt(at), "-i", video, "-frames:v", "1", "-q:v", "3", poster]
