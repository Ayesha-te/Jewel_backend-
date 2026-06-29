import jwt from "jsonwebtoken";
import { AdminUser } from "../models/AdminUser.js";

function getTokenFromHeader(header = "") {
  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
}

export async function authenticateRequest(req) {
  try {
    const token = getTokenFromHeader(req.headers.authorization);

    if (!token) {
      const error = new Error("Authentication required.");
      error.status = 401;
      throw error;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await AdminUser.findById(decoded.sub);

    if (!user) {
      const error = new Error("Session is no longer valid.");
      error.status = 401;
      throw error;
    }

    return user;
  } catch (error) {
    if (error instanceof Error && typeof error.status === "number" && error.status === 401) {
      throw error;
    }

    const authError = new Error("Invalid or expired token.");
    authError.status = 401;
    throw authError;
  }
}

export async function requireAuth(req, res, next) {
  try {
    const user = await authenticateRequest(req);
    req.user = user;
    next();
  } catch (error) {
    const isAuthError = error instanceof Error && typeof error.status === "number" && error.status === 401;
    const message = isAuthError ? error.message : "Invalid or expired token.";
    return res.status(401).json({ message });
  }
}
