import { OperationalError } from './operational-error.js';

/**
 * Formats an error into a standardized JSON response envelope.
 * Protects against leaking sensitive stack traces or database errors by
 * scrubbing any error that is not an OperationalError.
 *
 * @param {Error} error - The error to format
 * @returns {object} The standard API error envelope
 */
export function createErrorEnvelope(error) {
  // If it's a known error we explicitly threw, we can safely expose its details
  if (error instanceof OperationalError && error.isOperational) {
    return {
      success: false,
      error: {
        code: error.errorCode,
        message: error.message,
        details: error.details,
      },
    };
  }

  // If it's an unexpected bug/crash (Programmer Error), we scrub the output
  return {
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
      // Intentionally omitting 'details' to prevent leaking internals
    },
  };
}
