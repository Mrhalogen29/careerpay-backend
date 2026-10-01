import express from "express";
import contactContent from "../data/contactContent.js";

const router = express.Router();

// GET /api/contact - public page content, no login required.
router.get("/", (req, res) => {
  res.status(200).json({ success: true, data: contactContent });
});

export default router;