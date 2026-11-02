export type PropKind = 'number' | 'deg' | 'color';

export interface TargetRef {
  obj: object;
  key: string;
  kind: PropKind;
  /** colour targets only: write a hex string back to the real object */
  setColor?: (hex: string) => void;
  getColor?: () => string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function pathRef(root: object, path: string, kind: PropKind): TargetRef {
  const segments = path.split('.');
  let obj: Record<string, unknown> = root as Record<string, unknown>;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    if (!isObject(obj[segment])) {
      throw new Error(`motion: no property "${path}"`);
    }
    obj = obj[segment] as Record<string, unknown>;
  }
  const key = segments[segments.length - 1];
  if (!(key in obj)) {
    throw new Error(`motion: no property "${path}"`);
  }
  return { obj, key, kind };
}
