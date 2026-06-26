import mongoose from "mongoose";
import { applyCleanJson } from "./helpers/applyCleanJson.js";

const featuredItemSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
      required: true,
      trim: true,
    },
    sourceProductId: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

applyCleanJson(featuredItemSchema);

export const FeaturedItem = mongoose.model("FeaturedItem", featuredItemSchema);
