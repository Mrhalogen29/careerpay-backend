import express from "express";
import myPayslipController from "../controllers/myPayslipController.js";
import { protect, requireVerified } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(requireVerified);

router.get("/", myPayslipController.list);

export default router;
