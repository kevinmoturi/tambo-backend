/** One failed field, shaped for a mobile client to attach to a form input. */
export interface FieldError {
  field: string;
  message: string;
}

/**
 * An error carrying an HTTP status the client is allowed to see. Anything
 * thrown that is NOT an AppError is treated as a bug and surfaces as a generic
 * 500, so internal failure detail never leaks to the client.
 *
 * `code` is a stable machine-readable string. The mobile app should branch on
 * `code`, never on `message` — messages are free to change wording.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: FieldError[];
  /** Only set on 429s; drives the Retry-After header. */
  public readonly retryAfterSeconds?: number;

  constructor(
    statusCode: number,
    message: string,
    code = 'error',
    details?: FieldError[],
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    if (details) this.details = details;
    if (retryAfterSeconds !== undefined)
      this.retryAfterSeconds = retryAfterSeconds;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(
    message: string,
    code = 'bad_request',
    details?: FieldError[],
  ): AppError {
    return new AppError(400, message, code, details);
  }

  /** Failed schema validation. Always carries per-field detail. */
  static validation(details: FieldError[]): AppError {
    return new AppError(
      400,
      'The request body failed validation.',
      'validation_error',
      details,
    );
  }

  static unauthorized(
    message = 'Authentication required.',
    code = 'unauthorized',
  ): AppError {
    return new AppError(401, message, code);
  }

  static forbidden(
    message = 'You do not have access to this resource.',
    code = 'forbidden',
  ): AppError {
    return new AppError(403, message, code);
  }

  static notFound(
    message = 'Resource not found.',
    code = 'not_found',
  ): AppError {
    return new AppError(404, message, code);
  }

  static conflict(message: string, code = 'conflict'): AppError {
    return new AppError(409, message, code);
  }

  static tooManyRequests(message: string, retryAfterSeconds: number): AppError {
    return new AppError(
      429,
      message,
      'rate_limited',
      undefined,
      retryAfterSeconds,
    );
  }
}
