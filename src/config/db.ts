import mongoose from 'mongoose';
import { env } from './env.js';

mongoose.set('strictQuery', true);

export async function connectDB(uri: string = env.MONGODB_URI): Promise<typeof mongoose> {
  const conn = await mongoose.connect(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10_000,
    // Build indexes automatically outside production; in production they are synced explicitly.
    autoIndex: !env.isProduction,
  });
  if (env.isProduction) {
    await Promise.all(Object.values(conn.models).map((model) => model.syncIndexes()));
  }
  return conn;
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}
