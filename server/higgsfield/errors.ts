export class HiggsfieldApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'HiggsfieldApiError';
    this.status = status;
    this.code = code;
  }
  get retryable(): boolean {
    return this.status === 429 || this.status === 503 || this.status >= 500;
  }
}

export class HiggsfieldTimeoutError extends Error {
  readonly requestId: string;
  constructor(requestId: string, waitedMs: number) {
    super(`Higgsfield request ${requestId} was still running after ${Math.round(waitedMs / 1000)}s`);
    this.name = 'HiggsfieldTimeoutError';
    this.requestId = requestId;
  }
}
