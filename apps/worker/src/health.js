import http from 'http';
import { logger } from '@workspace/logger';

let isReady = false;

/**
 * Updates the readiness state of the worker.
 * @param {boolean} status
 */
export function setReady(status) {
  isReady = status;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    if (isReady) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', ready: true }));
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', ready: false }));
    }
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = process.env.PORT || 3003;

export function startHealthServer() {
  server.listen(PORT, () => {
    logger.info(`Worker health server listening on port ${PORT}`);
  });
}

export function stopHealthServer() {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
