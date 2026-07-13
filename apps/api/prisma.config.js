import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  engine: 'classic',
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
