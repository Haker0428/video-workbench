/** 安全整数上限（TS number 精度）；服务端允许 2^63，但 UI 层限到 2^53。 */
export const SEED_MAX = 2 ** 53 - 1;

export function randomSeed(): number {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  const v = (buf[0] * 2 ** 32 + buf[1]) % (SEED_MAX + 1);
  return v;
}

export function parseSeed(input: string): number | null {
  if (input.trim() === "") return null;
  const n = Number(input);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > SEED_MAX) return null;
  return n;
}
