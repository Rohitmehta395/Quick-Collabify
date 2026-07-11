import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  apiEnvSchema,
  realtimeEnvSchema,
  workerEnvSchema,
  webEnvSchema,
} from './index.js';

describe('.env.example contract', () => {
  it('should satisfy all configuration schemas', () => {
    // Navigate up to the workspace root to find .env.example
    const rootDir = path.resolve(__dirname, '../../../');
    const envExamplePath = path.join(rootDir, '.env.example');

    expect(fs.existsSync(envExamplePath)).toBe(true);

    const envContent = fs.readFileSync(envExamplePath, 'utf-8');
    const envExample = dotenv.parse(envContent);

    // Provide default dynamic vars that are populated at runtime in tests
    const testEnv = {
      ...envExample,
      NODE_ENV: 'test',
    };

    const validate = (schema, name) => {
      const result = schema.safeParse(testEnv);
      if (!result.success) {
        console.error(`Validation failed for ${name}:`, result.error.format());
      }
      expect(result.success, `Schema ${name} is out of sync with .env.example`).toBe(true);
    };

    validate(apiEnvSchema, 'API');
    validate(realtimeEnvSchema, 'Realtime');
    validate(workerEnvSchema, 'Worker');
    validate(webEnvSchema, 'Web');
  });
});
