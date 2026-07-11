import 'dotenv/config';
import { loadConfig, apiEnvSchema } from '@workspace/config';
import { logger } from '@workspace/logger';
import { buildApp } from './app.js';

async function start() {
  try {
    // 1. Load and validate environment configuration.
    // If the environment is invalid (e.g. missing PORT), this will throw and crash fast.
    const config = loadConfig(apiEnvSchema);

    // 2. Build the Express application
    const app = buildApp();

    // 3. Start listening for incoming requests
    const server = app.listen(config.PORT, () => {
      logger.info(
        { port: config.PORT, env: config.NODE_ENV },
        'API server successfully started and listening',
      );
    });

    // Handle graceful shutdown signals
    const shutdown = () => {
      logger.info('Received shutdown signal, closing server...');
      server.close(() => {
        logger.info('Server closed. Exiting process.');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    logger.fatal({ err }, 'Failed to start API server');
    process.exit(1);
  }
}

// Bootstrap the application
start();
