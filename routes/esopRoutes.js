import express from "express";
import equityController from "../controllers/equityController.js";
import { protect, isHROrAbove, isFounderOrAdmin, requireVerified, verifyEmployeeOwnership } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All routes require authentication
router.use(protect);
router.use(requireVerified)

/**
 * @route   GET /api/equity/my-equity
 * @desc    Get current user's equity (Employee dashboard - BR-009)
 * @access  Private (All employees)
 */
router.get("/my-equity", equityController.getMyEquity);

/**
 * @route   GET /api/equity/overview
 * @desc    Get company equity overview
 * @access  Private (HR+)
 */
router.get("/overview", isHROrAbove, equityController.getCompanyEquityOverview);

/**
 * @route   POST /api/equity/grants
 * @desc    Create equity grant (BR-008)
 * @access  Private (Founder, Admin)
 */
router.post("/grants", isFounderOrAdmin, equityController.createEquityGrant);

/**
 * @route   GET /api/equity/grants
 * @desc    Get all equity grants
 * @access  Private (HR+)
 */
router.get("/grants", isHROrAbove, equityController.getAllEquityGrants);

/**
 * @route   GET /api/equity/grants/:id
 * @desc    Get equity grant by ID
 * @access  Private (HR+)
 */
router.get("/grants/:id", isHROrAbove, equityController.getEquityGrantById);

/**
 * @route   PUT /api/equity/grants/:id
 * @desc    Update equity grant
 * @access  Private (Founder, Admin)
 */
router.put("/grants/:id", isFounderOrAdmin, equityController.updateEquityGrant);

/**
 * @route   DELETE /api/equity/grants/:id
 * @desc    Terminate equity grant
 * @access  Private (Founder, Admin)
 */
router.delete(
  "/grants/:id",
  isFounderOrAdmin,
  equityController.terminateEquityGrant
);

/**
 * @route   POST /api/equity/cap-table/upload
 * @desc    Upload cap table (CSV) (BR-008)
 * @access  Private (Founder, Admin)
 */
router.post(
  "/cap-table/upload",
  isFounderOrAdmin,
  equityController.uploadCapTable
);

/**
 * @route   POST /api/equity/process-vesting
 * @desc    Process vesting for all eligible grants (BR-010)
 * @access  Private (Founder, Admin)
 */
router.post(
  "/process-vesting",
  isFounderOrAdmin,
  equityController.processVesting
);

/**
 * @route   GET /api/equity/employee/:employeeId
 * @desc    Get employee equity information (BR-009)
 * @access  Private (Owner or HR+)
 */
router.get("/employee/:employeeId",verifyEmployeeOwnership, equityController.getEmployeeEquity);

export default router;
