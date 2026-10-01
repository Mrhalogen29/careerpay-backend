import express from "express";
import payrollController from "../controllers/payrollController.js";
import {
  protect,
  isHROrAbove,
  isFounderOrAdmin,
  requireVerified,
} from "../middlewares/authMiddleware.js";

const router = express.Router();

// All routes require authentication
router.use(protect);
router.use(requireVerified);

/**
 * @route   POST /api/payroll/tax-estimate
 * @desc    Calculate tax estimate for a given annual income
 *          CALCULATION ONLY — does not save or modify any data
 * @access  Private
 */
router.post("/tax-estimate", payrollController.getTaxEstimate);

/**
 * @route   POST /api/payroll/tax-breakdown
 * @desc    Get detailed tax breakdown by band for a given annual gross
 *          CALCULATION ONLY — does not save or modify any data
 * @access  Private
 */
router.post("/tax-breakdown", payrollController.getTaxBreakdown);

/**
 * @route   GET /api/payroll/stats
 * @desc    Get payroll statistics (BR-005, BR-011)
 * @access  Private (HR+)
 */
router.get("/stats", isHROrAbove, payrollController.getPayrollStats);

/**
 * @route   GET /api/payroll/current
 * @desc    Get or create current month payroll
 * @access  Private (HR+)
 */
router.get("/current", isHROrAbove, payrollController.getCurrentPayroll);

/**
 * @route   POST /api/payroll
 * @desc    Create new payroll run (BR-003)
 * @access  Private (HR+)
 */
router.post("/", isHROrAbove, payrollController.createPayroll);

/**
 * @route   GET /api/payroll
 * @desc    Get all payrolls for company
 * @access  Private (HR+)
 */
router.get("/", isHROrAbove, payrollController.getAllPayrolls);

/**
 * @route   POST /api/payroll/:id/calculate
 * @desc    Calculate payroll for all employees
 * @access  Private (HR+)
 */
router.post("/:id/calculate", isHROrAbove, payrollController.calculatePayroll);

/**
 * @route   PATCH /api/payroll/:id/compensation
 * @desc    Add bonus, overtime, allowances before calculation (optional step)
 * @access  Private (HR+)
 */
router.patch(
  "/:id/compensation",
  isHROrAbove,
  payrollController.addPayrollCompensation,
);

/**
 * @route   POST /api/payroll/:id/approve
 * @desc    Approve payroll
 * @access  Private (Admin, Founder only)
 */
router.post("/:id/approve", isFounderOrAdmin, payrollController.approvePayroll);

/**
 * @route   POST /api/payroll/:id/process
 * @desc    Process payroll payment (BR-006 financing integration)
 * @access  Private (Admin, Founder only)
 */
router.post("/:id/process", isFounderOrAdmin, payrollController.processPayroll);

/**
 * @route   GET /api/payroll/:id/export
 * @desc    Export payroll data
 * @access  Private (HR+)
 */
router.get("/:id/export", isHROrAbove, payrollController.exportPayroll);

/**
 * @route   GET /api/payroll/:id/payslip/:employeeId
 * @desc    Get employee payslip (BR-004)
 * @access  Private (Employee can view own, HR+ can view all)
 */
router.get("/:id/payslip/:employeeId", payrollController.getPayslip);

/**
 * @route   PATCH /api/payroll/:id/items/:employeeId
 * @desc    Correct a specific employee's payroll item (draft/calculated only)
 * @access  Private (HR+)
 */
router.patch(
  "/:id/items/:employeeId",
  isHROrAbove,
  payrollController.correctPayrollItem,
);

/**
 * @route   GET /api/payroll/transactions
 * @desc    Get all payment transactions for company (tracking page)
 * @access  Private (HR+)
 */
router.get("/transactions", isHROrAbove, payrollController.getAllTransactions);

/**

 * @route   GET /api/payroll/:id

 * @desc    Get payroll by ID

 * @access  Private (HR+)

 */

router.get("/:id", isHROrAbove, payrollController.getPayrollById);

/**
 * @route   GET /api/payroll/:id/transactions
 * @desc    Get all payment transactions for a specific payroll
 * @access  Private (HR+)
 */

router.get(
  "/:id/transactions",
  isHROrAbove,
  payrollController.getPayrollTransactions,
);

/**
 * @route   POST /api/payroll/:id/retry-failed
 * @desc    Retry failed payments for a partially completed or failed payroll
 * @access  Private (Founder/Admin only)
 */
router.post(
  "/:id/retry-failed",
  isFounderOrAdmin,
  payrollController.retryFailedPayments,
);

router.post("/:id/reset", isFounderOrAdmin, payrollController.resetPayroll);

/**
 * @route   POST /api/payroll/:id/cancel
 * @desc    Cancel pending payroll payment jobs
 * @access  Private (Founder/Admin only)
 */
router.post("/:id/cancel", isFounderOrAdmin, payrollController.cancelPayroll);

export default router;
