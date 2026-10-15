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
