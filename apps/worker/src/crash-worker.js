import IORedis from 'ioredis';
import { Worker } from 'bullmq';

const connection = new IORedis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null });

const worker = new Worker(
  'crash_test_queue',
  async (job) => {
    if (job.data.crash) {
      const count = await connection.incr(`crash_count:${job.id}`);
      if (count === 1) {
        console.log('Crashing mid-process on first attempt...');
        process.exit(1);
      }
    }
    console.log('Processed job successfully:', job.id);
    return { success: true };
  },
  {
    connection,
    stalledInterval: 1000,
    lockDuration: 2000, // Small lock duration so it recovers quickly
  },
);

worker.on('ready', () => {
  console.log('Worker is ready');
});
