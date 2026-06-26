import mongoose from "mongoose";
import { applyCleanJson } from "./helpers/applyCleanJson.js";

const hotSellingItemSchema = new mongoose.Schema(
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
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
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

applyCleanJson(hotSellingItemSchema);

export const HotSellingItem = mongoose.model("HotSellingItem", hotSellingItemSchema);
