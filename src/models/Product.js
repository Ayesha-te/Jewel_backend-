import mongoose from "mongoose";
import { applyCleanJson } from "./helpers/applyCleanJson.js";

const productSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    categorySlug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    image: {
      type: String,
      trim: true,
      default: "",
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    featured: {
      type: Boolean,
      default: false,
    },
    hotSelling: {
      type: Boolean,
      default: false,
    },
    position: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
);

applyCleanJson(productSchema);

export const Product = mongoose.model("Product", productSchema);
