export type AuthoringCode =
  | 'unknown_scene'
  | 'unknown_layer'
  | 'unknown_asset'
  | 'duplicate_scene'
  | 'time_out_of_range'
  | 'keys_too_close'
  | 'bad_value'
  | 'invalid_role_kind'
  | 'bad_duration'
  | 'film_too_long'
  | 'scene_limit'
  | 'not_model3d';

/** Thrown by the pure authoring functions. The message ends with a hint so a model can repair in one turn. */
export class AuthoringError extends Error {
  readonly code: AuthoringCode;
  readonly hint?: string;
  constructor(code: AuthoringCode, text: string, hint?: string) {
    super(`${code}: ${text}${hint ? `. ${hint}` : ''}`);
    this.name = 'AuthoringError';
    this.code = code;
    this.hint = hint;
  }
}

export function hintList(ids: string[], max = 8): string {
  if (ids.length === 0) return 'There are none yet';
  const shown = ids.slice(0, max).join(', ');
  return `Valid ids: ${shown}${ids.length > max ? ', …' : ''}`;
}
