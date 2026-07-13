import express from 'express';
import cookieParser from 'cookie-parser';
import { OperationalError } from '@workspace/errors';
import { healthRouter } from './routes/health.js';
import { oauthRouter } from './auth/oauth/routes.js';
import { errorHandler } from './middleware/error-handler.js';
import { queueDashboardRouter } from './monitoring/queue-dashboard.js';
import { authenticate } from './auth/middleware/authenticate.js';
import { loadConfig, apiEnvSchema } from '@workspace/config';

/**
 * Factory function to build the Express application.
 * This separates app creation from listening, making testing easier.
 *
 * @returns {import('express').Express} The configured Express application
 */
export function buildApp() {
  const app = express();

  // Basic middleware to parse JSON bodies and cookies
  app.use(express.json());
  app.use(cookieParser());

  // Mount routes
  app.use('/health', healthRouter);
  app.use('/auth', oauthRouter);

  // Mount Queue Dashboard (gated by auth AND env flag)
  const config = loadConfig(apiEnvSchema);
  app.use(
    '/admin/queues',
    authenticate,
    (req, res, next) => {
      if (!config.QUEUE_MONITOR_ENABLED) {
        return res.status(404).send('Not Found');
      }
      next();
    },
    queueDashboardRouter,
  );

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
