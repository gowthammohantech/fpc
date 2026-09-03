import mongoose from 'mongoose';

/**
 * Spins up an in-memory MongoDB for integration tests.
 *
 * `mongodb-memory-server` downloads a mongod binary on first use. In sandboxes
 * where that download is blocked, `available()` returns false and the
 * integration suites skip themselves with a clear message rather than failing
 * for an environmental reason. Set MONGO_TEST_URI to point at a real instance
 * to run them regardless.
 */
let memoryServer: { getUri(): string; stop(): Promise<boolean> } | null = null;
let skipReason: string | null = null;

export async function startTestDatabase(): Promise<string | null> {
  if (process.env.MONGO_TEST_URI) {
    await mongoose.connect(process.env.MONGO_TEST_URI);
    return process.env.MONGO_TEST_URI;
  }

  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    const uri = memoryServer.getUri();
    await mongoose.connect(uri);
    return uri;
  } catch (error) {
    skipReason = `in-memory MongoDB unavailable (${(error as Error).message.split('\n')[0]}). ` +
      'Set MONGO_TEST_URI to run database integration tests.';
    return null;
  }
}

export async function stopTestDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  await memoryServer?.stop();
  memoryServer = null;
}

export async function clearTestDatabase(): Promise<void> {
  const collections = await mongoose.connection.db?.collections();
  for (const collection of collections ?? []) await collection.deleteMany({});
}

export function databaseSkipReason(): string | null {
  return skipReason;
}
