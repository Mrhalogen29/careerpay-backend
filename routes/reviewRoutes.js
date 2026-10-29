import express from "express";
import rateLimit from "express-rate-limit";
import reviewController from "../controllers/reviewController.js";

const router = express.Router();

// 5 submissions per IP per hour
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many submissions. Please try again later.",
  },
});

router.get("/", reviewController.listApproved);
router.post("/", submitLimiter, reviewController.create);

export default router;
