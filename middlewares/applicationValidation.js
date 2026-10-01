import Joi from "joi";

const MAX_BYTES = 2 * 1024 * 1024;
const querySchema = Joi.object({
  page: Joi.number().integer().min(1).max(1000000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(false);

export function validateApplicantQuery(req, res, next) {
  const { error, value } = querySchema.validate(req.query, { abortEarly: false });
  if (error) return res.status(400).json({ success: false, message: "Invalid pagination parameters." });
  req.validated = { ...req.validated, query: value };
  next();
}
const schema = Joi.object({
  fullName: Joi.string().trim().min(2).max(150).required(),
  email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(254).required(),
  phone: Joi.string().trim().pattern(/^[+()\d\s.-]{7,30}$/).pattern(/\d/).required(),
  coverLetter: Joi.string().trim().max(5000).allow("").default(""),
  resumeName: Joi.string().trim().max(200).pattern(/\.pdf$/i).required(),
  resumeBase64: Joi.string().base64().max(4 * Math.ceil(MAX_BYTES / 3)).required(),
}).unknown(false).required();

export function validateApplication(req, res, next) {
  const { error, value } = schema.validate(req.body, { abortEarly: false });
  if (error) return res.status(400).json({
    success: false, message: "Please check your application details.",
    errors: error.details.map((detail) => ({ field: detail.path.join("."), message: detail.message })),
  });
  const resume = Buffer.from(value.resumeBase64, "base64");
  if (!resume.length || resume.length > MAX_BYTES || resume.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return res.status(400).json({ success: false, message: "Please upload a PDF CV no larger than 2 MB." });
  }
  const details = { ...value, resume };
  delete details.resumeBase64;
  req.validated = { ...req.validated, body: details };
  next();
}
