import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

/** scrypt password hash in the form scrypt$N$salt$hash (base64url). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [alg, n, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const salt = Buffer.from(saltB64, 'base64url');
  const expected = Buffer.from(hashB64, 'base64url');
  const key = scryptSync(password.normalize('NFKC'), salt, expected.length, { N: Number(n), r: SCRYPT.r, p: SCRYPT.p });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function randomToken(bytes = 32): string { return randomBytes(bytes).toString('base64url'); }

export function sha256(s: string): string { return createHash('sha256').update(s).digest('hex'); }

export function hmac(secret: string, s: string): string { return createHmac('sha256', secret).update(s).digest('base64url'); }

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Password policy: 10+ characters, at least one letter and one digit. */
export function passwordProblems(pw: string): string | null {
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use at least one letter and one number.';
  if (/^(password|welcome|loyal)/i.test(pw)) return 'That password is too easy to guess.';
  return null;
}
