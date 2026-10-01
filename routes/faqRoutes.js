import express from "express";
import faqContent from "../data/faqContent.js";

const router = express.Router();

// GET /api/faq - public page content, no login required.
router.get("/", (req, res) => {
  res.status(200).json({ success: true, data: faqContent });
});

export default router;