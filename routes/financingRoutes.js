import express from "express";
import financingController from "../controllers/financingController.js";
import { protect, isFounderOrAdmin, requireVerified } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All routes require authentication
router.use(protect);
router.use(requireVerified);

/**
 * @route   POST /api/financing/apply
 * @desc    Apply for payroll financing (BR-006)
 * @access  Private (Founder, Admin)
 */

router.post("/apply", isFounderOrAdmin, financingController.applyForFinancing);

/**
 * @route   GET /api/financing/stats
 * @desc    Get financing statistics
 * @access  Private (Founder, Admin)
 */
router.get("/stats", isFounderOrAdmin, financingController.getFinancingStats);

/**
 * @route   GET /api/financing
 * @desc    Get all financing applications for company
 * @access  Private (Founder, Admin)
 */
router.get("/", isFounderOrAdmin, financingController.getCompanyFinancing);

/**
 * @route   GET /api/financing/:id
 * @desc    Get financing by ID (BR-007)
 * @access  Private (Founder, Admin)
 */
router.get("/:id", isFounderOrAdmin, financingController.getFinancingById);

/**
 * @route   PUT /api/financing/:id/review
 * @desc    Review financing application (approve/reject)
 * @access  Private (Founder, Admin)
 */
router.put(
  "/:id/review",
  isFounderOrAdmin,
  financingController.reviewFinancing
);

/**
 * @route   POST /api/financing/:id/disburse
 * @desc    Disburse financing (mark as disbursed)
 * @access  Private (Founder, Admin)
 */
router.post(
  "/:id/disburse",
  isFounderOrAdmin,
  financingController.disburseFinancing
);

/**
 * @route   POST /api/financing/:id/repayment
 * @desc    Make repayment
 * @access  Private (Founder, Admin)
 */
router.post(
  "/:id/repayment",
  isFounderOrAdmin,
  financingController.makeRepayment
);

export default router;
