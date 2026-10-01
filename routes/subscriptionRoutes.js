import express from "express";
import subscriptionController from "../controllers/subscriptionController.js";
import { protect, requireVerified, isFounderOrAdmin } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All routes require authentication and verified company
router.use(protect);
router.use(requireVerified);

/**
 * @route   GET /api/subscriptions/pricing
 * @desc    Get module pricing with live exchange rate
 * @access  Private
 */
router.get("/pricing", subscriptionController.getPricing);

/**
 * @route   GET /api/subscriptions
 * @desc    Get all company subscriptions and status per module
 * @access  Private (Founder/Admin only)
 */
router.get("/", isFounderOrAdmin, subscriptionController.getCompanySubscriptions);

/**
 * @route   POST /api/subscriptions/verify
 * @desc    Verify payment and activate subscription
 * @access  Private (Founder/Admin only)
 */
router.post("/verify", isFounderOrAdmin, subscriptionController.verifyPayment);

/**
 * @route   GET /api/subscriptions/:module
 * @desc    Get subscription status for a specific module
 * @access  Private (Founder/Admin only)
 */
router.get("/:module", isFounderOrAdmin, subscriptionController.getModuleSubscription);

/**
 * @route   POST /api/subscriptions/:module/initiate
 * @desc    Initiate subscription payment — returns Paystack payment URL
 * @access  Private (Founder/Admin only)
 */
router.post("/:module/initiate", isFounderOrAdmin, subscriptionController.initiatePayment);



export default router;