"""ffmpeg command builders for the 12-second story (spec §4.2 S5, §5.1).

Shots are cut to their storyboard length, scaled to 720x1280 at 24 fps, graded cold (standoff)
or warm (memory), followed by a one-second end title card; light film grain over everything;
the scene music is trimmed to the film and fades out.
"""

from dataclasses import dataclass

WIDTH, HEIGHT, FPS = 720, 1280, 24
CAPTION_SEC = 1
FADE_OUT_SEC = 0.8

GRADES = {
    "cold": "eq=saturation=0.72:contrast=1.06,colorbalance=bs=0.10:bm=0.06:bh=0.04:rs=-0.04",
    "warm": "eq=saturation=1.08,colorbalance=rs=0.08:rm=0.03:bs=-0.06",
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


def build_compose_cmd(parts: list[Part], music: str, caption_png: str, out: str) -> list[str]:
    total = total_seconds(parts)
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    for p in parts:
        if p.anchor == "end":
            cmd += ["-sseof", f"-{fmt(p.seconds)}"]
        cmd += ["-t", fmt(p.seconds), "-i", p.path]
    cmd += ["-loop", "1", "-t", fmt(CAPTION_SEC), "-i", caption_png]
    cmd += ["-i", music]
    frame = f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,crop={WIDTH}:{HEIGHT},fps={FPS},setsar=1"
    chains = []
    for i, p in enumerate(parts):
        chains.append(f"[{i}:v]{frame},{GRADES[p.grade]},format=yuv420p[v{i}]")
    cap = len(parts)
    chains.append(f"[{cap}:v]{frame},fade=t=in:st=0:d=0.4,format=yuv420p[vc]")
    labels = "".join(f"[v{i}]" for i in range(len(parts))) + "[vc]"
    chains.append(f"{labels}concat=n={len(parts) + 1}:v=1:a=0[cat]")
    chains.append("[cat]noise=alls=6:allf=t[vout]")
    chains.append(
        f"[{cap + 1}:a]atrim=0:{fmt(total)},asetpts=PTS-STARTPTS,"
        f"afade=t=out:st={fmt(total - FADE_OUT_SEC)}:d={fmt(FADE_OUT_SEC)}[aout]"
    )
    cmd += ["-filter_complex", ";".join(chains), "-map", "[vout]", "-map", "[aout]"]
    cmd += ["-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p"]
    cmd += ["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-t", fmt(total), out]
    return cmd


def build_poster_cmd(video: str, parts: list[Part], poster: str) -> list[str]:
    """The poster is the warm memory: one second into the last shot."""
    at = sum(p.seconds for p in parts[:-1]) + 1
    return ["ffmpeg", "-y", "-loglevel", "error", "-ss", fmt(at), "-i", video, "-frames:v", "1", "-q:v", "3", poster]
