import DemoRequest from "../models/demoRequestModel.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d{7,15}$/;
const PRODUCTS = ["payroll", "esop", "financing", "all"];

class DemoRequestController {
  // Public: anyone can ask for a demo (no login)
  create = async (req, res) => {
    try {
      // Honeypot: real people never fill this hidden field, bots usually do.
      // Pretend it worked so the bot doesn't learn anything.
      if (req.body?.website) {
        return res.status(201).json({
          success: true,
          message: "Thanks. We'll be in touch soon.",
        });
      }

      // Take only the fields we expect (never spread req.body into a model)
      const firstName = String(req.body?.firstName || "").trim();
      const lastName = String(req.body?.lastName || "").trim();
      const companyName = String(req.body?.companyName || "").trim();
      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();
      const phone = String(req.body?.phone || "").replace(/[\s-]/g, "");
      const product = String(req.body?.product || "").trim();

      if (
        !firstName ||
        !lastName ||
        !companyName ||
        !email ||
        !phone ||
        !product
      ) {
        return res
          .status(400)
          .json({ success: false, message: "Please fill in every field." });
      }
      if (!EMAIL_RE.test(email)) {
        return res
          .status(400)
          .json({ success: false, message: "Enter a valid work email." });
      }
      if (!PHONE_RE.test(phone)) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid phone number, for example +2348012345678.",
        });
      }
      if (!PRODUCTS.includes(product)) {
        return res
          .status(400)
          .json({ success: false, message: "Choose a product." });
      }

      await DemoRequest.create({
        firstName,
        lastName,
        companyName,
        email,
        phone,
        product,
      });

      return res.status(201).json({
        success: true,
        message: "Thanks. We'll be in touch soon.",
      });
    } catch (error) {
      console.error("Demo request failed:", error);
      return res.status(500).json({
        success: false,
        message: "Could not send your request. Please try again.",
      });
    }
  };
}

export default new DemoRequestController();
