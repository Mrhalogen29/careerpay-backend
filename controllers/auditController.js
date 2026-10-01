import Audit from "../models/auditModel.js";

// Get recent audit logs for the logged-in user's company
export const getAuditLogs = async (req, res) => {
  try {
    const companyId = req.user.company;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "User is not associated with a company",
      });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);

    const logs = await Audit.getRecentActivities(companyId, limit);

    return res.status(200).json({
      success: true,
      count: logs.length,
      data: logs,
    });
  } catch (error) {
    console.error("Get audit logs error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve audit logs",
      error: error.message,
    });
  }
};

// Get audit logs by module
export const getAuditLogsByModule = async (req, res) => {
  try {
    const companyId = req.user.company;
    const { module } = req.params;
    const { startDate, endDate } = req.query;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "User is not associated with a company",
      });
    }

    const logs = await Audit.getByModule(companyId, module, startDate, endDate);

    return res.status(200).json({
      success: true,
      count: logs.length,
      data: logs,
    });
  } catch (error) {
    console.error("Get audit logs by module error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve audit logs",
      error: error.message,
    });
  }
};
