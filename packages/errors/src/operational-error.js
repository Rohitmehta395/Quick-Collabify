/**
 * Base class for all anticipated, operational errors in the application
 * (e.g., validation failed, user not found, rate limit exceeded).
 */
export class OperationalError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {number} statusCode - HTTP status code equivalent (default: 500)
   * @param {string} errorCode - Machine-readable error code (default: 'INTERNAL_ERROR')
   * @param {any} details - Additional contextual details about the error
   */
  constructor(message, statusCode = 500, errorCode = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    // This flag separates "safe to show the user" errors from Programmer Errors
    this.isOperational = true;

    // Capture the stack trace correctly (V8 environments only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
