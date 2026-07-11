import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';

describe('GET /health', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    const app = buildApp();
    return new Promise((resolve) => {
      // Listen on port 0 to allocate an ephemeral port
      server = app.listen(0, () => {
        const address = server.address();
        baseUrl = `http://localhost:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    return new Promise((resolve) => {
      server.close(resolve);
    });
  });

  it('should return 200 OK and status "ok"', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      status: 'ok',
      timestamp: expect.any(String),
    });
  });
});
