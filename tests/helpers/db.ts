import crypto from 'crypto';
import mongoose from 'mongoose';

/**
 * Connects to the shared in-memory mongod started in globalSetup.
 *
 * The database name is random per test FILE, not per jest worker: a suite jest
 * decides to run in-band has no JEST_WORKER_ID, so worker-derived names
 * collapse onto one database and two suites clear each other's documents
 * mid-flight - the source of a whole family of "impossible" intermittent
 * failures. A random name cannot collide.
 */
export const connectTestDb = async (): Promise<void> => {
  const uri = process.env.MONGO_TEST_URI;
  if (!uri) {
    throw new Error('MONGO_TEST_URI is not set - globalSetup did not run.');
  }

  await mongoose.connect(uri, {
    dbName: `tambo_test_${crypto.randomUUID().slice(0, 8)}`,
  });

  // Unique-index semantics (duplicate detection, one-open-episode) must exist
  // BEFORE the first write - mongoose builds indexes asynchronously, and a
  // write racing an unbuilt unique index can slip a duplicate in. Mirrors the
  // same guard in src/config/database.ts.
  await Promise.all(
    mongoose.modelNames().map((name) => mongoose.model(name).createIndexes()),
  );
};

/**
 * Wipes documents between tests without paying to drop and recreate indexes.
 * Enumerated at the DRIVER level, not mongoose.connection.collections - GridFS
 * buckets (evidence media) are not mongoose models and would otherwise leak
 * across tests.
 */
export const clearTestDb = async (): Promise<void> => {
  const db = mongoose.connection.db;
  if (!db) return;
  const collections = await db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
};

export const closeTestDb = async (): Promise<void> => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
};
