export class NotImplementedError extends Error {
  readonly step: string;
  constructor(step: string) {
    super(`not implemented (${step})`);
    this.name = 'NotImplementedError';
    this.step = step;
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
