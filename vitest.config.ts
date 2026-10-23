import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://placeholder', // replaced by the in-memory server in tests
      JWT_SECRET: 'test-secret-that-is-definitely-longer-than-32-chars',
      SEED_ADMIN_EMAIL: 'admin@test.dev',
      SEED_ADMIN_PASSWORD: 'Password123!',
    },
  },
});
