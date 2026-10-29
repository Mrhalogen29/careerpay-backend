import express from "express";
import rateLimit from "express-rate-limit";
import subscriptionController from "../controllers/subscriptionController.js";
import {
  protect,
  requireVerified,
  isFounderOrAdmin,
} from "../middlewares/authMiddleware.js";

const router = express.Router();

// ─── PUBLIC (no login): used by the landing page before sign-up ─────────────
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again shortly.",
  },
});

router.get("/pricing", publicLimiter, subscriptionController.getPricing);
router.post(
  "/purchase/initiate",
  publicLimiter,
  subscriptionController.initiatePurchase,
);
router.post(
  "/purchase/verify",
  publicLimiter,
  subscriptionController.verifyPurchase,
);

// ─── Everything below requires authentication and a verified company ────────
router.use(protect);
router.use(requireVerified);

router.get("/access", subscriptionController.getAccess);

router.post(
  "/initiate",
  isFounderOrAdmin,
  subscriptionController.initiateBundle,
);
router.get(
  "/",
  isFounderOrAdmin,
  subscriptionController.getCompanySubscriptions,
);

router.post("/verify", isFounderOrAdmin, subscriptionController.verifyPayment);

router.get(
  "/:module",
  isFounderOrAdmin,
  subscriptionController.getModuleSubscription,
);

router.post(
  "/:module/initiate",
  isFounderOrAdmin,
  subscriptionController.initiatePayment,
);

export default router;
