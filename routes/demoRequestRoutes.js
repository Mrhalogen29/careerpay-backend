import express from "express";
import rateLimit from "express-rate-limit";
import demoRequestController from "../controllers/demoRequestController.js";

const router = express.Router();

// Public endpoint, so limit it: 10 requests per IP every 15 minutes
const demoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

router.post("/", demoLimiter, demoRequestController.create);

export default router;
