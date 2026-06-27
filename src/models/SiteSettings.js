import mongoose from "mongoose";
import { applyCleanJson } from "./helpers/applyCleanJson.js";

const siteSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: "site",
    },
    whatsappNumber: {
      type: String,
      required: true,
      trim: true,
    },
    whatsappLink: {
      type: String,
      required: true,
      trim: true,
    },
    instagram: {
      type: String,
      required: true,
      trim: true,
    },
    instagramLink: {
      type: String,
      required: true,
      trim: true,
    },
    facebookLink: {
      type: String,
      required: true,
      trim: true,
    },
    tiktokLink: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      required: true,
      trim: true,
    },
    storeHours: {
      type: String,
      required: true,
      trim: true,
      default: "10 AM - 10 PM",
    },
    defaultDeliveryCharge: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
);

applyCleanJson(siteSettingsSchema);

export const SiteSettings = mongoose.model("SiteSettings", siteSettingsSchema);
