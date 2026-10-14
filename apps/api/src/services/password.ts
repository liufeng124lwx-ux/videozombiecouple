// PBKDF2-SHA256 through WebCrypto (copied from Vidova). 100k iterations is the Workers maximum.
const ITERATIONS = 100_000;
const PREFIX = "pbkdf2-sha256";

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `${PREFIX}$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [prefix, rounds, salt, expected] = stored.split("$");
  const iterations = Number(rounds);
  if (prefix !== PREFIX || !salt || !expected || !Number.isInteger(iterations)) return false;
  if (iterations < 1 || iterations > ITERATIONS) return false;
  const actual = await derive(password, fromBase64(salt), iterations);
  const wanted = fromBase64(expected);
  if (actual.length !== wanted.length) return false;
  let diff = 0;
  for (let index = 0; index < actual.length; index += 1)
    diff |= (actual[index] ?? 0) ^ (wanted[index] ?? 0);
  return diff === 0;
}
