import { describe, expect, it } from "vitest";
import { filmMail } from "../src/services/film-mail.ts";

const env = { ALLOWED_ORIGIN: "https://videozombiecouple.com" } as never;
const base = {
  storyId: "s1",
  email: "a@example.com",
  verified: true,
  expiresAt: Date.UTC(2026, 11, 30),
  reminder: false,
};

describe("film emails name the story", () => {
  it("zombie films keep their words and 15 seconds", async () => {
    const mail = await filmMail(env, { ...base, story: "zombie" });
    expect(mail.subject).toBe("Your zombie love story is ready");
    expect(mail.intro).toContain("Your 15-second film is ready");
  });

  it("a Christmas film is a 50 Christmases film of 32 seconds, also in the reminder", async () => {
    const ready = await filmMail(env, { ...base, story: "christmas" });
    expect(ready.subject).toBe("Your 50 Christmases film is ready");
    expect(ready.intro).toContain("Your 32-second film is ready");
    const reminder = await filmMail(env, { ...base, story: "christmas", reminder: true });
    expect(reminder.subject).toBe("Your 50 Christmases film is deleted tomorrow");
  });
});
