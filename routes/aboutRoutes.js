import express from "express";

const router = express.Router();

// Public content for the About page. Edit this object to update the copy.
const aboutContent = {
  title: "About CareerPay",
  description: "We are revolutionizing how organizations manage compensation and empower their workforce through innovative financial solutions.",
  mission: {
    title: "Our Mission",
    paragraphs: [
      "At CareerPay, our mission is to simplify complex compensation structures and provide accessible financing options for both employers and employees. We believe that financial empowerment is the key to a motivated and productive workforce.",
      "Through our platform, we offer Talent Credit Financing, Employee Stock Ownership Plans (ESOP), and a robust Payroll Management System, all designed to streamline operations and enhance employee value.",
    ],
  },
  benefitsTitle: "Why Choose Us?",
  benefits: [
    "Innovative Talent Credit Financing solutions",
    "Simplified ESOP management for all company sizes",
    "End-to-end Payroll Management System",
    "Focus on transparency and financial growth",
  ],
  valuesTitle: "Empowering the Future of Work",
  values: [
    { title: "Integrity", description: "We maintain the highest standards of transparency in every financial transaction." },
    { title: "Innovation", description: "Constantly evolving our platform to meet the dynamic needs of modern organizations." },
    { title: "Growth", description: "Helping companies and their employees build long-term financial security." },
  ],
};

// GET /api/about - no login or subscription required.
router.get("/", (req, res) => {
  res.status(200).json({ success: true, data: aboutContent });
});

export default router;
