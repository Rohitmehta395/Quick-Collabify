import 'dotenv/config';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { loadConfig, workerEnvSchema } from '@workspace/config';
import { logger } from '@workspace/logger';

async function start() {
  try {
    const config = loadConfig(workerEnvSchema);

    // Initialize Redis connection
    const connection = new IORedis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
    });

    connection.on('ready', () => {
      logger.info('Worker successfully connected to Redis');
    });

    connection.on('error', (err) => {
      logger.error({ err }, 'Worker Redis connection error');
    });

    // Setup BullMQ worker (placeholder, no real queues yet)
    // We bind it to a dummy queue so it stays alive and connects to Redis
    const worker = new Worker(
      'dummy-queue',
      async (job) => {
        logger.info({ jobId: job.id }, 'Processing dummy job');
      },
      { connection },
    );

    logger.info('Worker process successfully started');

    const shutdown = async () => {
      logger.info('Shutting down worker process...');
      await worker.close();
      connection.quit();
      logger.info('Worker process closed');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    logger.fatal({ err }, 'Failed to start Worker process');
    process.exit(1);
  }
}

start();
