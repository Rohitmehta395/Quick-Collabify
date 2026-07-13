import { describe, it, expect, vi, beforeEach } from 'vitest';

// Define the hoisted variables before any imports
const { captureStream, logOutput } = vi.hoisted(() => {
  const state = { output: '' };
  const stream = new (require('node:stream').Writable)({
    write(chunk, encoding, callback) {
      state.output += chunk.toString();
      callback();
    },
  });
  return { captureStream: stream, logOutput: state };
});

vi.mock('@workspace/logger', async (importOriginal) => {
  const actual = await importOriginal();
  const testLogger = require('pino')(
    {
      level: 'info',
      formatters: { level: (label) => ({ level: label }) },
      redact: {
        paths: [
          'password',
          'token',
          'secret',
          'authorization',
          'cookie',
          'accessToken',
          'refreshToken',
        ],
        censor: '[REDACTED]',
      },
    },
    captureStream,
  );
  return { ...actual, logger: testLogger };
});

vi.mock('postmark', () => {
  const sendEmailMock = vi.fn();
  class ServerClientMock {
    constructor() {
      this.sendEmail = sendEmailMock;
    }
  }
  return {
    ServerClient: ServerClientMock,
    __sendEmailMock: sendEmailMock,
  };
});

vi.mock('../../api/src/notifications/notification-event-repository.js', () => ({
  getNotificationEventByIdempotencyKey: vi.fn(),
  updateNotificationEventStatus: vi.fn(),
}));

vi.mock('../../api/src/db.js', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

vi.mock('@workspace/config', () => ({
  loadConfig: () => ({
    POSTMARK_API_KEY: 'test-key',
    EMAIL_FROM_ADDRESS: 'test@example.com',
  }),
  workerEnvSchema: {},
}));

// Import processor AFTER mocks
import { processEmailJob } from './processors/email-processor.js';
import * as repo from '../../api/src/notifications/notification-event-repository.js';
import { prisma } from '../../api/src/db.js';
import { __sendEmailMock } from 'postmark';

describe('Log-Content Security Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logOutput.output = '';
  });

  const job = {
    id: 'job-1',
    data: {
      userId: '59263bc7-16e2-4b87-9bb9-42c579715fd7',
      idempotencyKey: 'test-key',
    },
  };

  it('does not log forbidden content during a successful job flow', async () => {
    repo.getNotificationEventByIdempotencyKey.mockResolvedValue({ status: 'pending' });
    prisma.user.findUnique.mockResolvedValue({
      id: '59263bc7-16e2-4b87-9bb9-42c579715fd7',
      email: 'test@example.com',
      displayName: 'Test User',
    });
    __sendEmailMock.mockResolvedValue({ MessageID: 'fake-message-id' });
    repo.updateNotificationEventStatus.mockResolvedValue({});

    await processEmailJob(job);

    expect(logOutput.output.length).toBeGreaterThan(0);
    // Should log the abstract info, but not full payloads
    expect(logOutput.output).toContain('fake-message-id');
    // Ensure we do not log the full email body since it's not even generated yet
    expect(logOutput.output).not.toContain('htmlBody');
  });

  it('does not log provider API key or unfiltered errors during a failure', async () => {
    repo.getNotificationEventByIdempotencyKey.mockResolvedValue({ status: 'pending' });
    prisma.user.findUnique.mockResolvedValue({
      id: '59263bc7-16e2-4b87-9bb9-42c579715fd7',
      email: 'test@example.com',
    });

    const FAKE_API_KEY = 'secret-postmark-key-12345';
    const error = new Error('Postmark API Error');
    error.config = {
      headers: {
        'X-Postmark-Server-Token': FAKE_API_KEY,
      },
    };
    error.response = {
      data: { ErrorCode: 10, Message: 'Bad Key' },
    };

    __sendEmailMock.mockRejectedValue(error);
    repo.updateNotificationEventStatus.mockResolvedValue({});

    await expect(processEmailJob(job)).rejects.toThrow();

    expect(logOutput.output.length).toBeGreaterThan(0);

    // Check if the API key was leaked.
    // If it was leaked, the test should fail so we can fix it!
    expect(logOutput.output).not.toContain(FAKE_API_KEY);
  });
});
