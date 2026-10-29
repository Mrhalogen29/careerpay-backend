import express from "express";
import Company from "../models/companyModel.js";
import Employee from "../models/employeeModel.js";
import {
  protect,
  isFounderOrAdmin,
  requireVerified,
} from "../middlewares/authMiddleware.js";
import Audit from "../models/auditModel.js";

const router = express.Router();

// All routes require authentication
router.use(protect);
router.use(requireVerified);

// ─── Helper ──────────────────────────────────────────────────────────────────
// Re-evaluates whether a company has completed onboarding.
// A company is fully onboarded when all four conditions are met:
function checkOnboardingComplete(company) {
  return (
    !!company.baseCurrency &&
    !!company.payrollSettings?.payFrequency &&
    !!company.bankDetails &&
    !!company.isVerified &&
    !!company.address?.street &&
    !!company.address?.city &&
    !!company.address?.state
  );
}

/**
 * @route   GET /api/companies/profile
 * @desc    Get company profile (BR-001)
 * @access  Private
 */
router.get("/profile", protect, async (req, res) => {
  try {
    const company = await Company.findById(req.user.company).lean();

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    res.status(200).json({
      success: true,
      data: company,
    });
  } catch (error) {
    console.error("Get company profile error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch company profile",
    });
  }
});

/**
 * @route   PUT /api/companies/profile
 * @desc    Update company profile
 * @access  Private (Founder, Admin)
 */
router.put("/profile", isFounderOrAdmin, async (req, res) => {
  try {
    const companyId = req.user.company;
    const userId = req.user.id;
    const updates = req.body;

    const company = await Company.findById(companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const before = { ...company.toObject() };

    // Update allowed fields
    const allowedUpdates = [
      "name",
      "email",
      "phone",
      "address",
      "industry",
      "companySize",
      "website",
      "logo",
      "bankDetails",
    ];

    allowedUpdates.forEach((field) => {
      if (updates[field] !== undefined) {
        company[field] = updates[field];
      }
    });

    company.onboardingCompleted = checkOnboardingComplete(company);
    await company.save();

    // Log audit
    await Audit.log({
      company: companyId,
      user: userId,
      action: "company_updated",
      module: "company",
      resourceType: "company",
      resourceId: companyId,
      changes: {
        before,
        after: company.toObject(),
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      status: "success",
      severity: "medium",
    });

    res.status(200).json({
      success: true,
      message: "Company profile updated successfully",
      data: company,
    });
  } catch (error) {
    console.error("Update company profile error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to update company profile",
    });
  }
});

/**
 * @route   PUT /api/companies/settings
 * @desc    Update company settings (payroll, etc.)
 * @access  Private (Founder, Admin)
 */
router.put("/settings", protect, isFounderOrAdmin, async (req, res) => {
  try {
    const companyId = req.user.company;
    const userId = req.user.id;
    const { payrollSettings, baseCurrency, bankDetails, address } = req.body;

    const company = await Company.findById(companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const snapshot = company.toObject();
    const before = {
      payrollSettings: snapshot.payrollSettings,
      baseCurrency: snapshot.baseCurrency,
      bankDetails: snapshot.bankDetails,
      address: snapshot.address,
    };

    // Update settings
    if (bankDetails) {
      company.bankDetails = {
        ...company.bankDetails,
        ...bankDetails,
      };

      company.markModified("bankDetails");
    }
    if (address) {
      company.address = {
        ...company.address,
        ...address,
      };

      company.markModified("address");
    }

    if (payrollSettings && typeof payrollSettings === "object") {
      // Only these keys can be changed from the Settings page
      const ALLOWED_PAYROLL_KEYS = [
        "paymentDay",
        "payFrequency",
        "enableAutomaticTax",
        "enablePension",
        "payDayRule",
        "payWeekday",
        "cutoffDay",
        "multiCurrencyEnabled",
        "autoCalculateOnCutoff",
        "autoApprove",
        "lockAfterApproval",
        "allowRetroactiveAdjustments",
        "approverRole",
        "dataRetentionMonths",
      ];
      ALLOWED_PAYROLL_KEYS.forEach((key) => {
        if (payrollSettings[key] !== undefined) {
          company.set(`payrollSettings.${key}`, payrollSettings[key]);
        }
      });
    }

    if (baseCurrency && baseCurrency !== company.baseCurrency) {
      // Changing the base currency while staff are paid in another one would
      // leave payroll inconsistent, unless multi-currency payroll is on.

      const multi =
        payrollSettings?.multiCurrencyEnabled ??
        company.payrollSettings?.multiCurrencyEnabled;
      if (!multi) {
        const mismatched = await Employee.countDocuments({
          company: companyId,
          isDeleted: { $ne: true },
          "salary.currency": { $ne: baseCurrency },
        });
        if (mismatched > 0) {
          return res.status(400).json({
            success: false,
            message: `${mismatched} employee(s) are paid in a different currency. Enable multi-currency payroll or update their salaries first.`,
          });
        }
      }
      company.baseCurrency = baseCurrency;
    }

    company.onboardingCompleted = checkOnboardingComplete(company);
    await company.save();

    // Log audit
    await Audit.log({
      company: companyId,
      user: userId,
      action: "company_settings_changed",
      module: "company",
      resourceType: "company",
      resourceId: companyId,
      changes: {
        before,
        after: {
          payrollSettings: company.payrollSettings,
          baseCurrency: company.baseCurrency,
          bankDetails: company.bankDetails,
          address: company.address,
        },
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      status: "success",
      severity: "high",
    });

    res.status(200).json({
      success: true,
      message: "Company settings updated successfully",
      data: {
        payrollSettings: company.payrollSettings,
        baseCurrency: company.baseCurrency,
        bankDetails: company.bankDetails,
        onboardingCompleted: company.onboardingCompleted,
      },
    });
  } catch (error) {
    console.error("Update company settings error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to update company settings",
    });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const companyId = req.user.company;

    const [
      totalEmployees,
      activeEmployees,
      inactiveEmployees,
      departmentStats,
    ] = await Promise.all([
      Employee.countDocuments({
        company: companyId,
      }),

      Employee.countDocuments({
        company: companyId,
        isActive: true,
      }),

      Employee.countDocuments({
        company: companyId,
        isActive: false,
      }),

      Employee.aggregate([
        {
          $match: {
            company: companyId,
            isActive: true,
          },
        },
        {
          $group: {
            _id: "$department",
            count: { $sum: 1 },
          },
        },
        {
          $sort: {
            count: -1,
          },
        },
      ]),
    ]);

    const departments = departmentStats.map((item) => ({
      department: item._id || "Unassigned",
      count: item.count,
    }));

    return res.status(200).json({
      success: true,
      data: {
        totalEmployees,
        activeEmployees,
        inactiveEmployees,
        departments,
      },
    });
  } catch (error) {
    console.error("Get company stats error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch company statistics",
    });
  }
});

export default router;
