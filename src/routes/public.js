import { Router } from "express";
import { Category } from "../models/Category.js";
import { FeaturedItem } from "../models/FeaturedItem.js";
import { HotSellingItem } from "../models/HotSellingItem.js";
import { Product } from "../models/Product.js";
import { SiteSettings } from "../models/SiteSettings.js";

const router = Router();

async function getSiteData() {
  const [settings, categories, featured, hotSelling] = await Promise.all([
    SiteSettings.findOne({ key: "site" }),
    Category.find().sort({ name: 1 }),
    FeaturedItem.find().sort({ createdAt: -1 }),
    HotSellingItem.find().sort({ createdAt: -1 }),
  ]);

  return {
    settings,
    categories,
    featured,
    hotSelling,
  };
}

router.get("/site", async (_req, res, next) => {
  try {
    const data = await getSiteData();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/categories/:slug", async (req, res, next) => {
  try {
    const { slug } = req.params;
    const category = await Category.findOne({ slug });

    if (!category) {
      return res.status(404).json({ message: "Category not found." });
    }

    const [products, relatedCategories, site] = await Promise.all([
      Product.find({ categorySlug: slug }).sort({ position: 1, createdAt: 1 }),
      Category.find({ slug: { $ne: slug } }).sort({ name: 1 }).limit(6),
      getSiteData(),
    ]);

    res.json({
      site,
      category,
      products,
      relatedCategories,
    });
  } catch (error) {
    next(error);
  }
});

export { router as publicRouter };
