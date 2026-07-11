import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { loadConfig } from './load-config.js';

describe('loadConfig', () => {
  let originalExit;
  let originalConsoleError;
  let mockExit;
  let mockConsoleError;

  beforeEach(() => {
    // Store original functions
    originalExit = process.exit;
    originalConsoleError = console.error;

    // Create mocks
    mockExit = vi.fn();
    mockConsoleError = vi.fn();

    // Replace globals with mocks
    process.exit = mockExit;
    console.error = mockConsoleError;
  });

  afterEach(() => {
    // Restore original functions
    process.exit = originalExit;
    console.error = originalConsoleError;
  });

  it('should return parsed config for valid environment variables', () => {
    const schema = z.object({
      PORT: z.coerce.number(),
      NODE_ENV: z.enum(['development', 'production', 'test']),
    });

    const env = {
      PORT: '3000',
      NODE_ENV: 'test',
    };

    const config = loadConfig(schema, env);

    expect(config).toEqual({
      PORT: 3000,
      NODE_ENV: 'test',
    });
    expect(mockExit).not.toHaveBeenCalled();
    expect(mockConsoleError).not.toHaveBeenCalled();
  });

  it('should log errors and exit process on missing required variables', () => {
    const schema = z.object({
      PORT: z.coerce.number(),
      MISSING_VAR: z.string(),
    });

    const env = {
      PORT: '3000',
      // MISSING_VAR is omitted
    };

    const config = loadConfig(schema, env);

    expect(mockConsoleError).toHaveBeenCalledWith('❌ Environment Variable Validation Failed:');
    expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('MISSING_VAR'));
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(config).toBeUndefined(); // Because it would have exited
  });

  it('should log errors and exit process on malformed variables', () => {
    const schema = z.object({
      PORT: z.coerce.number(),
    });

    const env = {
      PORT: 'not-a-number',
    };

    const config = loadConfig(schema, env);

    expect(mockConsoleError).toHaveBeenCalledWith('❌ Environment Variable Validation Failed:');
    expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('PORT'));
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(config).toBeUndefined();
  });
});
