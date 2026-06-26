import mongoose from "mongoose";
import { applyCleanJson } from "./helpers/applyCleanJson.js";

const categorySchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    designs: {
      type: Number,
      default: 0,
      min: 0,
    },
    image: {
      type: String,
      trim: true,
      default: "",
    },
    galleryImages: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

applyCleanJson(categorySchema);

export const Category = mongoose.model("Category", categorySchema);
