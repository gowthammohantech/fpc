import { connectDatabase, disconnectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createApp } from './app.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';

async function main(): Promise<void> {
  await connectDatabase();

  const app = createApp();
  startScheduler();

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'finance operations API listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopScheduler();
    server.close(() => {
      void disconnectDatabase().finally(() => process.exit(0));
    });
    // Do not hang forever on an in-flight request.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.fatal({ err: error }, 'failed to start');
  process.exit(1);
});
