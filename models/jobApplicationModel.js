import mongoose from "mongoose";

const schema = new mongoose.Schema({
  job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },
  jobTitle: { type: String, required: true },
  fullName: { type: String, required: true, trim: true, maxlength: 150 },
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  phone: { type: String, required: true, maxlength: 30 },
  coverLetter: { type: String, default: "", maxlength: 5000 },
  resumeName: { type: String, required: true },
  resume: { type: Buffer, required: true, select: false },
  status: { type: String, enum: ["submitted", "reviewing", "shortlisted", "rejected", "hired"], default: "submitted" },
}, { timestamps: true });

schema.index({ job: 1, email: 1 }, { unique: true });
export default mongoose.model("JobApplication", schema);
