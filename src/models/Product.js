import mongoose from "mongoose";
import { applyCleanJson } from "./helpers/applyCleanJson.js";

const productImageSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      trim: true,
      required: true,
    },
    color: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    _id: false,
  },
);

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
    images: {
      type: [productImageSchema],
      default: [],
    },
    colors: {
      type: [String],
      default: [],
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    basePrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    deliveryCharge: {
      type: Number,
      default: 0,
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

// Supports the admin and storefront sort order without forcing MongoDB to sort in memory.
productSchema.index({ categorySlug: 1, position: 1, createdAt: 1 });

applyCleanJson(productSchema);

export const Product = mongoose.model("Product", productSchema);
