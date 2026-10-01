import Audit from "../models/auditModel.js";

class AuditService {
  /**
   * Create an audit log entry
   */
  async logAction(auditData) {
    try {
      return await Audit.log(auditData);
    } catch (error) {
      // Silently fail - audit logging should not break main flow
      console.error("Audit logging failed:", error.message);
      return null;
    }
  }

  /**
   * Get recent activities for dashboard
   */
  async getRecentActivities(companyId, limit = 20) {
    try {
      return await Audit.getRecentActivities(companyId, limit);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get activities by module
   */
  async getActivitiesByModule(companyId, module, startDate, endDate) {
    try {
      return await Audit.getByModule(companyId, module, startDate, endDate);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get user activity history
   */
  async getUserActivity(userId, limit = 50) {
    try {
      return await Audit.getUserActivity(userId, limit);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get audit statistics for admin dashboard
   */
  async getAuditStats(companyId, startDate, endDate) {
    try {
      const query = { company: companyId };

      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const [
        totalActivities,
        activitiesByModule,
        activitiesByStatus,
        activitiesBySeverity,
        topUsers,
      ] = await Promise.all([
        // Total activities count
        Audit.countDocuments(query),

        // Activities by module
        Audit.aggregate([
          { $match: query },
          { $group: { _id: "$module", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),

        // Activities by status
        Audit.aggregate([
          { $match: query },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),

        // Activities by severity
        Audit.aggregate([
          { $match: query },
          { $group: { _id: "$severity", count: { $sum: 1 } } },
        ]),

        // Top active users
        Audit.aggregate([
          { $match: query },
          { $group: { _id: "$user", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
          {
            $lookup: {
              from: "users",
              localField: "_id",
              foreignField: "_id",
              as: "userDetails",
            },
          },
          { $unwind: "$userDetails" },
          {
            $project: {
              user: {
                id: "$_id",
                firstName: "$userDetails.firstName",
                lastName: "$userDetails.lastName",
                email: "$userDetails.email",
              },
              activityCount: "$count",
            },
          },
        ]),
      ]);

      return {
        totalActivities,
        activitiesByModule: activitiesByModule.map((item) => ({
          module: item._id,
          count: item.count,
        })),
        activitiesByStatus: activitiesByStatus.map((item) => ({
          status: item._id,
          count: item.count,
        })),
        activitiesBySeverity: activitiesBySeverity.map((item) => ({
          severity: item._id,
          count: item.count,
        })),
        topUsers: topUsers
          .map((item) => (item.user ? item : null))
          .filter(Boolean),
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get activity timeline (for charts)
   */
  async getActivityTimeline(companyId, startDate, endDate, groupBy = "day") {
    try {
      const query = { company: companyId };

      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      let dateFormat;
      switch (groupBy) {
        case "hour":
          dateFormat = "%Y-%m-%d %H:00";
          break;
        case "day":
          dateFormat = "%Y-%m-%d";
          break;
        case "week":
          dateFormat = "%Y-W%V";
          break;
        case "month":
          dateFormat = "%Y-%m";
          break;
        default:
          dateFormat = "%Y-%m-%d";
      }

      const timeline = await Audit.aggregate([
        { $match: query },
        {
          $group: {
            _id: {
              date: {
                $dateToString: { format: dateFormat, date: "$createdAt" },
              },
              module: "$module",
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.date": 1 } },
        {
          $group: {
            _id: "$_id.date",
            modules: {
              $push: {
                module: "$_id.module",
                count: "$count",
              },
            },
            total: { $sum: "$count" },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      return timeline.map((item) => ({
        date: item._id,
        total: item.total,
        breakdown: item.modules,
      }));
    } catch (error) {
      throw error;
    }
  }

  /**
   * Search audit logs with advanced filters
   */
  async searchAuditLogs(companyId, filters = {}) {
    try {
      const query = { company: companyId };

      // Apply filters
      if (filters.user) query.user = filters.user;
      if (filters.action) query.action = filters.action;
      if (filters.module) query.module = filters.module;
      if (filters.status) query.status = filters.status;
      if (filters.severity) query.severity = filters.severity;
      if (filters.resourceType) query.resourceType = filters.resourceType;
      if (filters.resourceId) query.resourceId = filters.resourceId;

      // Date range filter
      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate)
          query.createdAt.$gte = new Date(filters.startDate);
        if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
      }

      // Text search in details
      if (filters.searchText) {
        query.$text = { $search: filters.searchText };
      }

      const page = parseInt(filters.page) || 1;
      const limit = parseInt(filters.limit) || 50;
      const skip = (page - 1) * limit;

      const [logs, total] = await Promise.all([
        Audit.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate("user", "firstName lastName email role")
          .lean(),
        Audit.countDocuments(query),
      ]);

      return {
        logs,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get critical/high severity activities
   */
  async getCriticalActivities(companyId, limit = 20) {
    try {
      return await Audit.find({
        company: companyId,
        severity: { $in: ["high", "critical"] },
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate("user", "firstName lastName email")
        .lean();
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get failed activities (for monitoring)
   */
  async getFailedActivities(companyId, limit = 20) {
    try {
      return await Audit.find({
        company: companyId,
        status: "failure",
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate("user", "firstName lastName email")
        .lean();
    } catch (error) {
      throw error;
    }
  }

  /**
   * Export audit logs
   */
  async exportAuditLogs(companyId, filters = {}) {
    try {
      const query = { company: companyId };

      // Apply filters (similar to searchAuditLogs)
      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate)
          query.createdAt.$gte = new Date(filters.startDate);
        if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
      }
      if (filters.module) query.module = filters.module;
      if (filters.action) query.action = filters.action;

      const logs = await Audit.find(query)
        .sort({ createdAt: -1 })
        .populate("user", "firstName lastName email")
        .lean();

      // Format for CSV export
      return logs.map((log) => ({
        date: log.createdAt,
        user: log.user
          ? `${log.user.firstName} ${log.user.lastName}`
          : "System",
        email: log.user?.email || "N/A",
        action: log.action,
        module: log.module,
        resourceType: log.resourceType || "N/A",
        status: log.status,
        severity: log.severity,
        ipAddress: log.ipAddress || "N/A",
        details: JSON.stringify(log.details),
      }));
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get resource activity history
   */
  async getResourceHistory(companyId, resourceType, resourceId) {
    try {
      return await Audit.find({
        company: companyId,
        resourceType,
        resourceId,
      })
        .sort({ createdAt: -1 })
        .populate("user", "firstName lastName email")
        .lean();
    } catch (error) {
      throw error;
    }
  }

  /**
   * Clean up old audit logs (run periodically)
   */
  async cleanupOldLogs(daysToKeep = 730) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await Audit.deleteMany({
        createdAt: { $lt: cutoffDate },
        severity: { $nin: ["high", "critical"] }, // Keep critical logs longer
      });

      return {
        deleted: result.deletedCount,
        cutoffDate,
      };
    } catch (error) {
      throw error;
    }
  }
}

export default new AuditService();
