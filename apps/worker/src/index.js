import 'dotenv/config';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { loadConfig, workerEnvSchema } from '@workspace/config';
import { logger } from '@workspace/logger';
import { processEmailJob } from './processors/email-processor.js';
import { startHealthServer, setReady } from './health.js';
import { setupGracefulShutdown } from './lifecycle.js';

async function start() {
  try {
    const config = loadConfig(workerEnvSchema);

    startHealthServer();

    // Initialize Redis connection
    const connection = new IORedis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
    });

    let redisReady = false;
    let workerRegistered = false;

    const checkReadiness = () => {
      if (redisReady && workerRegistered) {
        setReady(true);
        logger.info('Worker process successfully started and is ready');
      }
    };

    connection.on('ready', () => {
      redisReady = true;
      checkReadiness();
    });

    connection.on('error', (err) => {
      logger.error({ err }, 'Worker Redis connection error');
    });

    // Register processor against the 'email' queue
    const worker = new Worker('email', processEmailJob, {
      connection,
      lockDuration: 30000,
      stalledInterval: 30000,
    });

    workerRegistered = true;
    checkReadiness();

    worker.on('failed', (job, err) => {
      // BullMQ captures errors thrown by the processor; log them here
      if (job && job.opts && job.attemptsMade >= job.opts.attempts) {
        logger.error(
          { jobId: job.id, err, attemptsMade: job.attemptsMade },
          'Terminal failure: Email job permanently failed after exhausting retries',
        );
      } else {
        logger.warn(
          { jobId: job?.id, err, attemptsMade: job?.attemptsMade },
          'Email job failed processing, will retry',
        );
      }
    });

    setupGracefulShutdown(worker, connection);
  } catch (err) {
    logger.fatal({ err }, 'Failed to start Worker process');
    process.exit(1);
  }
}

start();
