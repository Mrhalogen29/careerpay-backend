import express from "express";
import dashboardController from "../controllers/dashboardController.js";
import { protect, isFounderOrAdmin, isHROrAbove, requireVerified } from "../middlewares/authMiddleware.js";
import { validatePagination } from "../middlewares/validator.js";

const router = express.Router();

// All routes require authentication
router.use(protect);
router.use(requireVerified)

/**
 * @route   GET /api/dashboard/admin
 * @desc    Get admin dashboard overview (BR-005, BR-011)
 * @access  Private (Founder, Admin)
 */
router.get("/admin", isFounderOrAdmin, dashboardController.getAdminDashboard);

/**
 * @route   GET /api/dashboard/hr
 * @desc    Get HR dashboard
 * @access  Private (HR+)
 */
router.get("/hr", isHROrAbove, dashboardController.getHRDashboard);

/**
 * @route   GET /api/dashboard/employee
 * @desc    Get employee dashboard
 * @access  Private (All employees)
 */
router.get("/employee", dashboardController.getEmployeeDashboard);

/**
 * @route   GET /api/dashboard/metrics
 * @desc    Get company metrics summary
 * @access  Private (HR+)
 */
router.get("/metrics", isHROrAbove, dashboardController.getMetricsSummary);

/**
 * @route   GET /api/dashboard/audit-stats
 * @desc    Get audit statistics
 * @access  Private (Founder, Admin)
 */
router.get("/audit-stats", isFounderOrAdmin, dashboardController.getAuditStats);

/**
 * @route   GET /api/dashboard/activity-timeline
 * @desc    Get activity timeline for charts
 * @access  Private (Founder, Admin)
 */
router.get(
  "/activity-timeline",
  isFounderOrAdmin,
  dashboardController.getActivityTimeline
);

/**
 * @route   GET /api/dashboard/recent-activities
 * @desc    Get recent activities
 * @access  Private (HR+)
 */
router.get(
  "/recent-activities",
  isHROrAbove,
  dashboardController.getRecentActivities
);

/**
 * @route   GET /api/dashboard/critical-activities
 * @desc    Get critical/high severity activities
 * @access  Private (Founder, Admin)
 */
router.get(
  "/critical-activities",
  isFounderOrAdmin,
  dashboardController.getCriticalActivities
);

/**
 * @route   GET /api/dashboard/failed-activities
 * @desc    Get failed activities
 * @access  Private (Founder, Admin)
 */
router.get(
  "/failed-activities",
  isFounderOrAdmin,
  dashboardController.getFailedActivities
);

/**
 * @route   POST /api/dashboard/search-audit
 * @desc    Search audit logs with filters
 * @access  Private (Founder, Admin)
 */
router.post(
  "/search-audit",
  isFounderOrAdmin,
  validatePagination,
  dashboardController.searchAuditLogs
);

/**
 * @route   GET /api/dashboard/export-audit
 * @desc    Export audit logs
 * @access  Private (Founder, Admin)
 */
router.get(
  "/export-audit",
  isFounderOrAdmin,
  dashboardController.exportAuditLogs
);

export default router;
