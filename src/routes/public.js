import { Router } from "express";
import { Category } from "../models/Category.js";
import { FeaturedItem } from "../models/FeaturedItem.js";
import { HotSellingItem } from "../models/HotSellingItem.js";
import { Product } from "../models/Product.js";
import { SiteSettings } from "../models/SiteSettings.js";

const router = Router();
const categoryListProjection = "slug name description designs image";
const categoryDetailProjection = `${categoryListProjection} galleryImages`;
const featuredProjection = "title image";
const hotSellingProjection = "title image slug";
const productProjection = "title categorySlug image price description featured hotSelling position";
const siteSettingsProjection = "whatsappNumber whatsappLink instagram instagramLink facebookLink tiktokLink email address storeHours";

function normalizeDoc(document) {
  if (!document) {
    return null;
  }

  const { _id, __v, ...rest } = document;
  return {
    ...rest,
    id: typeof _id?.toString === "function" ? _id.toString() : _id,
  };
}

function normalizeDocs(documents) {
  return documents.map(normalizeDoc);
}

function setPublicCacheHeaders(res) {
  res.set("Cache-Control", "public, max-age=60, s-maxage=120, stale-while-revalidate=600");
}

async function getSiteChromeData() {
  const [settings, categories] = await Promise.all([
    SiteSettings.findOne({ key: "site" }).select(siteSettingsProjection).lean(),
    Category.find().select(categoryListProjection).sort({ name: 1 }).lean(),
  ]);

  return {
    settings: normalizeDoc(settings),
    categories: normalizeDocs(categories),
  };
}

async function getSiteData() {
  const [siteChrome, featured, hotSelling] = await Promise.all([
    getSiteChromeData(),
    FeaturedItem.find().select(featuredProjection).sort({ createdAt: -1 }).lean(),
    HotSellingItem.find().select(hotSellingProjection).sort({ createdAt: -1 }).lean(),
  ]);

  return {
    ...siteChrome,
    featured: normalizeDocs(featured),
    hotSelling: normalizeDocs(hotSelling),
  };
}

router.get("/site", async (_req, res, next) => {
  try {
    setPublicCacheHeaders(res);
    const data = await getSiteData();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/categories/:slug", async (req, res, next) => {
  try {
    const { slug } = req.params;
    setPublicCacheHeaders(res);
    const category = await Category.findOne({ slug }).select(categoryDetailProjection).lean();

    if (!category) {
      return res.status(404).json({ message: "Category not found." });
    }

    const [products, relatedCategories, siteChrome] = await Promise.all([
      Product.find({ categorySlug: slug }).select(productProjection).sort({ position: 1, createdAt: 1 }).lean(),
      Category.find({ slug: { $ne: slug } }).select(categoryListProjection).sort({ name: 1 }).limit(6).lean(),
      getSiteChromeData(),
    ]);

    res.json({
      site: {
        ...siteChrome,
        featured: [],
        hotSelling: [],
      },
      category: normalizeDoc(category),
      products: normalizeDocs(products),
      relatedCategories: normalizeDocs(relatedCategories),
    });
  } catch (error) {
    next(error);
  }
});

export { router as publicRouter };
