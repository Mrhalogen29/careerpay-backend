import Joi from "joi";
import { JOB_TYPES } from "../models/jobModel.js";

const bodySchema = Joi.object({
  title: Joi.string().trim().min(2).max(150).required(),
  department: Joi.string().trim().min(2).max(100).required(),
  location: Joi.string().trim().min(2).max(150).required(),
  type: Joi.string().valid(...JOB_TYPES).required(),
  description: Joi.string().trim().max(10000).allow("").default(""),
}).unknown(false).required();

const paramsSchema = Joi.object({
  id: Joi.string().pattern(/^[a-fA-F0-9]{24}$/).required().messages({
    "string.pattern.base": "Job ID must be a valid MongoDB ObjectId",
  }),
}).required();

const validate = (schema, source) => (req, res, next) => {
  const { error, value } = schema.validate(req[source], { abortEarly: false });
  if (error) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: error.details.map((detail) => ({ field: detail.path.join("."), message: detail.message })),
    });
  }
  req.validated = { ...req.validated, [source]: value };
  next();
};

export const validateJobBody = validate(bodySchema, "body");
export const validateJobId = validate(paramsSchema, "params");
