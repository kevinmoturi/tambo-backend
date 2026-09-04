import mongoose from 'mongoose';

/**
 * Connects to the shared in-memory mongod started in globalSetup. Each jest
 * worker gets its own database so parallel suites cannot see each other's
 * documents while still sharing one server process.
 */
export const connectTestDb = async (): Promise<void> => {
  const uri = process.env.MONGO_TEST_URI;
  if (!uri) {
    throw new Error('MONGO_TEST_URI is not set - globalSetup did not run.');
  }

  await mongoose.connect(uri, {
    dbName: `tambo_test_${process.env.JEST_WORKER_ID ?? '1'}`,
  });
};

/** Wipes documents between tests without paying to drop and recreate indexes. */
export const clearTestDb = async (): Promise<void> => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({}),
    ),
  );
};

export const closeTestDb = async (): Promise<void> => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
};
