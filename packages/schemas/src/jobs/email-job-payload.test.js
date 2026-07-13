import { describe, it, expect } from 'vitest';
import { emailJobPayloadSchema } from './email-job-payload.js';

describe('emailJobPayloadSchema', () => {
  it('should accept a valid payload', () => {
    const validPayload = {
      userId: '59263bc7-16e2-4b87-9bb9-42c579715fd7',
      idempotencyKey: 'some_hash_string_here',
    };

    expect(() => emailJobPayloadSchema.parse(validPayload)).not.toThrow();
  });

  it('should reject a payload missing userId', () => {
    const invalidPayload = {
      idempotencyKey: 'some_hash_string_here',
    };

    expect(() => emailJobPayloadSchema.parse(invalidPayload)).toThrow();
  });

  it('should reject a payload with an invalid UUID for userId', () => {
    const invalidPayload = {
      userId: 'not-a-uuid',
      idempotencyKey: 'some_hash_string_here',
    };

    expect(() => emailJobPayloadSchema.parse(invalidPayload)).toThrow();
  });

  it('should reject a payload missing idempotencyKey', () => {
    const invalidPayload = {
      userId: '59263bc7-16e2-4b87-9bb9-42c579715fd7',
    };

    expect(() => emailJobPayloadSchema.parse(invalidPayload)).toThrow();
  });

  it('should strip out extra fields to enforce minimal reference (when using .parse)', () => {
    // Note: By default Zod strips extra fields rather than throwing, unless .strict() is used.
    // The spec mandates we don't pass full profile data, so we verify extra data is dropped
    // or rejected. Let's just verify it strips them, keeping it minimal.
    const payloadWithExtra = {
      userId: '59263bc7-16e2-4b87-9bb9-42c579715fd7',
      idempotencyKey: 'some_hash_string_here',
      email: 'test@example.com',
      name: 'Test User',
    };

    const parsed = emailJobPayloadSchema.parse(payloadWithExtra);

    expect(parsed).toEqual({
      userId: '59263bc7-16e2-4b87-9bb9-42c579715fd7',
      idempotencyKey: 'some_hash_string_here',
    });
    expect(parsed.email).toBeUndefined();
    expect(parsed.name).toBeUndefined();
  });
});
