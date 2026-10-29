import express from "express";
import employeeController from "../controllers/employeeController.js";
import { uploadEmployeeDocs } from "../middlewares/uploadDocuments";
import {
  protect,
  isHROrAbove,
  isFounderOrAdmin,
  restrictTo,
  verifyEmployeeOwnership,
  requireVerified,
} from "../middlewares/authMiddleware.js";
import { validatePagination } from "../middlewares/validator.js";

const router = express.Router();

// All routes require authentication
router.use(protect);
router.use(requireVerified);

router.get("/banks", employeeController.getNigerianBanks);

router.post("/", isHROrAbove, employeeController.createEmployee);

router.get("/stats", isHROrAbove, employeeController.getEmployeeStats);

router.get(
  "/",
  isHROrAbove,
  validatePagination,
  employeeController.getAllEmployees,
);

router.get("/:id", verifyEmployeeOwnership, employeeController.getEmployeeById);

router.put("/:id", isHROrAbove, employeeController.updateEmployee);

router.post(
  "/:id/documents",
  isHROrAbove,
  uploadEmployeeDocs,
  employeeController.uploadDocuments,
);

router.get("/:id/documents/:docType", employeeController.downloadDocument);

router.patch(
  "/:id/profile",
  verifyEmployeeOwnership,
  employeeController.updateOwnProfile,
);

router.patch(
  "/:id/deactivate",
  isHROrAbove,
  employeeController.deactivateEmployee,
);

router.patch("/:id/activate", isHROrAbove, employeeController.activateEmployee);

router.patch("/:id/role", restrictTo("founder"), employeeController.updateRole);

router.delete("/:id", isFounderOrAdmin, employeeController.deleteEmployee);

export default router;
