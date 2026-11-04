// Engine `IdSchema` only allows `^[A-Za-z][A-Za-z0-9_-]{0,63}$`. AEP ids (e.g. `wake:bg`) can use
// other characters, so every id crossing into a MotionDoc goes through this pure, deterministic
// mapping — the same input always sanitises to the same output, so a value referenced in two
// places (an asset id used as both the assets-table key and a layer's `asset` field) stays in sync.
export function sanitizeId(id: string): string {
  const replaced = id.replace(/[^A-Za-z0-9_-]/g, '_');
  const prefixed = /^[A-Za-z]/.test(replaced) ? replaced : `a${replaced}`;
  return prefixed.slice(0, 64);
}
