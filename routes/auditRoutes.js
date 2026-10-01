import express from "express";
import {
  getAuditLogs,
  getAuditLogsByModule,
} from "../controllers/auditController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect);

// GET /api/audit-logs
router.get("/", getAuditLogs);

// GET /api/audit-logs/module/payroll
router.get("/module/:module", getAuditLogsByModule);

export default router;
