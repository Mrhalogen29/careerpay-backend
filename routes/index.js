import express from "express";
import authRoutes from "./authRoutes.js";
import employeeRoutes from "./employeeRoutes.js";
import payrollRoutes from "./payrollRoutes.js";
import equityRoutes from "./esopRoutes.js";
import financingRoutes from "./financingRoutes.js";
import dashboardRoutes from "./dashboardRoutes.js";
import companyRoutes from "./companyRoutes.js";
import subscriptionRoutes from "./subscriptionRoutes.js";
import requireSubscription from "../middlewares/requireSubscription.js";
import payrollController from "../controllers/payrollController.js";
import auditRoutes from "./auditRoutes.js";
import notificationRoutes from "./notificationRoutes.js";
import { protect } from "../middlewares/authMiddleware.js";

import aboutRoutes from "./aboutRoutes.js";
import homeRoutes from "./homeRoutes.js";
import testimonialsRoutes from "./testimonialsRoutes.js";
import careersRoutes from "./careersRoutes.js";
import faqRoutes from "./faqRoutes.js";
import contactRoutes from "./contactRoutes.js";

const router = express.Router();

// Health check endpoint
router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "API is running",
    timestamp: new Date().toISOString(),
  });
});

// Mount route modules
router.use("/about", aboutRoutes);
router.use("/home", homeRoutes);
router.use("/testimonials", testimonialsRoutes);
router.use("/careers", careersRoutes);
router.use("/faq", faqRoutes);
router.use("/contact", contactRoutes);
router.use("/auth", authRoutes);
router.use("/employees", employeeRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/companies", companyRoutes);
router.use("/subscriptions", subscriptionRoutes);
router.use("/audit-logs", auditRoutes);
router.use("/notifications", notificationRoutes);
/**
 * @route   POST /api/payroll/payment-webhook
 * @desc    Flutterwave webhook — called automatically after transfer completes
 * @access  Public — Flutterwave calls this, no auth token
 */

router.post("/payroll/payment-webhook", payrollController.handlePaymentWebhook);

// Public — Monnify calls this, no auth
router.post("/payroll/monnify-webhook", payrollController.handleMonnifyWebhook);

// Feature-gated routes — require active subscription
router.use("/payroll", protect, requireSubscription("payroll"), payrollRoutes);
router.use("/financing", requireSubscription("financing"), financingRoutes);
router.use("/equity", requireSubscription("esop"), equityRoutes);

export default router;
