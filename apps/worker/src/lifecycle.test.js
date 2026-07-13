import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupGracefulShutdown } from './lifecycle.js';
import * as health from './health.js';

vi.mock('./health.js', () => ({
  setReady: vi.fn(),
  stopHealthServer: vi.fn().mockResolvedValue(),
}));

vi.mock('@workspace/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('Worker Lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers SIGINT and SIGTERM handlers', () => {
    const worker = { close: vi.fn().mockResolvedValue() };
    const connection = { quit: vi.fn() };
    const mockProcess = {
      on: vi.fn(),
      exit: vi.fn(),
    };

    setupGracefulShutdown(worker, connection, mockProcess);

    expect(mockProcess.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(mockProcess.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  });

  it('performs graceful shutdown successfully', async () => {
    const worker = { close: vi.fn().mockResolvedValue() };
    const connection = { quit: vi.fn() };
    const mockProcess = {
      on: vi.fn(),
      exit: vi.fn(),
    };

    const shutdown = setupGracefulShutdown(worker, connection, mockProcess);

    await shutdown();

    expect(health.setReady).toHaveBeenCalledWith(false);
    expect(worker.close).toHaveBeenCalled();
    expect(connection.quit).toHaveBeenCalled();
    expect(health.stopHealthServer).toHaveBeenCalled();
    expect(mockProcess.exit).toHaveBeenCalledWith(0);
  });
});
