import express from 'express';
import { OperationalError } from '@workspace/errors';
import { healthRouter } from './routes/health.js';
import { oauthRouter } from './auth/oauth/routes.js';
import { errorHandler } from './middleware/error-handler.js';

/**
 * Factory function to build the Express application.
 * This separates app creation from listening, making testing easier.
 *
 * @returns {import('express').Express} The configured Express application
 */
export function buildApp() {
  const app = express();

  // Basic middleware to parse JSON bodies
  app.use(express.json());

  // Mount routes
  app.use('/health', healthRouter);
  app.use('/auth', oauthRouter);
  // Temporary testing route for OperationalError
  app.get('/simulate-operational-error', (req, res, next) => {
    next(new OperationalError('This is a simulated validation failure', 400, 'VALIDATION_FAILED'));
  });

  // Temporary testing route for Programmer Error
  app.get('/simulate-programmer-error', (req, res, next) => {
    next(new Error('This is a simulated unexpected bug (e.g. TypeError)'));
  });

  // Centralized Error Handler MUST be registered after all routes and other middleware
  app.use(errorHandler);

  return app;
}
