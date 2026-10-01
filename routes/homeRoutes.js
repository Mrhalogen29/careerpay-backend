import express from "express";
import homeContent from "../data/homeContent.js";

const router = express.Router();

// GET /api/home - public page content, no login required.
router.get("/", (req, res) => {
  res.status(200).json({ success: true, data: homeContent });
});

export default router;