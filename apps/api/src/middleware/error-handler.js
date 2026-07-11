import { createErrorEnvelope } from '@workspace/errors';
import { logger } from '@workspace/logger';

/**
 * Centralized error handling middleware for Express.
 * Must have exactly 4 arguments to be recognized by Express as an error handler.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Log the raw error on the server side for debugging
  logger.error({ err, url: req.url, method: req.method }, 'Unhandled API Error');

  // Format the error into the safe JSON envelope
  const envelope = createErrorEnvelope(err);

  // Determine HTTP status code
  // If it's an operational error, it should have a statusCode attached. Otherwise, default to 500.
  const statusCode = err.isOperational && err.statusCode ? err.statusCode : 500;

  res.status(statusCode).json(envelope);
}
