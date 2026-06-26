import bcrypt from "bcryptjs";
import { AdminUser } from "../models/AdminUser.js";
import { SiteSettings } from "../models/SiteSettings.js";
import { defaultSiteSettings } from "../config/defaultData.js";

export async function ensureSiteSettings() {
  const settings = await SiteSettings.findOne({ key: "site" });
  if (settings) {
    return settings;
  }

  return SiteSettings.create(defaultSiteSettings);
}

export async function ensureSuperUser() {
  const name = process.env.SUPERUSER_NAME || "Super Admin";
  const email = (process.env.SUPERUSER_EMAIL || "admin@manijewellers.local").toLowerCase().trim();
  const password = process.env.SUPERUSER_PASSWORD || "Admin@12345";

  const existingUser = await AdminUser.findOne({ email });
  if (existingUser) {
    return existingUser;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  return AdminUser.create({
    name,
    email,
    passwordHash,
    role: "super-admin",
  });
}
