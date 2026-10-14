const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID: 10 characters of millisecond time, then 16 random characters. Sorts by creation time. */
export function ulid(now: number = Date.now()): string {
  let time = "";
  let rest = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD.charAt(rest % 32) + time;
    rest = Math.floor(rest / 32);
  }
  let random = "";
  for (const byte of crypto.getRandomValues(new Uint8Array(16)))
    random += CROCKFORD.charAt(byte % 32);
  return time + random;
}
