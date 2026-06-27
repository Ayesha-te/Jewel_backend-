import { Router } from "express";
import { Category } from "../models/Category.js";
import { FeaturedItem } from "../models/FeaturedItem.js";
import { HotSellingItem } from "../models/HotSellingItem.js";
import { Order } from "../models/Order.js";
import { Product } from "../models/Product.js";
import { SiteSettings } from "../models/SiteSettings.js";

const router = Router();
const categoryListProjection = "slug name description designs image";
const categoryDetailProjection = `${categoryListProjection} galleryImages`;
const featuredProjection = "title image";
const hotSellingProjection = "title image slug";
const productProjection = "title categorySlug image images colors price basePrice deliveryCharge description featured hotSelling position";
const siteSettingsProjection = "whatsappNumber whatsappLink instagram instagramLink facebookLink tiktokLink email address storeHours defaultDeliveryCharge";

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

function getRequiredString(value, fieldName) {
  const normalized = value?.toString().trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

function parseProductId(rawId) {
  const value = rawId?.toString() || "";
  if (value.startsWith("product:")) {
    return value.split(":")[1] || "";
  }

  return value;
}

router.post("/orders", async (req, res, next) => {
  try {
    const customer = {
      name: getRequiredString(req.body?.customer?.name, "Name"),
      email: getRequiredString(req.body?.customer?.email, "Email").toLowerCase(),
      phone: getRequiredString(req.body?.customer?.phone, "Contact number"),
      address: getRequiredString(req.body?.customer?.address, "Address"),
      notes: req.body?.customer?.notes?.toString().trim() || "",
    };

    const submittedItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (submittedItems.length === 0) {
      return res.status(400).json({ message: "Please add at least one item to your cart." });
    }

    const settings = await SiteSettings.findOne({ key: "site" }).select("defaultDeliveryCharge").lean();
    const defaultDeliveryCharge = Math.max(0, Number(settings?.defaultDeliveryCharge || 0));
    const productIds = submittedItems.map((item) => parseProductId(item?.productId || item?.id)).filter(Boolean);
    const products = await Product.find({ _id: { $in: productIds } }).select(productProjection).lean();
    const productsById = new Map(products.map((product) => [product._id.toString(), product]));

    const items = submittedItems.map((item, index) => {
      const productId = parseProductId(item?.productId || item?.id);
      const product = productId ? productsById.get(productId) : null;
      const quantity = Math.max(1, Number(item?.quantity || 1));
      const productName = (product?.title || item?.title || `Item ${index + 1}`).toString().trim();
      const color = item?.color?.toString().trim() || "";
      const unitPrice = Math.max(0, Number(product?.price ?? item?.price ?? 0));
      const basePrice = Math.max(0, Number(product?.basePrice ?? item?.basePrice ?? 0));
      const deliveryCharge = Math.max(0, Number(product?.deliveryCharge || 0));

      return {
        productId: product?._id,
        productName,
        color,
        quantity,
        unitPrice,
        basePrice,
        deliveryCharge,
        image: product?.image || item?.image?.toString().trim() || "",
      };
    });

    const subtotal = items.reduce((total, item) => total + item.unitPrice * item.quantity, 0);
    const itemDeliveryTotal = items.reduce((total, item) => total + item.deliveryCharge * item.quantity, 0);
    const deliveryTotal = itemDeliveryTotal > 0 ? itemDeliveryTotal : defaultDeliveryCharge;
    const order = await Order.create({
      customer,
      items,
      paymentMethod: "COD",
      subtotal,
      deliveryTotal,
      total: subtotal + deliveryTotal,
    });

    res.status(201).json({ order });
  } catch (error) {
    next(error);
  }
});

export { router as publicRouter };
