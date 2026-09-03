/** Application error carrying an HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }

  static unauthorized(message = 'Authentication required'): ApiError {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'You do not have permission to perform this action'): ApiError {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(what = 'Resource'): ApiError {
    return new ApiError(404, 'NOT_FOUND', `${what} not found`);
  }

  static conflict(message: string, details?: unknown): ApiError {
    return new ApiError(409, 'CONFLICT', message, details);
  }

  static unprocessable(message: string, details?: unknown): ApiError {
    return new ApiError(422, 'UNPROCESSABLE', message, details);
  }

  static internal(message = 'Something went wrong'): ApiError {
    return new ApiError(500, 'INTERNAL_ERROR', message);
  }
}
