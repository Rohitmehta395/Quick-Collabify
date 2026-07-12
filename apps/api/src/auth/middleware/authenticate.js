import crypto from 'node:crypto';
import { validateSession } from '../sessions/validate-session.js';
import { SESSION_COOKIE_NAME } from '../sessions/cookie.js';
import { OperationalError } from '@workspace/errors';
import { logger } from '@workspace/logger';

/**
 * Express middleware that protects routes by enforcing a valid session.
 * 
 * Spec §11.6: All invalid session cases (missing, expired, revoked, tampered)
 * MUST produce an identical 401 Unauthorized response to prevent information leakage.
 * 
 * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 * @param {import('express').NextFunction} next 
 */
export async function authenticate(req, res, next) {
  try {
    const sessionId = req.cookies[SESSION_COOKIE_NAME];
    
    if (!sessionId) {
      throw new OperationalError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    let sessionData;
    try {
      sessionData = await validateSession(sessionId);
    } catch (err) {
      // Redis outage or unexpected error.
      // Spec §13.2: Fail closed on Redis failures. Treat as unauthenticated.
      // Log as high-severity operational event, but return generic 401 to client.
      logger.error({ err, sessionId }, 'Session validation failed due to infrastructure error (Redis failure)');
      throw new OperationalError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    if (!sessionData) {
      // Session was expired, revoked, or malformed
      throw new OperationalError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    // Spec §7.1: Attach request context (userId, sessionId, correlation ID)
    const correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
    
    req.user = {
      userId: sessionData.userId,
      sessionId,
      correlationId
    };
    
    next();
  } catch (err) {
    next(err);
  }
}
