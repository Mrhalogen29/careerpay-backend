import express from "express";
import testimonialsContent from "../data/testimonialsContent.js";

const router = express.Router();

// GET /api/testimonials - public page content, no login required.
router.get("/", (req, res) => {
  res.status(200).json({ success: true, data: testimonialsContent });
});

export default router;