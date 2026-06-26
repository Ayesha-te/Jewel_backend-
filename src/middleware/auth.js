import jwt from "jsonwebtoken";
import { AdminUser } from "../models/AdminUser.js";

function getTokenFromHeader(header = "") {
  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
}

export async function requireAuth(req, res, next) {
  try {
    const token = getTokenFromHeader(req.headers.authorization);

    if (!token) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await AdminUser.findById(decoded.sub);

    if (!user) {
      return res.status(401).json({ message: "Session is no longer valid." });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}
