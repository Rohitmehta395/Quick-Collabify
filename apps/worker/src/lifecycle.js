import { logger } from '@workspace/logger';
import { setReady, stopHealthServer } from './health.js';

export function setupGracefulShutdown(worker, connection, processObj = process) {
  const shutdown = async () => {
    logger.info('Shutting down worker process...');
    setReady(false); // Stop accepting new health checks as ready
    const GRACE_PERIOD_MS = 10000;

    const timeout = new Promise((resolve) => setTimeout(resolve, GRACE_PERIOD_MS, 'timeout'));
    const closed = worker.close().then(() => 'closed');

    const result = await Promise.race([closed, timeout]);
    if (result === 'timeout') {
      logger.warn('Worker shutdown grace period exceeded, forcing exit');
    }

    connection.quit();
    await stopHealthServer();
    logger.info('Worker process closed');
    processObj.exit(0);
  };

  processObj.on('SIGINT', shutdown);
  processObj.on('SIGTERM', shutdown);

  return shutdown; // Export for testing
}
