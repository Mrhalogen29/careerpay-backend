import mongoose from "mongoose";

const auditSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    action: {
      type: String,
      required: true,
      enum: [
        // Authentication
        "user_login",
        "user_logout",
        "user_registration",
        "user_profile_updated",
        "password_change",
        "password_reset",
        "password_reset_expired_token",

        // Company Management
        "company_created",
        "company_updated",
        "company_settings_changed",

        // Employee Management
        "employee_created",
        "employee_updated",
        "employee_profile_updated",
        "employee_deleted",
        "employee_activated",
        "employee_deactivated",

        // Payroll Operations
        "payroll_created",
        "payroll_calculated",
        "payroll_approved",
        "payroll_processed",
        "payroll_completed",
        "payroll_failed",
        "payroll_generated",
        "payroll_downloaded",
        "payroll_exported",
        "payroll_item_corrected",
        "payroll_compensation_added",

        // Equity Management
        "equity_grant_created",
        "equity_grant_updated",
        "equity_grant_deleted",
        "equity_viewed",
        "vesting_processed",
        "cap_table_uploaded",

        // Financing
        "financing_applied",
        "financing_approved",
        "financing_defaulted",
        "financing_rejected",
        "financing_disbursed",
        "repayment_made",
        "repayment_failed",

        // Subscription
        "subscription_activated",

        // Access Control
        "role_changed",
        "permission_granted",
        "permission_revoked",

        // System
        "settings_changed",
        "report_generated",
        "data_exported",
        "bulk_upload",
      ],
    },

    module: {
      type: String,
      required: true,
      enum: [
        "auth",
        "company",
        "employee",
        "payroll",
        "equity",
        "financing",
        "subscription",
        "admin",
        "system",
      ],
    },

    resourceType: {
      type: String,
      enum: [
        "user",
        "company",
        "employee",
        "payroll",
        "equity_grant",
        "financing",
        "subscription",
        "setting",
        "report",
      ],
    },

    resourceId: {
      type: mongoose.Schema.Types.ObjectId,
    },

    details: {
      type: mongoose.Schema.Types.Mixed,
    },

    changes: {
      before: mongoose.Schema.Types.Mixed,
      after: mongoose.Schema.Types.Mixed,
    },

    ipAddress: {
      type: String,
    },

    userAgent: {
      type: String,
    },

    status: {
      type: String,
      enum: ["success", "failure", "pending"],
      default: "success",
    },

    errorMessage: String,
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "low",
    },

    metadata: {
      sessionId: String,
      requestId: String,
      duration: Number,
      affectedRecords: Number,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient query
auditSchema.index({ company: 1, createdAt: -1 });
auditSchema.index({ user: 1, createdAt: -1 });
auditSchema.index({ action: 1, createdAt: -1 });
auditSchema.index({ module: 1, createdAt: -1 });
auditSchema.index({ resourceType: 1, resourceId: 1 });
auditSchema.index({ createdAt: -1 });

// Create audit log
auditSchema.statics.log = async function (auditData, options = {}) {
  try {
    return await this.create([auditData], options);
  } catch (error) {
    console.error("Audit log creation failed:", error);
  }
};

// get recent activities for dashboard
auditSchema.statics.getRecentActivities = async function (
  companyId,
  limit = 20
) {
  return await this.find({ company: companyId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("user", "firstName lastName email")
    .lean();
};

// get activity by module
auditSchema.statics.getByModule = async function (
  companyId,
  module,
  startDate,
  endDate
) {
  const query = { company: companyId, module };

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  return await this.find(query)
    .sort({ createdAt: -1 })
    .populate("user", "firstName lastName email")
    .lean();
};

// get user activity
auditSchema.statics.getUserActivity = async function (userId, limit = 50) {
  return await this.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

export default mongoose.model("Audit", auditSchema);
