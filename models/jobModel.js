import mongoose from "mongoose";

export const JOB_TYPES = ["Full-time", "Part-time", "Contract", "Internship", "Temporary"];

const jobSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, minlength: 2, maxlength: 150 },
  department: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  location: { type: String, required: true, trim: true, minlength: 2, maxlength: 150 },
  type: { type: String, required: true, enum: JOB_TYPES },
  description: { type: String, trim: true, default: "", maxlength: 10000 },
}, { timestamps: true, versionKey: false });

export default mongoose.model("Job", jobSchema);
