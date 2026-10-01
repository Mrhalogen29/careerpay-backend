import express from "express";
import employeeController from "../controllers/employeeController.js";
import {
  protect,
  isHROrAbove,
  isFounderOrAdmin,
  verifyEmployeeOwnership,
  requireVerified,
} from "../middlewares/authMiddleware.js";
import { validatePagination } from "../middlewares/validator.js";

const router = express.Router();

// All routes require authentication
router.use(protect);
router.use(requireVerified)

/**
 * @route   GET /api/employees/banks
 * @desc    Get list of Nigerian banks from Flutterwave
 *          Used to populate bank dropdown when employee adds bank details
 * @access  Private
 */
router.get("/banks", employeeController.getNigerianBanks);

/**
 * @route   POST /api/employees
 * @desc    Create new employee (BR-002)
 * @access  Private (HR, Admin, Founder)
 */
router.post("/", isHROrAbove, employeeController.createEmployee);

/**
 * @route   GET /api/employees/stats
 * @desc    Get employee statistics
 * @access  Private (HR, Admin, Founder)
 */
router.get("/stats", isHROrAbove, employeeController.getEmployeeStats);

/**
 * @route   GET /api/employees
 * @desc    Get all employees for company
 * @access  Private (HR, Admin, Founder)
 */
router.get(
  "/",
  isHROrAbove,
  validatePagination,
  employeeController.getAllEmployees
);

/**
 * @route   GET /api/employees/:id
 * @desc    Get employee by ID
 * @access  Private (Owner or HR+)
 */
router.get("/:id", verifyEmployeeOwnership, employeeController.getEmployeeById);

/**
 * @route   PUT /api/employees/:id
 * @desc    Update employee
 * @access  Private (HR, Admin, Founder)
 */
router.put("/:id", isHROrAbove, employeeController.updateEmployee);

/**
 * @route   PATCH /api/employees/:id/profile
 * @desc    Employee updates their own profile (phone, bank details, tax info only)
 *          NEW route — BRD 2.1 (employees can update own profile, limited fields)
 * @access  Private (Employee — own profile only)
 */
router.patch(
  "/:id/profile",
  verifyEmployeeOwnership,
  employeeController.updateOwnProfile
);

/**
 * @route   PATCH /api/employees/:id/deactivate
 * @desc    Deactivate employee
 * @access  Private (HR, Admin, Founder)
 */
router.patch(
  "/:id/deactivate",
  isHROrAbove,
  employeeController.deactivateEmployee
);

/**
 * @route   PATCH /api/employees/:id/activate
 * @desc    Activate employee
 * @access  Private (HR, Admin, Founder)
 */
router.patch("/:id/activate", isHROrAbove, employeeController.activateEmployee);

/**
 * @route   DELETE /api/employees/:id
 * @desc    Delete employee (soft delete)
 * @access  Private (Admin, Founder)
 */
router.delete("/:id", isFounderOrAdmin, employeeController.deleteEmployee);

export default router;
