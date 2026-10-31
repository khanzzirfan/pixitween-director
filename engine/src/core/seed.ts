function fract(value: number): number {
  return value - Math.floor(value);
}

export function seedFor(frame: number, salt: number): number {
  return fract(Math.sin(frame * 12.9898 + salt * 78.233) * 43758.5453);
}

export function hashString(s: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}
