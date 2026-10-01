import express from "express";
import rateLimit from "express-rate-limit";
import { validateApplication, validateApplicantQuery } from "../middlewares/applicationValidation.js";
import { submitApplication, getJobApplicants } from "../controllers/jobApplicationController.js";
import jobController from "../controllers/jobController.js";
import { protect, restrictTo } from "../middlewares/authMiddleware.js";
import { asyncHandler } from "../middlewares/errorHandler.js";
import { validateJobBody, validateJobId } from "../middlewares/jobValidation.js";

const router = express.Router();
const applicationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: "Too many application attempts. Please try again later." },
});
router.post("/jobs/:id/applications", applicationLimiter, validateJobId,
  validateApplication, asyncHandler(submitApplication));
router.get("/jobs/:id/applications", protect, restrictTo("admin"), validateJobId,
  validateApplicantQuery, asyncHandler(getJobApplicants));

// GET /api/careers - public page content, no login required.
router.get("/", asyncHandler(jobController.getCareersContent));
router.get("/jobs", asyncHandler(jobController.getAllJobs));
router.get("/jobs/:id", validateJobId, asyncHandler(jobController.getJobById));
router.post("/jobs", protect, restrictTo("admin"), validateJobBody, asyncHandler(jobController.createJob));
router.put("/jobs/:id", protect, restrictTo("admin"), validateJobId, validateJobBody, asyncHandler(jobController.updateJob));
router.delete("/jobs/:id", protect, restrictTo("admin"), validateJobId, asyncHandler(jobController.deleteJob));

export default router;
