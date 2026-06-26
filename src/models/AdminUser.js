import mongoose from "mongoose";
import { applyCleanJson } from "./helpers/applyCleanJson.js";

const adminUserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      default: "super-admin",
      enum: ["super-admin"],
    },
    lastLoginAt: Date,
  },
  {
    timestamps: true,
  },
);

applyCleanJson(adminUserSchema);

export const AdminUser = mongoose.model("AdminUser", adminUserSchema);
