import { lightValidate, type CompositionIssue, type ValidationResult } from './light-validator';

export type { CompositionIssue, ValidationResult };

export interface CompositionValidator {
  name: 'engine' | 'light';
  validate(json: unknown): ValidationResult;
}

export const lightValidator: CompositionValidator = { name: 'light', validate: lightValidate };

interface SchemaModule {
  parseAepCompositionSafe(json: unknown): { success: true; data: unknown } | { success: false; error: { issues: Array<{ path: Array<string | number>; message: string }> } };
}

let cached: Promise<CompositionValidator> | undefined;

/**
 * Prefers the engine's Node-safe schema entry when the package publishes one; today it does not,
 * so the light validator is used (design 3.1). Cached, so the warning prints once.
 */
export function getValidator(): Promise<CompositionValidator> {
  cached ??= (async () => {
    const specifier = 'reacthub-pixitweenjs/schema';
    try {
      const mod = (await import(/* @vite-ignore */ specifier)) as SchemaModule;
      return {
        name: 'engine' as const,
        validate(json: unknown): ValidationResult {
          const r = mod.parseAepCompositionSafe(json);
          if (r.success) return { ok: true, data: r.data };
          return { ok: false, issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
        },
      };
    } catch {
      console.warn('reacthub-pixitweenjs/schema is not available; using the light composition validator');
      return lightValidator;
    }
  })();
  return cached;
}
