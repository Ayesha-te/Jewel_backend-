import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Router } from "express";
import { defaultSiteSettings } from "../config/defaultData.js";
import { requireAuth } from "../middleware/auth.js";
import { AdminUser } from "../models/AdminUser.js";
import { Category } from "../models/Category.js";
import { FeaturedItem } from "../models/FeaturedItem.js";
import { HotSellingItem } from "../models/HotSellingItem.js";
import { Order } from "../models/Order.js";
import { Product } from "../models/Product.js";
import { SiteSettings } from "../models/SiteSettings.js";
import { slugify } from "../utils/slugify.js";

const router = Router();

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    },
  );
}

function getRequiredString(value, fieldName) {
  const normalized = value?.toString().trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
    .map((item) => item?.toString().trim() || "")
        .filter(Boolean),
    ),
  );
}

function normalizeDesignImages(value, fallbackImage, designLabel) {
  const legacyImage = fallbackImage?.toString().trim() || "";

  if (!Array.isArray(value) || value.length === 0) {
    if (!legacyImage) {
      throw new Error(`${designLabel} image is required.`);
    }

    return [{ url: legacyImage, color: "" }];
  }

  const images = value
    .map((item) => ({
      url: item?.url?.toString().trim() || item?.image?.toString().trim() || "",
      color: item?.color?.toString().trim() || "",
    }))
    .filter((item) => item.url);

  if (images.length === 0) {
    if (!legacyImage) {
      throw new Error(`${designLabel} image is required.`);
    }

    return [{ url: legacyImage, color: "" }];
  }

  return images;
}

function normalizeDesignItems(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item, index) => {
    const designLabel = `Design ${index + 1}`;
    const title = getRequiredString(item?.title, `${designLabel} name`);
    const price = Number(item?.price);
    const basePrice = Math.max(0, Number(item?.basePrice || 0));
    const deliveryCharge = Math.max(0, Number(item?.deliveryCharge || 0));

    if (Number.isNaN(price) || price <= 0) {
      throw new Error(`${designLabel} price must be a valid positive number.`);
    }

    if (basePrice > 0 && basePrice < price) {
      throw new Error(`${designLabel} original price must be greater than or equal to the selling price.`);
    }

    const colors = normalizeStringArray(item?.colors);
    const images = normalizeDesignImages(item?.images, item?.image, designLabel);
    const imageColors = images.map((imageItem) => imageItem.color).filter(Boolean);
    const mergedColors = Array.from(new Set([...colors, ...imageColors]));

    return {
      id: item?.id?.toString().trim() || "",
      title,
      image: images[0]?.url || "",
      images: images.map((imageItem) => ({
        url: imageItem.url,
        color: imageItem.color && mergedColors.includes(imageItem.color) ? imageItem.color : "",
      })),
      colors: mergedColors,
      price,
      basePrice,
      deliveryCharge,
      description: item?.description?.toString().trim() || "",
      featured: Boolean(item?.featured),
      hotSelling: Boolean(item?.hotSelling),
      position: index,
    };
  });
}

async function removeProductCollections(productIds) {
  if (productIds.length === 0) {
    return;
  }

  await Promise.all([
    FeaturedItem.deleteMany({ sourceProductId: { $in: productIds } }),
    HotSellingItem.deleteMany({ sourceProductId: { $in: productIds } }),
  ]);
}

