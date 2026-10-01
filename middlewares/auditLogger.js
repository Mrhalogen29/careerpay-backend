// src/middleware/auditLogger.js
import Audit from "../models/auditModel.js";

/**
 * Automatic audit logging middleware
 * Logs specific actions automatically based on route
 */
export const auditLogger = (action, module, severity = "low") => {
  return async (req, res, next) => {
    // Store original res.json to intercept response
    const originalJson = res.json.bind(res);

    res.json = function (data) {
      // Log audit after successful response
      if (data.success && req.user) {
        const auditData = {
          company: req.user.company,
          user: req.user.id,
          action,
          module,
          resourceType: getResourceType(req),
          resourceId: getResourceId(req, data),
          details: getDetails(req, data),
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get("user-agent"),
          status: "success",
          severity,
        };

        // Log asynchronously without blocking response
        Audit.log(auditData).catch((err) =>
          console.error("Audit logging failed:", err)
        );
      }

      return originalJson(data);
    };

    next();
  };
};

/**
 * Log specific action with custom data
 */
export const logAction = async (
  req,
  action,
  module,
  details = {},
  severity = "low"
) => {
  if (!req.user) return;

  try {
    await Audit.log({
      company: req.user.company,
      user: req.user.id,
      action,
      module,
      details,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get("user-agent"),
      status: "success",
      severity,
    });
  } catch (error) {
    console.error("Manual audit logging failed:", error);
  }
};

/**
 * Helper: Get resource type from request
 */
function getResourceType(req) {
  const path = req.route?.path || req.path;

  if (path.includes("/employees")) return "employee";
  if (path.includes("/payroll")) return "payroll";
  if (path.includes("/equity")) return "equity_grant";
  if (path.includes("/financing")) return "financing";
  if (path.includes("/company")) return "company";
  if (path.includes("/users")) return "user";

  return null;
}

/**
 * Helper: Get resource ID from request or response
 */
function getResourceId(req, data) {
  // Try to get from params first
  if (req.params.id) return req.params.id;
  if (req.params.employeeId) return req.params.employeeId;
  if (req.params.payrollId) return req.params.payrollId;

  // Try to get from response data
  if (data.data?._id) return data.data._id;
  if (data.data?.id) return data.data.id;

  return null;
}

/**
 * Helper: Extract relevant details from request
 */
function getDetails(req, data) {
  const details = {};

  // Add relevant fields from body
  if (req.body.name) details.name = req.body.name;
  if (req.body.email) details.email = req.body.email;
  if (req.body.amount) details.amount = req.body.amount;
  if (req.body.status) details.status = req.body.status;

  // Add metadata
  if (req.method) details.method = req.method;
  if (req.query && Object.keys(req.query).length > 0) {
    details.queryParams = req.query;
  }

  return details;
}

/**
 * Track failed operations
 */
export const logFailure = async (
  req,
  action,
  module,
  errorMessage,
  severity = "medium"
) => {
  if (!req.user) return;

  try {
    await Audit.log({
      company: req.user.company,
      user: req.user.id,
      action,
      module,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get("user-agent"),
      status: "failure",
      errorMessage,
      severity,
    });
  } catch (error) {
    console.error("Failure audit logging failed:", error);
  }
};

/**
 * Track data changes (before/after)
 */
export const logDataChange = async (
  req,
  action,
  module,
  resourceType,
  resourceId,
  before,
  after,
  severity = "medium"
) => {
  if (!req.user) return;

  try {
    await Audit.log({
      company: req.user.company,
      user: req.user.id,
      action,
      module,
      resourceType,
      resourceId,
      changes: { before, after },
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get("user-agent"),
      status: "success",
      severity,
    });
  } catch (error) {
    console.error("Data change audit logging failed:", error);
  }
};
