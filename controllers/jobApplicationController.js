import Job from "../models/jobModel.js";
import JobApplication from "../models/jobApplicationModel.js";

const successMessage = "Your application is submitted successfully, and we'll get back to you after review.";

export async function getJobApplicants(req, res) {
  const { id } = req.validated.params;
  const { page, limit } = req.validated.query;
  const job = await Job.findById(id).select("title").lean();
  if (!job) return res.status(404).json({ success: false, message: "Job not found" });
  const filter = { job: id };
  const [applicants, total] = await Promise.all([
    JobApplication.find(filter)
      .select("job jobTitle fullName email phone coverLetter resumeName status createdAt updatedAt")
      .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    JobApplication.countDocuments(filter),
  ]);
  res.set("Cache-Control", "no-store");
  return res.status(200).json({
    success: true, job, count: applicants.length,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    data: applicants,
  });
}

export async function submitApplication(req, res) {
  const job = await Job.findById(req.validated.params.id).lean();
  if (!job) return res.status(404).json({ success: false, message: "This job is no longer available." });
  try {
    const application = await JobApplication.create({
      ...req.validated.body, job: job._id, jobTitle: job.title,
    });
    return res.status(201).json({
      success: true, message: successMessage, data: { id: application._id },
    });
  } catch (error) {
    if (error.code === 11000) return res.status(200).json({
      success: true, message: successMessage,
    });
    throw error;
  }
}
