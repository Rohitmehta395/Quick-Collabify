import express from 'express';

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

  // (Routes and error handlers will be attached here in future tasks)

  return app;
}
