from grade import Part, build_compose_cmd, build_poster_cmd, total_seconds


PARTS = [Part("s1.mp4", 3, "cold"), Part("s2.mp4", 2, "cold"), Part("s3.mp4", 3, "cold", "end"), Part("s4.mp4", 3, "warm")]


def test_cold_and_warm_grades_and_output_flags():
    cmd = build_compose_cmd(PARTS, "m.m4a", "cap.png", "out.mp4")
    joined = " ".join(cmd)
    assert joined.count("colorbalance=bs=0.10") == 3
    assert joined.count("colorbalance=rs=0.08") == 1
    assert "-t 3 -i s1.mp4" in joined and "-t 2 -i s2.mp4" in joined
    assert "+faststart" in joined and "libx264" in joined and "aac" in joined
    assert cmd[-1] == "out.mp4"


def test_caption_is_the_last_one_second_segment_and_music_fades_out():
    joined = " ".join(build_compose_cmd(PARTS, "m.m4a", "cap.png", "out.mp4"))
    assert "-loop 1 -t 1 -i cap.png" in joined
    assert "concat=n=5:v=1:a=0" in joined
    assert "afade=t=out:st=11.2:d=0.8" in joined
    assert total_seconds(PARTS) == 12


def test_poster_is_taken_one_second_into_the_memory_shot():
    cmd = build_poster_cmd("out.mp4", PARTS, "poster.jpg")
    assert cmd[cmd.index("-ss") + 1] == "9"
    assert cmd[-1] == "poster.jpg"


def test_a_clip_that_ends_on_a_keyframe_keeps_its_end():
    joined = " ".join(build_compose_cmd(PARTS, "m.m4a", "cap.png", "out.mp4"))
    assert "-sseof -3 -t 3 -i s3.mp4" in joined
    assert "-sseof" not in joined.split("-i s3.mp4")[0].split("-i s2.mp4")[0]
