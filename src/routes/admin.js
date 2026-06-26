import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Router } from "express";
import { defaultSiteSettings } from "../config/defaultData.js";
import { requireAuth } from "../middleware/auth.js";
import { AdminUser } from "../models/AdminUser.js";
import { Category } from "../models/Category.js";
import { FeaturedItem } from "../models/FeaturedItem.js";
import { HotSellingItem } from "../models/HotSellingItem.js";
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

    if (Number.isNaN(price) || price <= 0) {
      throw new Error(`${designLabel} price must be a valid positive number.`);
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
    const [categories, products, featured, hotSelling] = await Promise.all([
      Category.countDocuments(),
      Product.countDocuments(),
      FeaturedItem.countDocuments(),
      HotSellingItem.countDocuments(),
    ]);

    res.json({
      categories,
      products,
      featured,
      hotSelling,
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

    if (Number.isNaN(price) || price <= 0) {
      return res.status(400).json({ message: "Price must be a valid positive number." });
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

    if (Number.isNaN(price) || price <= 0) {
      return res.status(400).json({ message: "Price must be a valid positive number." });
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
    await settings.save();

    res.json(settings);
  } catch (error) {
    next(error);
  }
});

export { router as adminRouter };
