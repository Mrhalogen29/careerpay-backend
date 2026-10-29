import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    role: { type: String, required: true, trim: true, maxlength: 80 },
    company: { type: String, required: true, trim: true, maxlength: 120 },
    // Private: lets your team check the person is a real customer.
    // It is never sent to the public page.
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 120,
    },
    rating: { type: Number, required: true, min: 1, max: 5 },
    review: {
      type: String,
      required: true,
      trim: true,
      minlength: 20,
      maxlength: 600,
    },
    // Only "approved" reviews appear on the website
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
  },
  { timestamps: true },
);

export default mongoose.model("Review", reviewSchema);
