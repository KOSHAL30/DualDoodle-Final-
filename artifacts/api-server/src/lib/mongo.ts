import mongoose from "mongoose";
import { logger } from "./logger";

const MONGODB_URI = process.env["MONGODB_URI"];

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI environment variable is required");
}

let connected = false;

export async function connectMongo(): Promise<void> {
  if (connected) return;
  let uri = MONGODB_URI as string;
  const isCloudDeploy = Boolean(
    process.env.RENDER ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.VERCEL ||
    process.env.FLY_APP_NAME
  );

  if (uri === "memory") {
    logger.info("Starting in-memory MongoDB server...");
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    const mongod = await MongoMemoryServer.create();
    uri = mongod.getUri();
    logger.info({ uri }, "In-memory MongoDB started");
    await mongoose.connect(uri);
    connected = true;
    logger.info("MongoDB connected");
    return;
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
    connected = true;
    logger.info("MongoDB connected");
  } catch (err) {
    if (!isCloudDeploy) {
      try {
        const localUri = "mongodb://127.0.0.1:27017/dualdoodle";
        await mongoose.connect(localUri, { serverSelectionTimeoutMS: 2000 });
        connected = true;
        logger.info({ uri: localUri }, "Connected to local MongoDB instance as fallback");
        return;
      } catch {
        // Local MongoDB not available, fallback to in-memory
      }
      logger.warn(
        { err },
        "MongoDB Atlas connection failed (likely local IP address not in Atlas Network Access whitelist). Falling back to in-memory MongoDB for local execution.",
      );
      const { MongoMemoryServer } = await import("mongodb-memory-server");
      const mongod = await MongoMemoryServer.create();
      uri = mongod.getUri();
      await mongoose.connect(uri);
      connected = true;
      logger.info({ uri }, "In-memory MongoDB connected as fallback");
      return;
    }
    logger.error({ err }, "MongoDB connection failed");
    throw err;
  }
}
