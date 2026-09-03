import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

mongoose.set('strictQuery', true);
// Surface a query that forgot its tenant filter as an error in development
// rather than silently returning another tenant's documents.
mongoose.set('sanitizeFilter', true);

export async function connectDatabase(uri = env.MONGO_URI): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;

  mongoose.connection.on('error', (error) =>
    logger.error({ err: error }, 'mongo connection error'),
  );
  mongoose.connection.on('disconnected', () => logger.warn('mongo disconnected'));

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    autoIndex: env.NODE_ENV !== 'production',
  });
  logger.info({ uri: uri.replace(/\/\/.*@/, '//***@') }, 'mongo connected');
  return mongoose;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.connection.close();
}

/**
 * Runs `fn` inside a transaction when the deployment supports them (replica
 * set), and plainly otherwise. Standalone Mongo — which is what
 * `docker compose up` gives you — does not support transactions, and the
 * reconciliation flow must still work there.
 */
export async function withTransaction<T>(
  fn: (session: mongoose.ClientSession | undefined) => Promise<T>,
): Promise<T> {
  const supportsTransactions = !!mongoose.connection.db && hasReplicaSet();
  if (!supportsTransactions) return fn(undefined);

  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function hasReplicaSet(): boolean {
  const client = mongoose.connection.getClient() as unknown as {
    topology?: { s?: { description?: { type?: string } } };
  };
  const type = client?.topology?.s?.description?.type;
  return type === 'ReplicaSetWithPrimary' || type === 'Sharded';
}
