import Job from "../models/jobModel.js";
import careersContent from "../data/careersContent.js";

const notFound = (res) => res.status(404).json({ success: false, message: "Job not found" });
const findJobs = () => Job.find().sort({ createdAt: -1, _id: -1 }).lean();

class JobController {
  async getCareersContent(req, res) {
    const jobs = await findJobs();
    res.status(200).json({ success: true, data: { ...careersContent, jobs } });
  }

  async getAllJobs(req, res) {
    const jobs = await findJobs();
    res.status(200).json({ success: true, count: jobs.length, data: jobs });
  }

  async getJobById(req, res) {
    const job = await Job.findById(req.validated.params.id).lean();
    if (!job) return notFound(res);
    res.status(200).json({ success: true, data: job });
  }

  async createJob(req, res) {
    const job = await Job.create(req.validated.body);
    res.status(201).json({ success: true, message: "Job created successfully", data: job });
  }

  async updateJob(req, res) {
    // PUT replaces every editable field; Joi supplies the description default.
    const job = await Job.findByIdAndUpdate(req.validated.params.id,
      { $set: req.validated.body }, { new: true, runValidators: true });
    if (!job) return notFound(res);
    res.status(200).json({ success: true, message: "Job updated successfully", data: job });
  }

  async deleteJob(req, res) {
    const job = await Job.findByIdAndDelete(req.validated.params.id);
    if (!job) return notFound(res);
    res.status(200).json({ success: true, message: "Job deleted successfully", data: { id: job._id } });
  }
}

export default new JobController();
