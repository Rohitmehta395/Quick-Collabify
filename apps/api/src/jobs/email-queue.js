import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { loadConfig, apiEnvSchema } from '@workspace/config';

const config = loadConfig(apiEnvSchema);

// Reuse or create a Redis connection for the queue.
// In a full application lifecycle we'd likely pass in a shared connection,
// but for the sake of module isolation here we initialize it for BullMQ.
const connection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});

/**
 * We define the Queue instance in apps/api because the API process is the one
 * that enqueues jobs and requires the Queue class. The worker process only
 * requires the queue name string ('email') for its Worker instance.
 *
 * Default Job Options:
 * - attempts: 3 (Bounded retry count per Spec A 5.4)
 * - backoff: exponential starting at 5000ms (Gives providers room to recover)
 * - removeOnComplete: true (Keep Redis clean)
 * - removeOnFail: false (Allows inspection of terminal failures)
 */
export const emailQueue = new Queue('email', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});
