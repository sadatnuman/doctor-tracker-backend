import { createApp } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { env } from './config/env.js';
import { releaseExpiredHolds } from './services/slot.service.js';

/** Unpaid holds are also released lazily on every slot read; this keeps lists tidy too. */
const HOLD_SWEEP_MS = 30_000;

async function main() {
  await connectDB();
  const server = createApp().listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  const sweeper = setInterval(() => {
    releaseExpiredHolds().catch((err) => console.error('Hold sweep failed', err));
  }, HOLD_SWEEP_MS);
  sweeper.unref();

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down…`);
    clearInterval(sweeper);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
