import Review from "../models/reviewModel.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class ReviewController {
  // Public: anyone can submit. Saved as "pending" until you approve it.
  create = async (req, res) => {
    try {
      // Honeypot: hidden field that people never fill in, but bots do
      if (req.body?.website) {
        return res.status(201).json({
          success: true,
          message: "Thanks. We review every submission before it is published.",
        });
      }

      // Take only the fields we expect (never spread req.body)
      const name = String(req.body?.name || "").trim();
      const role = String(req.body?.role || "").trim();
      const company = String(req.body?.company || "").trim();
      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();
      const review = String(req.body?.review || "").trim();
      const rating = Number(req.body?.rating);
      const consent = req.body?.consent === true;

      if (!name || !role || !company || !email || !review) {
        return res
          .status(400)
          .json({ success: false, message: "Please fill in every field." });
      }
      if (!EMAIL_RE.test(email)) {
        return res
          .status(400)
          .json({ success: false, message: "Enter a valid email." });
      }
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res
          .status(400)
          .json({ success: false, message: "Choose a rating from 1 to 5." });
      }
      if (review.length < 20 || review.length > 600) {
        return res.status(400).json({
          success: false,
          message: "Your review must be between 20 and 600 characters.",
        });
      }
      if (!consent) {
        return res.status(400).json({
          success: false,
          message: "Please agree to show your name, role and company.",
        });
      }

      await Review.create({ name, role, company, email, rating, review });

      return res.status(201).json({
        success: true,
        message: "Thanks. We review every submission before it is published.",
      });
    } catch (error) {
      console.error("Review submit failed:", error);
      return res.status(500).json({
        success: false,
        message: "Could not send your review. Please try again.",
      });
    }
  };

  // Public: approved reviews only, and never the email
  listApproved = async (req, res) => {
    try {
      const reviews = await Review.find({ status: "approved" })
        .sort({ createdAt: -1 })
        .limit(30)
        .select("name role company review rating createdAt")
        .lean();

      return res.json({ success: true, data: reviews });
    } catch (error) {
      console.error("Review list failed:", error);
      return res
        .status(500)
        .json({ success: false, message: "Could not load reviews." });
    }
  };
}

export default new ReviewController();
