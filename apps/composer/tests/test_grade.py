from grade import Part, build_compose_cmd, build_poster_cmd, total_seconds


PARTS = [
    Part("s1.mp4", 3, "cold"),
    Part("s2.mp4", 2, "cold"),
    Part("s3.mp4", 3, "cold", "end"),
    Part("s4.mp4", 3, "warm"),
    Part("s5.mp4", 3, "dawn"),
]


def test_cold_and_warm_grades_and_output_flags():
    cmd = build_compose_cmd(PARTS, "m.m4a", "cap.png", "out.mp4")
    joined = " ".join(cmd)
    assert joined.count("colorbalance=bs=0.10") == 3
    assert joined.count("colorbalance=rs=0.08") == 1
    assert "-t 3 -i s1.mp4" in joined and "-t 2 -i s2.mp4" in joined
    assert "+faststart" in joined and "libx264" in joined and "aac" in joined
    assert cmd[-1] == "out.mp4"


def test_the_ending_holds_the_last_frame_and_the_title_fades_in_over_it():
    joined = " ".join(build_compose_cmd(PARTS, "m.m4a", "cap.png", "out.mp4"))
    # No black card any more: the shots are joined, the last frame is held, the title sits on top.
    assert "concat=n=5:v=1:a=0" in joined
    assert "tpad=stop_mode=clone:stop_duration=1" in joined
    assert "-loop 1 -i cap.png" in joined
    assert "fade=t=in:st=12.6:d=0.8:alpha=1" in joined
    assert "overlay=0:0" in joined
    # The music gets a long, gentle ending.
    assert "afade=t=out:st=13:d=2" in joined
    assert total_seconds(PARTS) == 15


def test_the_dawn_shot_has_its_own_grade():
    joined = " ".join(build_compose_cmd(PARTS, "m.m4a", "cap.png", "out.mp4"))
    assert joined.count("colorbalance=rs=0.05:rm=0.04:rh=0.14") == 1


def test_poster_is_taken_one_second_into_the_memory_shot():
    cmd = build_poster_cmd("out.mp4", PARTS, "poster.jpg")
    assert cmd[cmd.index("-ss") + 1] == "9"
    assert cmd[-1] == "poster.jpg"


def test_a_clip_that_ends_on_a_keyframe_keeps_its_end():
    joined = " ".join(build_compose_cmd(PARTS, "m.m4a", "cap.png", "out.mp4"))
    assert "-sseof -3 -t 3 -i s3.mp4" in joined
    assert "-sseof" not in joined.split("-i s3.mp4")[0].split("-i s2.mp4")[0]


def test_a_small_mark_sits_in_the_corner_of_the_film():
    cmd = build_compose_cmd(PARTS, "m.m4a", "cap.png", "out.mp4", mark_png="mark.png")
    joined = " ".join(cmd)
    assert "-i mark.png" in joined
    assert "overlay=W-w-24:H-h-28" in joined


def test_every_film_says_it_is_ai_generated_in_its_metadata():
    # EU AI Act art. 50: synthetic video carries a machine-readable mark.
    cmd = build_compose_cmd(PARTS, "m.m4a", "cap.png", "out.mp4")
    i = cmd.index("-metadata")
    tags = [cmd[j + 1] for j, a in enumerate(cmd) if a == "-metadata"]
    assert i < len(cmd) - 1
    assert "comment=AI-generated video, made with VideoZombieCouple" in tags
    assert "ai_generated=true" in tags


def test_the_corner_mark_says_ai(tmp_path):
    from PIL import Image

    from caption import MARK_TEXT, render_mark

    assert MARK_TEXT.startswith("AI")
    out = render_mark(str(tmp_path / "mark.png"))
    assert Image.open(out).size[0] > 200


XMAS = [
    Part("s1.mp4", 3, "cold"),
    Part("s2.mp4", 3, "cold"),
    Part("s3.mp4", 4, "cold"),
    Part("s4.mp4", 3, "cold"),
    Part("s5.mp4", 4, "cold"),
    Part("s6.mp4", 3, "amber"),
    Part("s7.mp4", 4, "golden", flash=True),
    Part("s8.mp4", 4, "amber-dawn"),
    Part("s9.mp4", 4, "amber-dawn"),
]


def test_the_zombie_command_is_unchanged_by_the_new_options():
    old = build_compose_cmd(PARTS, "m.m4a", "cap.png", "out.mp4", mark_png="mark.png")
    new = build_compose_cmd(PARTS, "m.m4a", "cap.png", "out.mp4", mark_png="mark.png", hold_sec=1, title_at=None, overlays=[])
    assert old == new


def test_a_christmas_film_is_32_seconds_with_no_held_frame_and_the_title_at_30():
    joined = " ".join(build_compose_cmd(XMAS, "m.m4a", "cap.png", "out.mp4", hold_sec=0, title_at=30))
    assert total_seconds(XMAS, hold_sec=0) == 32
    assert "tpad" not in joined
    assert "fade=t=in:st=30:d=0.8:alpha=1" in joined
    assert "afade=t=out:st=30:d=2" in joined
    assert joined.endswith("-t 32 out.mp4")


def test_the_new_grades_are_applied():
    joined = " ".join(build_compose_cmd(XMAS, "m.m4a", "cap.png", "out.mp4", hold_sec=0, title_at=30))
    from grade import GRADES

    for g in ("amber", "golden", "amber-dawn"):
        assert GRADES[g] in joined


def test_the_memory_cut_flashes_white_for_four_frames():
    cmd = build_compose_cmd(XMAS, "m.m4a", "cap.png", "out.mp4", hold_sec=0, title_at=30)
    graph = cmd[cmd.index("-filter_complex") + 1]
    v6 = next(c for c in graph.split(";") if c.startswith("[6:v]"))
    assert "fade=t=in:st=0:d=0.17:color=white" in v6
    assert graph.count("color=white") == 1


def test_overlays_show_only_in_their_time_window():
    cmd = build_compose_cmd(
        XMAS, "m.m4a", "cap.png", "out.mp4", hold_sec=0, title_at=30,
        overlays=[("o1.png", 0, 5), ("o2.png", 10, 13)],
    )
    joined = " ".join(cmd)
    assert "-loop 1 -t 32 -i o1.png" in joined and "-loop 1 -t 32 -i o2.png" in joined
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert "fade=t=in:st=0:d=0.4:alpha=1,fade=t=out:st=4.6:d=0.4:alpha=1" in graph
    assert "enable='between(t,10,13)'" in graph


def test_the_poster_of_a_christmas_film_is_the_golden_memory():
    cmd = build_poster_cmd("out.mp4", XMAS, "poster.jpg")
    # 3+3+4+3+4+3 seconds before the memory, then one second in.
    assert cmd[cmd.index("-ss") + 1] == "21"
