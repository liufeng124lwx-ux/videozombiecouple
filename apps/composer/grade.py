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
# A white flash cut is four frames at 24 fps; overlay text fades in and out over this long.
FLASH_SEC = 0.17
OVERLAY_FADE_SEC = 0.4

GRADES = {
    "cold": "eq=saturation=0.72:contrast=1.06,colorbalance=bs=0.10:bm=0.06:bh=0.04:rs=-0.04",
    "warm": "eq=saturation=1.08,colorbalance=rs=0.08:rm=0.03:bs=-0.06",
    # First light in the ruins: still cool in the shadows, gold coming into the highlights.
    "dawn": "eq=saturation=0.98,colorbalance=rs=0.05:rm=0.04:rh=0.14:gh=0.05:bs=0.03:bh=-0.08",
    # Christmas: amber lamplight; the golden memory, a little overexposed; amber with dawn at the window.
    "amber": "eq=saturation=1.02:contrast=1.03,colorbalance=rs=0.10:rm=0.05:bs=-0.08:bm=-0.03",
    "golden": "eq=saturation=1.10:brightness=0.04,colorbalance=rs=0.10:rm=0.06:rh=0.06:bs=-0.08",
    "amber-dawn": "eq=saturation=1.0,colorbalance=rs=0.07:rm=0.04:rh=0.10:bs=0.02:bh=-0.04",
}


@dataclass
class Part:
    path: str
    seconds: float
    grade: str
    # "end": the clip ends on a keyframe (shot 3 ends on the embrace), so keep its last seconds.
    anchor: str = "start"
    flash: bool = False


def fmt(x: float) -> str:
    return f"{x:g}"


def total_seconds(parts: list[Part], hold_sec: float = CAPTION_SEC) -> float:
    return sum(p.seconds for p in parts) + hold_sec


def build_compose_cmd(
    parts: list[Part],
    music: str,
    caption_png: str,
    out: str,
    mark_png: str | None = None,
    hold_sec: float = CAPTION_SEC,
    title_at: float | None = None,
    overlays: list[tuple[str, float, float]] | None = None,
    dissolve_sec: float = 0,
) -> list[str]:
    total = total_seconds(parts, hold_sec)
    overlays = overlays or []
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    for p in parts:
        if p.anchor == "end":
            cmd += ["-sseof", f"-{fmt(p.seconds)}"]
        cmd += ["-t", fmt(p.seconds), "-i", p.path]
    cap = len(parts)
    cmd += ["-loop", "1", "-i", caption_png]
    cmd += ["-i", music]
    mark_at = None
    if mark_png:
        mark_at = cap + 2
        cmd += ["-i", mark_png]
    first_overlay = cap + (3 if mark_png else 2)
    for png, _, _ in overlays:
        cmd += ["-loop", "1", "-t", fmt(total), "-i", png]
    frame = f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,crop={WIDTH}:{HEIGHT},fps={FPS},setsar=1"
    chains = []
    # Dissolve into a shot unless it opens with the white flash (that cut stays hard).
    dissolves = [dissolve_sec > 0 and i + 1 < len(parts) and not parts[i + 1].flash for i in range(len(parts))]
    for i, p in enumerate(parts):
        flash = f",fade=t=in:st=0:d={fmt(FLASH_SEC)}:color=white" if p.flash else ""
        # The outgoing shot's last frame is held under the dissolve, so every shot still starts on time.
        held = f",tpad=stop_mode=clone:stop_duration={fmt(dissolve_sec)}" if dissolves[i] else ""
        tb = f",settb=1/{FPS}" if dissolve_sec > 0 else ""
        chains.append(f"[{i}:v]{frame},{GRADES[p.grade]}{flash}{held}{tb},format=yuv420p[v{i}]")
    hold = f",tpad=stop_mode=clone:stop_duration={fmt(hold_sec)}" if hold_sec > 0 else ""
    if dissolve_sec <= 0:
        labels = "".join(f"[v{i}]" for i in range(len(parts)))
        chains.append(f"{labels}concat=n={len(parts)}:v=1:a=0{hold}[cat]")
    else:
        current, start = "v0", 0.0
        for i in range(1, len(parts)):
            start += parts[i - 1].seconds
            if dissolves[i - 1]:
                chains.append(
                    f"[{current}][v{i}]xfade=transition=fade:duration={fmt(dissolve_sec)}:offset={fmt(round(start, 3))}[j{i}]"
                )
            else:
                # concat outputs a microsecond timebase; xfade needs both inputs on the same one.
                chains.append(f"[{current}][v{i}]concat=n=2:v=1:a=0,settb=1/{FPS}[j{i}]")
            current = f"j{i}"
        chains.append(f"[{current}]null{hold}[cat]")
    at = title_at if title_at is not None else total - TITLE_LEAD_SEC - TITLE_FADE_SEC
    chains.append(
        f"[{cap}:v]format=rgba,fade=t=in:st={fmt(round(at, 3))}:d={fmt(TITLE_FADE_SEC)}:alpha=1[title]"
    )
    current = "cat"
    for j, (_, start, end) in enumerate(overlays):
        fade_out = round(end - OVERLAY_FADE_SEC, 3)
        chains.append(
            f"[{first_overlay + j}:v]format=rgba,"
            f"fade=t=in:st={fmt(start)}:d={fmt(OVERLAY_FADE_SEC)}:alpha=1,"
            f"fade=t=out:st={fmt(fade_out)}:d={fmt(OVERLAY_FADE_SEC)}:alpha=1[ov{j}]"
        )
        chains.append(f"[{current}][ov{j}]overlay=0:0:enable='between(t,{fmt(start)},{fmt(end)})'[o{j}]")
        current = f"o{j}"
    chains.append(f"[{current}][title]overlay=0:0:shortest=1,format=yuv420p[titled]")
    if mark_at is not None:
        chains.append("[titled]noise=alls=6:allf=t[grain]")
        chains.append(f"[grain][{mark_at}:v]overlay=W-w-24:H-h-28[vout]")
    else:
        chains.append("[titled]noise=alls=6:allf=t[vout]")
    chains.append(
        f"[{cap + 1}:a]atrim=0:{fmt(total)},asetpts=PTS-STARTPTS,"
        f"afade=t=out:st={fmt(total - FADE_OUT_SEC)}:d={fmt(FADE_OUT_SEC)}[aout]"
    )
    cmd += ["-filter_complex", ";".join(chains), "-map", "[vout]", "-map", "[aout]"]
    cmd += ["-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p"]
    # EU AI Act art. 50: the film says, in its own metadata, that it is AI-generated.
    cmd += ["-metadata", "comment=AI-generated video, made with VideoZombieCouple"]
    cmd += ["-metadata", "ai_generated=true"]
    cmd += ["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart+use_metadata_tags", "-t", fmt(total), out]
    return cmd


def build_poster_cmd(video: str, parts: list[Part], poster: str) -> list[str]:
    """The poster is the warm (or golden) memory: one second into its first shot."""
    warm = next((i for i, p in enumerate(parts) if p.grade in ("warm", "golden")), len(parts) - 1)
    at = sum(p.seconds for p in parts[:warm]) + 1
    return ["ffmpeg", "-y", "-loglevel", "error", "-ss", fmt(at), "-i", video, "-frames:v", "1", "-q:v", "3", poster]
