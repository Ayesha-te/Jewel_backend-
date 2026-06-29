import "dotenv/config";
import cors from "cors";
import express from "express";
import { connectDatabase } from "./config/database.js";
import { adminRouter } from "./routes/admin.js";
import { publicRouter } from "./routes/public.js";
import { ensureSiteSettings, ensureSuperUser } from "./seed/seedDatabase.js";

const app = express();
const port = Number(process.env.PORT || 5000);
const bodyLimit = process.env.JSON_BODY_LIMIT || "50mb";

app.use(
  cors({
    origin: true,
  }),
);
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/public", publicRouter);
app.use("/api/admin", adminRouter);

app.use((error, _req, res, _next) => {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  const status = typeof error?.status === "number" ? error.status : 500;

  console.error(error);
  res.status(status).json({ message });
});

async function start() {
  await connectDatabase();
  await ensureSiteSettings();
  const superUser = await ensureSuperUser();

  app.listen(port, () => {
    console.log(`Backend running at http://localhost:${port}`);
    console.log(`Super user email: ${superUser.email}`);
    console.log(`Super user password: ${process.env.SUPERUSER_PASSWORD || "Admin@12345"}`);
  });
}

start().catch((error) => {
  console.error("Failed to start backend.", error);
  process.exit(1);
});
