import { describe, it, expect } from 'vitest';
import { deriveIdempotencyKey } from './idempotency-key.js';

describe('deriveIdempotencyKey', () => {
  it('should generate deterministic keys for the same user and event', () => {
    const userId = '59263bc7-16e2-4b87-9bb9-42c579715fd7';
    const eventType = 'welcome_email';

    const key1 = deriveIdempotencyKey(userId, eventType);
    const key2 = deriveIdempotencyKey(userId, eventType);

    expect(key1).toBe(key2);
  });

  it('should generate different keys for different users', () => {
    const eventType = 'welcome_email';

    const key1 = deriveIdempotencyKey('12345678-1234-1234-1234-1234567890ab', eventType);
    const key2 = deriveIdempotencyKey('87654321-4321-4321-4321-ba0987654321', eventType);

    expect(key1).not.toBe(key2);
  });

  it('should generate different keys for different events for the same user', () => {
    const userId = '59263bc7-16e2-4b87-9bb9-42c579715fd7';

    const key1 = deriveIdempotencyKey(userId, 'welcome_email');
    const key2 = deriveIdempotencyKey(userId, 'password_reset');

    expect(key1).not.toBe(key2);
  });
});
