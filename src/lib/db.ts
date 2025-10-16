/* eslint-disable */
import mongoose from "mongoose";
let cached = (global as any)._mongo as typeof mongoose | undefined;

export async function connectDB() {
  if (cached && mongoose.connection.readyState === 1) return cached;
  const conn = await mongoose.connect(process.env.MONGODB_URI!, { dbName: "textbook_creator" });
  (global as any)._mongo = conn;
  return conn;
}
 
