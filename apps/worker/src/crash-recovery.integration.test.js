import { describe, it, expect } from 'vitest';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Worker Crash-Recovery', () => {
  it('recovers stalled jobs after worker crash', async () => {
    const connection = new IORedis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null });
    const queue = new Queue('crash_test_queue', { connection });

    // Clear queue before test
    await queue.obliterate({ force: true });

    // Clear previous crash counters to ensure fresh state
    const keys = await connection.keys('crash_count:*');
    if (keys.length > 0) {
      await connection.del(...keys);
    }

    // Add job that will crash the first worker
    await queue.add(
      'test',
      { crash: true },
      {
        attempts: 3, // Allow retries
      },
    );

    const workerPath = path.join(__dirname, 'crash-worker.js');

    // 1. Spawn Worker 1 (Will crash)
    const worker1 = spawn('node', [workerPath], { env: process.env });
    worker1.stdout.on('data', (d) => console.log('W1 STDOUT:', d.toString()));
    worker1.stderr.on('data', (d) => console.log('W1 STDERR:', d.toString()));

    const worker1Crash = new Promise((resolve) => {
      worker1.on('exit', (code) => resolve(code));
    });

    const code = await worker1Crash;
    expect(code).toBe(1); // Confirm it crashed

    // 2. Spawn Worker 2
    const worker2 = spawn('node', [workerPath], { env: process.env });

    let stdout = '';
    const worker2Success = new Promise((resolve) => {
      worker2.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.includes('Processed job successfully')) {
          resolve(true);
        }
      });
    });

    // Wait for the stalled job to be recovered (stalledInterval is 1000ms)
    worker2.stdout.on('data', (d) => console.log('W2 STDOUT:', d.toString()));
    worker2.stderr.on('data', (d) => console.log('W2 STDERR:', d.toString()));

    const success = await worker2Success;
    expect(success).toBe(true);

    worker2.kill('SIGKILL');
    await connection.quit();
  }, 15000);
});
