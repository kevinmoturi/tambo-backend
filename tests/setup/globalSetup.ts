import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * Starts ONE mongod for the entire run. Previously each test file started its
 * own, which on a small machine meant several servers competing for CPU and
 * intermittent failures under `--maxWorkers > 1`. Workers isolate themselves by
 * using a separate database name instead (see helpers/db.ts).
 *
 * mongodb-memory-server defaults to a MongoDB 8.x binary that will not run on
 * macOS 12 or older; override with MONGOMS_VERSION where a newer one is fine.
 */
export default async function globalSetup(): Promise<void> {
  const mongod = await MongoMemoryServer.create({
    binary: { version: process.env.MONGOMS_VERSION ?? '6.0.14' },
  });

  // read by globalTeardown
  (globalThis as { __MONGOD__?: MongoMemoryServer }).__MONGOD__ = mongod;

  // workers are forked after this runs, so they inherit the URI
  process.env.MONGO_TEST_URI = mongod.getUri();
}
