import express from "express";
import authRoutes from "./authRoutes.js";
import employeeRoutes from "./employeeRoutes.js";
import payrollRoutes from "./payrollRoutes.js";
import equityRoutes from "./esopRoutes.js";
import financingRoutes from "./financingRoutes.js";
import employeeLoanRoutes from "./employeeLoanRoutes.js";
import dashboardRoutes from "./dashboardRoutes.js";
import companyRoutes from "./companyRoutes.js";
import myPayslipRoutes from "./myPayslipRoutes.js";
import subscriptionRoutes from "./subscriptionRoutes.js";
import requireSubscription from "../middlewares/requireSubscription.js";
import payrollController from "../controllers/payrollController.js";
import auditRoutes from "./auditRoutes.js";
import notificationRoutes from "./notificationRoutes.js";
import demoRequestRoutes from "./demoRequestRoutes.js";
import reviewRoutes from "./reviewRoutes.js";

import { protect } from "../middlewares/authMiddleware.js";

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
router.use("/auth", authRoutes);
router.use("/employees", employeeRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/companies", companyRoutes);
router.use("/subscriptions", subscriptionRoutes);
router.use("/audit-logs", auditRoutes);
router.use("/notifications", notificationRoutes);
router.use("/demo-requests", demoRequestRoutes);
router.use("/reviews", reviewRoutes);

router.post("/payroll/payment-webhook", payrollController.handlePaymentWebhook);

// Public — Monnify calls this, no auth
router.post("/payroll/monnify-webhook", payrollController.handleMonnifyWebhook);

// Feature-gated routes — require active subscription
router.use("/payroll", protect, requireSubscription("payroll"), payrollRoutes);
router.use(
  "/financing",
  protect,
  requireSubscription("financing"),
  financingRoutes,
);
router.use(
  "/my-payslips",
  protect,
  requireSubscription("payroll"),
  myPayslipRoutes,
);

// Staff loans are under review. Off unless ENABLE_STAFF_LOANS=true
if (process.env.ENABLE_STAFF_LOANS === "true") {
  router.use(
    "/employee-loans",
    protect,
    requireSubscription("financing"),
    requireSubscription("payroll"),
    employeeLoanRoutes,
  );
}

router.use("/equity", protect, requireSubscription("esop"), equityRoutes);

export default router;
