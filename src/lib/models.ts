/* eslint-disable */
/* Define Mongoose models: UserProfile, Passion, Curriculum, Chapter */
import { Schema, model, models } from "mongoose";

const ChapterSchema = new Schema({
  userId: String,
  passionId: String,
  week: Number,
  s3Key: String,
  createdAt: { type: Date, default: Date.now },
});

const CurriculumSchema = new Schema({
  userId: String,
  passionId: String,
  title: String,
  s3Key: String,
  weeks: [{ title: String }],
  createdAt: { type: Date, default: Date.now },
});

const PassionSchema = new Schema({
  userId: String,
  name: String,
  createdAt: { type: Date, default: Date.now },
});

const UserSchema = new Schema({
  userId: String,
  name: String,
  email: String,
  age: Number,
  lastSeenAt: { type: Date, default: Date.now },
});

export const Chapter = models.Chapter || model("Chapter", ChapterSchema);
export const Curriculum = models.Curriculum || model("Curriculum", CurriculumSchema);
export const Passion = models.Passion || model("Passion", PassionSchema);
export const UserProfile = models.UserProfile || model("UserProfile", UserSchema);
