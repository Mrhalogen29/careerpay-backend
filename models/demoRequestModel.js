import mongoose from "mongoose";

const demoRequestSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    lastName: { type: String, required: true, trim: true, maxlength: 60 },
    companyName: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 120,
    },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    product: {
      type: String,
      required: true,
      enum: ["payroll", "esop", "financing", "all"],
    },
    // For your team to track follow-up in Atlas
    status: {
      type: String,
      enum: ["new", "contacted", "closed"],
      default: "new",
    },
  },
  { timestamps: true },
);

export default mongoose.model("DemoRequest", demoRequestSchema);
