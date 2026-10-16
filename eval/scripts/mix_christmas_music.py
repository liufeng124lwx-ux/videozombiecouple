"""Mix the 32-second Christmas soundtrack (christmas story spec §2.2, content plan Task 11).

  python3 eval/scripts/mix_christmas_music.py <suno.wav> <creak.ogg> <out.m4a>

Music: one Suno Pro instrumental (assets/stories/README.md records the song id). The storyboard's
dynamics are made here, not asked of Suno: quiet under the cold opening, silence while the box opens,
a crescendo with one rising chime per tree light, a drum hit on the white-flash cut, the main theme,
and the track's own ending note to close. Every sound effect except the floor creak (BigSoundBank,
CC0) is synthesised below, so nothing else needs a licence.
"""

import subprocess
import sys

SR = 48000
DUR = 32.0

# (out_start, out_end, src_start, gain_db_at_start, gain_db_at_end) — music segments on the timeline.
MUSIC = [
    (0.0, 10.0, 0.0, -9.0, -7.0),  # cold opening: sparse, under the clock and wind
    # 10.0–13.0: silence (the box opens)
    (13.0, 20.0, 13.0, -14.0, 0.0),  # lights come on: crescendo
    (20.0, 28.3, 20.0, 0.0, 0.0),  # memory and embrace: main theme
    (28.0, 32.0, 37.1, 0.0, -2.0),  # window: the track's closing note
]
CHIMES = [13.3 + 0.55 * i for i in range(7)]  # one per light, pitch rising (shot 5)
CHIME_HZ = [1046.5, 1174.7, 1318.5, 1568.0, 1760.0, 2093.0, 2349.3]
CREAK_AT = 6.6  # shot 3: he steps to her with the mug
DRUM_AT = 20.0  # shot 7: the cut to the memory


def chime_expr() -> str:
    terms = [
        f"if(gte(t,{t0:.2f}),0.22*(sin(2*PI*{f}*(t-{t0:.2f}))+0.35*sin(2*PI*{2 * f}*(t-{t0:.2f})))*exp(-(t-{t0:.2f})*2.2),0)"
        for t0, f in zip(CHIMES, CHIME_HZ)
    ]
    return "+".join(terms)


def build(src: str, creak: str, out: str) -> list[str]:
    parts: list[str] = []
    labels: list[str] = []
    for i, (a, b, s, g0, g1) in enumerate(MUSIC):
        length = b - a
        ramp = f"pow(10,({g0}+({g1}-({g0}))*t/{length})/20)"
        fade = "afade=t=in:d=0.25," if a > 0 else ""
        tail = f"afade=t=out:st={length - 0.3}:d=0.3," if i < len(MUSIC) - 1 else f"afade=t=out:st={length - 0.6}:d=0.6,"
        parts.append(
            f"[0:a]atrim=start={s}:duration={length},asetpts=PTS-STARTPTS,"
            f"volume='{ramp}':eval=frame,{fade}{tail}adelay={int(a * 1000)}:all=1[m{i}]"
        )
        labels.append(f"[m{i}]")
    # Clock: tick-tock once a second under shots 1–3, gone when the box opens.
    parts.append(
        f"aevalsrc='0.35*sin(2*PI*(2600-500*mod(floor(t),2))*t)*exp(-mod(t,1)*120)':s={SR}:d=10,"
        "afade=t=out:st=9.4:d=0.6,highpass=f=900[clock]"
    )
    # Wind: brown noise, low-passed, slowly breathing.
    parts.append(
        f"anoisesrc=color=brown:sample_rate={SR}:duration=10:amplitude=0.6,lowpass=f=500,"
        "volume='0.25*(0.6+0.4*sin(2*PI*0.18*t))':eval=frame,afade=t=in:d=1,afade=t=out:st=8.5:d=1.5[wind]"
    )
    # Cardboard box: band-passed noise in irregular bursts, shot 4 (0:10–0:13).
    parts.append(
        f"anoisesrc=color=white:sample_rate={SR}:duration=2.6:amplitude=0.5,bandpass=f=2500:w=1800,"
        "volume='24*max(0,sin(2*PI*5.3*t))*max(0,sin(2*PI*2.1*t+1))':eval=frame,adelay=10200:all=1[box]"
    )
    # Chimes: times are absolute, so the source simply runs from 0 s.
    parts.append(f"aevalsrc='{chime_expr()}':s={SR}:d=22[chime]")
    # Drum: a soft low boom with a pitch drop, on the cut.
    parts.append(
        f"aevalsrc='0.9*sin(2*PI*(52+70*exp(-t*18))*t)*exp(-t*3.2)':s={SR}:d=2.5,adelay={int(DRUM_AT * 1000)}:all=1[drum]"
    )
    parts.append(f"[1:a]aresample={SR},volume=0.5,adelay={int(CREAK_AT * 1000)}:all=1[creak]")
    sfx = "[clock][wind][box][chime][drum][creak]"
    parts.append(
        f"{''.join(labels)}{sfx}amix=inputs={len(labels) + 6}:normalize=0,"
        f"atrim=duration={DUR},aformat=channel_layouts=stereo,"
        f"afade=t=out:st={DUR - 0.6}:d=0.6,aresample={SR}[out]"
    )
    return [
        "ffmpeg", "-v", "error", "-y", "-i", src, "-i", creak,
        "-filter_complex", ";".join(parts), "-map", "[out]",
        "-c:a", "pcm_s24le", "-ar", str(SR), "-ac", "2", "-t", str(DUR), out,
    ]


def integrated_lufs(path: str) -> float:
    """EBU R128 integrated loudness of a file (ffmpeg loudnorm's measurement pass)."""
    err = subprocess.run(["ffmpeg", "-i", path, "-af", "loudnorm=print_format=json", "-f", "null", "-"],
                         capture_output=True, text=True, check=True).stderr
    return float(err[err.rindex("{"):].split('"input_i" : "')[1].split('"')[0])


def mix(src: str, creak: str, out: str) -> None:
    """Mix, then one linear gain to -16 LUFS and a -1.5 dBTP limiter: the storyboard's dynamics
    survive (single-pass loudnorm would flatten the quiet opening into the theme)."""
    raw = out + ".raw.wav"
    subprocess.run(build(src, creak, raw), check=True)
    gain = -16.0 - integrated_lufs(raw)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-af",
                    f"volume={gain:.2f}dB,alimiter=limit={10 ** (-1.5 / 20):.4f}:level=disabled",
                    "-c:a", "aac", "-b:a", "160k", "-ar", str(SR), "-ac", "2", out], check=True)
    subprocess.run(["rm", "-f", raw], check=True)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    mix(*sys.argv[1:4])