async function syncProductCollections(product) {
  if (product.featured) {
    await FeaturedItem.findOneAndUpdate(
      { sourceProductId: product.id },
      {
        title: product.title,
        image: product.image,
        sourceProductId: product.id,
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );
  } else {
    await FeaturedItem.deleteOne({ sourceProductId: product.id });
  }

  if (product.hotSelling) {
    await HotSellingItem.findOneAndUpdate(
      { sourceProductId: product.id },
      {
        title: product.title,
        image: product.image,
        slug: product.categorySlug,
        sourceProductId: product.id,
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );
  } else {
    await HotSellingItem.deleteOne({ sourceProductId: product.id });
  }
}

async function syncCategoryProducts({
  currentSlug,
  nextSlug,
  categoryDescription,
  submittedProducts,
}) {
  const existingProducts = await Product.find(
    currentSlug === nextSlug
      ? { categorySlug: nextSlug }
      : { categorySlug: { $in: [currentSlug, nextSlug] } },
  ).sort({ position: 1, createdAt: 1 });

  const existingById = new Map(existingProducts.map((product) => [product.id, product]));

  for (const submittedProduct of submittedProducts) {
    const existingProduct = submittedProduct.id ? existingById.get(submittedProduct.id) : null;
    const product = existingProduct ?? new Product();

    product.title = submittedProduct.title;
    product.categorySlug = nextSlug;
    product.image = submittedProduct.image;
    product.images = submittedProduct.images;
    product.colors = submittedProduct.colors;
    product.price = submittedProduct.price;
    product.basePrice = submittedProduct.basePrice;
    product.deliveryCharge = submittedProduct.deliveryCharge;
    product.description = submittedProduct.description || categoryDescription;
    product.featured = submittedProduct.featured;
    product.hotSelling = submittedProduct.hotSelling;
    product.position = submittedProduct.position;
    await product.save();

    existingById.delete(product.id);
    await syncProductCollections(product);
  }

  const removedProducts = Array.from(existingById.values());
  if (removedProducts.length > 0) {
    await removeProductCollections(removedProducts.map((product) => product.id));
    await Product.deleteMany({ _id: { $in: removedProducts.map((product) => product._id) } });
  }
}

async function getSiteSettingsDocument() {
  const existing = await SiteSettings.findOne({ key: "site" });

  if (existing) {
    return existing;
  }

  return SiteSettings.create(defaultSiteSettings);
}

function escapePdfText(value) {
  return value.toString().replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function createOrderPdf(order) {
  const orderDate = new Date(order.createdAt).toLocaleDateString("en-PK", { year: "numeric", month: "long", day: "numeric" });
  const orderInfo = [
    ["Order Number", order.id.slice(-8).toUpperCase()],
    ["Order Date", orderDate],
    ["Customer Name", order.customer.name],
    ["Phone Number", order.customer.phone],
    ["Email Address", order.customer.email],
    ["Street Address", order.customer.address],
    ["Payment Method", order.paymentMethod],
  ];

  const itemsData = order.items.map((item) => [
    item.productName,
    item.color || "-",
    item.quantity.toString(),
    `PKR ${item.unitPrice.toLocaleString()}`,
    `PKR ${item.deliveryCharge.toLocaleString()}`,
    `PKR ${(item.unitPrice * item.quantity + item.deliveryCharge).toLocaleString()}`,
  ]);

  const lines = [
    "MANI JEWELLER'S AND WATCH - ORDER DETAILS",
    "",
  ];

  orderInfo.forEach(([label, value]) => {
    lines.push(`${label}: ${value}`);
  });

  lines.push("", "ITEMS ORDERED", "");
  lines.push("Product | Color | Qty | Unit Price | Delivery | Total");
  itemsData.forEach((item) => {
    lines.push(item.join(" | "));
  });

  lines.push("");
  lines.push(`Subtotal: PKR ${order.subtotal.toLocaleString()}`);
  lines.push(`Delivery Charges: PKR ${order.deliveryTotal.toLocaleString()}`);
  lines.push(`Grand Total: PKR ${order.total.toLocaleString()}`);

  const content = [
    "BT",
    "/F1 10 Tf",
    "40 780 Td",
    "12 TL",
    ...lines.map((line, index) => {
      if (line === "") {
        return "0 -3 Td";
      }
      return `(${escapePdfText(line)}) Tj T*`;
    }),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf);
}

router.post("/auth/login", async (req, res, next) => {
  try {
    const email = getRequiredString(req.body?.email, "Email").toLowerCase();
    const password = getRequiredString(req.body?.password, "Password");

    const user = await AdminUser.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    user.lastLoginAt = new Date();
    await user.save();

    res.json({
      token: signToken(user),
      user: sanitizeUser(user),
    });
  } catch (error) {
    next(error);
  }
});

router.use(requireAuth);

router.get("/auth/me", async (req, res) => {
  res.json({
    user: sanitizeUser(req.user),
  });
});

router.get("/dashboard", async (_req, res, next) => {
  try {
    const [categories, products, featured, hotSelling, orders] = await Promise.all([
      Category.countDocuments(),
      Product.countDocuments(),
      FeaturedItem.countDocuments(),
      HotSellingItem.countDocuments(),
      Order.countDocuments(),
    ]);

    res.json({
      categories,
      products,
      featured,
      hotSelling,
      orders,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/categories", async (_req, res, next) => {
  try {
    const items = await Category.find().sort({ name: 1 });
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.post("/categories", async (req, res, next) => {
  try {
    const name = getRequiredString(req.body?.name, "Name");
    const slug = slugify(name);
    const description = getRequiredString(req.body?.description, "Description");
    const submittedProducts = normalizeDesignItems(req.body?.products);
    const submittedGalleryImages = normalizeStringArray(req.body?.galleryImages);
    const submittedDesigns = Math.max(0, Number(req.body?.designs || 0));
    const galleryImages = submittedProducts.length > 0 ? submittedProducts.map((product) => product.image).filter(Boolean) : submittedGalleryImages;
    const image = req.body?.image?.toString().trim() || galleryImages[0] || "";
    const designs = submittedProducts.length > 0 ? submittedProducts.length : galleryImages.length > 0 ? galleryImages.length : submittedDesigns;

    const existing = await Category.findOne({ slug });
    if (existing) {
      return res.status(409).json({ message: "A category with this slug already exists." });
    }

    const item = await Category.create({
      name,
      slug,
      description,
      designs,
      image,
      galleryImages,
    });

    await syncCategoryProducts({
      currentSlug: slug,
      nextSlug: slug,
      categoryDescription: description,
      submittedProducts,
    });

    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
});

router.put("/categories/:slug", async (req, res, next) => {
  try {
    const currentSlug = req.params.slug;
    const category = await Category.findOne({ slug: currentSlug });

    if (!category) {
      return res.status(404).json({ message: "Category not found." });
    }

    const name = getRequiredString(req.body?.name, "Name");
    const nextSlug = slugify(name);
    const description = getRequiredString(req.body?.description, "Description");
    const submittedProducts = normalizeDesignItems(req.body?.products);
    const submittedGalleryImages = normalizeStringArray(req.body?.galleryImages);
    const submittedDesigns = Math.max(0, Number(req.body?.designs || 0));
    const galleryImages = submittedProducts.length > 0 ? submittedProducts.map((product) => product.image).filter(Boolean) : submittedGalleryImages;
    const image = req.body?.image?.toString().trim() || galleryImages[0] || "";
    const designs = submittedProducts.length > 0 ? submittedProducts.length : galleryImages.length > 0 ? galleryImages.length : submittedDesigns;

    if (nextSlug !== currentSlug) {
      const duplicate = await Category.findOne({ slug: nextSlug });
      if (duplicate) {
        return res.status(409).json({ message: "A category with this slug already exists." });
      }
    }

    category.name = name;
    category.slug = nextSlug;
    category.description = description;
    category.designs = designs;
    category.image = image;
    category.galleryImages = galleryImages;
    await category.save();

    await syncCategoryProducts({
      currentSlug,
      nextSlug,
      categoryDescription: description,
      submittedProducts,
    });

    if (nextSlug !== currentSlug) {
      await HotSellingItem.updateMany(
        {
          slug: currentSlug,
          sourceProductId: { $exists: false },
        },
        { $set: { slug: nextSlug } },
      );
    }

    res.json(category);
  } catch (error) {
    next(error);
  }
});

router.delete("/categories/:slug", async (req, res, next) => {
  try {
    const { slug } = req.params;
    const categoryProducts = await Product.find({ categorySlug: slug }).select("_id");
    const deleted = await Category.findOneAndDelete({ slug });

    if (!deleted) {
      return res.status(404).json({ message: "Category not found." });
    }

    const productIds = categoryProducts.map((product) => product._id.toString());

    await Promise.all([
      removeProductCollections(productIds),
      Product.deleteMany({ categorySlug: slug }),
      HotSellingItem.deleteMany({ slug }),
    ]);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/products", async (_req, res, next) => {
  try {
    const items = await Product.find().sort({ categorySlug: 1, position: 1, createdAt: 1 });
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.post("/products", async (req, res, next) => {
  try {
    const title = getRequiredString(req.body?.title, "Title");
    const categorySlug = slugify(getRequiredString(req.body?.categorySlug, "Category"));
    const description = req.body?.description?.toString().trim() || "";
    const price = Number(req.body?.price);
    const images = normalizeDesignImages(req.body?.images, req.body?.image, "Product");
    const colors = Array.from(new Set([...normalizeStringArray(req.body?.colors), ...images.map((imageItem) => imageItem.color).filter(Boolean)]));
    const image = images[0]?.url || "";
    const position = Math.max(0, Number(req.body?.position || 0));
    const basePrice = Math.max(0, Number(req.body?.basePrice || 0));
    const deliveryCharge = Math.max(0, Number(req.body?.deliveryCharge || 0));

    if (Number.isNaN(price) || price <= 0) {
      return res.status(400).json({ message: "Price must be a valid positive number." });
    }

    if (basePrice > 0 && basePrice < price) {
      return res.status(400).json({ message: "Original price must be greater than or equal to the selling price." });
    }

    const category = await Category.findOne({ slug: categorySlug });
    if (!category) {
      return res.status(400).json({ message: "Selected category does not exist." });
    }

    const item = await Product.create({
      title,
      categorySlug,
      description,
      price,
      basePrice,
      deliveryCharge,
      image,
      images,
      colors,
      featured: Boolean(req.body?.featured),
      hotSelling: Boolean(req.body?.hotSelling),
      position,
    });

    await syncProductCollections(item);

    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
});

router.put("/products/:id", async (req, res, next) => {
  try {
    const item = await Product.findById(req.params.id);

    if (!item) {
      return res.status(404).json({ message: "Product not found." });
    }

    const title = getRequiredString(req.body?.title, "Title");
    const categorySlug = slugify(getRequiredString(req.body?.categorySlug, "Category"));
    const description = req.body?.description?.toString().trim() || "";
    const price = Number(req.body?.price);
    const images = normalizeDesignImages(req.body?.images, req.body?.image || item.image, "Product");
    const colors = Array.from(new Set([...normalizeStringArray(req.body?.colors), ...images.map((imageItem) => imageItem.color).filter(Boolean)]));
    const image = images[0]?.url || "";
    const position = Math.max(0, Number(req.body?.position || item.position || 0));
    const basePrice = Math.max(0, Number(req.body?.basePrice || 0));
    const deliveryCharge = Math.max(0, Number(req.body?.deliveryCharge || 0));

    if (Number.isNaN(price) || price <= 0) {
      return res.status(400).json({ message: "Price must be a valid positive number." });
    }

    if (basePrice > 0 && basePrice < price) {
      return res.status(400).json({ message: "Original price must be greater than or equal to the selling price." });
    }

    const category = await Category.findOne({ slug: categorySlug });
    if (!category) {
      return res.status(400).json({ message: "Selected category does not exist." });
    }

    item.title = title;
    item.categorySlug = categorySlug;
    item.description = description;
    item.price = price;
    item.image = image;
    item.images = images;
    item.colors = colors;
    item.basePrice = basePrice;
    item.deliveryCharge = deliveryCharge;
    item.featured = Boolean(req.body?.featured);
    item.hotSelling = Boolean(req.body?.hotSelling);
    item.position = position;
    await item.save();

    await syncProductCollections(item);

    res.json(item);
  } catch (error) {
    next(error);
  }
});

router.delete("/products/:id", async (req, res, next) => {
  try {
    const deleted = await Product.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res.status(404).json({ message: "Product not found." });
    }

    await removeProductCollections([deleted.id]);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/orders", async (_req, res, next) => {
  try {
    const items = await Order.find().sort({ createdAt: -1 });
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.patch("/orders/:id/status", async (req, res, next) => {
  try {
    const status = req.body?.status?.toString().trim();
    const allowedStatuses = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid order status." });
    }

    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    res.json(order);
  } catch (error) {
    next(error);
  }
});

router.get("/orders/:id/pdf", async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    const pdf = createOrderPdf(order);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="order-${order.id}.pdf"`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

router.get("/featured", async (_req, res, next) => {
  try {
    const items = await FeaturedItem.find().sort({ createdAt: -1 });
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.post("/featured", async (req, res, next) => {
  try {
    const title = getRequiredString(req.body?.title, "Title");
    const image = getRequiredString(req.body?.image, "Image");
    const item = await FeaturedItem.create({ title, image });
    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
});

router.delete("/featured/:id", async (req, res, next) => {
  try {
    const deleted = await FeaturedItem.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res.status(404).json({ message: "Featured item not found." });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/hot-selling", async (_req, res, next) => {
  try {
    const items = await HotSellingItem.find().sort({ createdAt: -1 });
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.post("/hot-selling", async (req, res, next) => {
  try {
    const title = getRequiredString(req.body?.title, "Title");
    const slug = slugify(getRequiredString(req.body?.slug, "Category slug"));
    const image = getRequiredString(req.body?.image, "Image");
    const category = await Category.findOne({ slug });

    if (!category) {
      return res.status(400).json({ message: "Hot selling items must link to an existing category slug." });
    }

    const item = await HotSellingItem.create({ title, slug, image });
    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
});

router.delete("/hot-selling/:id", async (req, res, next) => {
  try {
    const deleted = await HotSellingItem.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res.status(404).json({ message: "Hot selling item not found." });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/settings", async (_req, res, next) => {
  try {
    const settings = await getSiteSettingsDocument();
    res.json(settings);
  } catch (error) {
    next(error);
  }
});

router.put("/settings", async (req, res, next) => {
  try {
    const settings = await getSiteSettingsDocument();
    settings.whatsappNumber = getRequiredString(req.body?.whatsappNumber, "WhatsApp number");
    settings.whatsappLink = getRequiredString(req.body?.whatsappLink, "WhatsApp link");
    settings.instagram = getRequiredString(req.body?.instagram, "Instagram handle");
    settings.instagramLink = getRequiredString(req.body?.instagramLink, "Instagram link");
    settings.facebookLink = getRequiredString(req.body?.facebookLink, "Facebook link");
    settings.tiktokLink = getRequiredString(req.body?.tiktokLink, "TikTok link");
    settings.email = getRequiredString(req.body?.email, "Email");
    settings.address = getRequiredString(req.body?.address, "Address");
    settings.storeHours = getRequiredString(req.body?.storeHours, "Store hours");
    settings.defaultDeliveryCharge = Math.max(0, Number(req.body?.defaultDeliveryCharge || 0));
    await settings.save();

    res.json(settings);
  } catch (error) {
    next(error);
  }
});

export { router as adminRouter };
