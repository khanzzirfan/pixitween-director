import { lightValidate, type CompositionIssue, type ValidationResult } from './light-validator';

export type { CompositionIssue, ValidationResult };

export interface CompositionValidator {
  name: 'light';
  validate(json: unknown): ValidationResult;
}

export const lightValidator: CompositionValidator = { name: 'light', validate: lightValidate };

/**
 * The app owns its schema: `@shared/aep` is the contract the agents write and the engine reads,
 * and the server validates with the light validator (the browser-safe subset of that schema).
 * The validator is still handed out as a promise so every caller keeps its shape.
 */
export async function getValidator(): Promise<CompositionValidator> {
  return lightValidator;
}
