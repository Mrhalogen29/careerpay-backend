import auditService from "../services/auditService.js";
import payrollService from "../services/payrollService.js";
import vestingService from "../services/vestingService.js";
import Employee from "../models/employeeModel.js";
import Financing from "../models/financingModel.js";
import Company from "../models/companyModel.js";
import EquityGrant from "../models/esopModel.js"
import Payroll from "../models/payrollModel.js";

class DashboardController {
  /**
   * Get admin dashboard overview
   * GET /api/dashboard/admin
   */
  async getAdminDashboard(req, res) {
    try {
      const companyId = req.user.company;
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;

      const [
        company,
        employeeStats,
        payrollStats,
        equityOverview,
        recentActivities,
        activeFinancing,
      ] = await Promise.all([
        Company.findById(companyId).select("name email baseCurrency"),

        // Employee statistics
        Promise.all([
          Employee.countDocuments({ company: companyId, isActive: true }),
          Employee.countDocuments({ company: companyId }),
          Employee.aggregate([
            { $match: { company: companyId, isActive: true } },
            { $group: { _id: "$department", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
          ]),
        ]).then(([active, total, byDept]) => ({
          activeEmployees: active,
          totalEmployees: total,
          topDepartments: byDept,
        })),

        // Payroll statistics
        payrollService.getPayrollStats(companyId, currentYear),

        // Equity overview
        vestingService.getCompanyEquityOverview(companyId),

        // Recent activities
        auditService.getRecentActivities(companyId, 10),

        // Active financing
        Financing.findOne({
          company: companyId,
          status: { $in: ["active", "disbursed"] },
        }).select("approvedAmount outstandingBalance status"),
      ]);

      res.status(200).json({
        success: true,
        data: {
          company,
          employees: employeeStats,
          payroll: {
            ...(payrollStats || {}),
            currentMonth: {
              month: currentMonth,
              year: currentYear,
            },
          },
          equity: equityOverview,
          financing: activeFinancing
            ? {
                amount: activeFinancing.approvedAmount,
                outstanding: activeFinancing.outstandingBalance,
                status: activeFinancing.status,
              }
            : null,
          recentActivities,
        },
      });
    } catch (error) {
      console.error("Get admin dashboard error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch admin dashboard",
      });
    }
  }

  /**
   * Get HR dashboard
   * GET /api/dashboard/hr
   */
  async getHRDashboard(req, res) {
    try {
      const companyId = req.user.company;
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;

      const [employeeCount, recentHires, upcomingVesting, currentPayroll] =
        await Promise.all([
          Employee.countDocuments({ company: companyId, isActive: true }),

          // Recent hires (last 30 days)
          Employee.find({
            company: companyId,
            isActive: true,
            startDate: {
              $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            },
          })
            .populate("user", "firstName lastName email")
            .select("employeeId position startDate")
            .sort({ startDate: -1 })
            .limit(5)
            .lean(),

          // Upcoming vesting events (next 30 days)
          EquityGrant.find({
            company: companyId,
            status: "active",
            "vestingSchedule.vestingDate": {
              $gte: new Date(),
              $lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
            "vestingSchedule.isProcessed": false,
          })
            .populate("employee", "user employeeId")
            .populate({
              path: "employee",
              populate: { path: "user", select: "firstName lastName" },
            })
            .select("employee vestingSchedule")
            .limit(5)
            .lean(),

          // Current month payroll
          payrollService.getCompanyPayrolls(companyId, {
            month: currentMonth,
            year: currentYear,
          }),
        ]);

      res.status(200).json({
        success: true,
        data: {
          employeeCount,
          recentHires,
          upcomingVesting,
          currentPayroll: currentPayroll?.data?.[0] || null,
        },
      });
    } catch (error) {
      console.error("Get HR dashboard error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch HR dashboard",
      });
    }
  }

  /**
   * Get employee dashboard
   * GET /api/dashboard/employee
   */
  async getEmployeeDashboard(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;

      // Find employee record
      const employee = await Employee.findOne({
        user: userId,
        company: companyId,
      })
        .populate("user", "firstName lastName email")
        .populate("manager", "user employeeId position")
        .lean();

      if (!employee) {
        return res.status(404).json({
          success: false,
          message: "Employee record not found",
        });
      }

      // Get equity information
      const equity = await vestingService.getEmployeeEquity(
        employee._id,
        companyId
      );

      // Get recent payslips (last 3 months)
      const currentDate = new Date();
      const threeMonthsAgo = new Date(currentDate);
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      const recentPayrolls = await Payroll.find({
        company: companyId,
        status: "completed",
        "payrollItems.employee": employee._id,
        createdAt: { $gte: threeMonthsAgo },
      })
        .select("payrollPeriod payrollItems currency")
        .sort({ "payrollPeriod.year": -1, "payrollPeriod.month": -1 })
        .limit(3)
        .lean();

      // Extract payslips for this employee
      const payslips = recentPayrolls.map((payroll) => {
        const item = payroll.payrollItems.find(
          (i) => i.employee.toString() === employee._id.toString()
        );
      if (!item) return null;

        return {
          month: payroll.payrollPeriod.month,
          year: payroll.payrollPeriod.year,
          netSalary: item.netSalary,
          grossSalary: item.grossSalary,
          currency: payroll.currency,
        };

      }).filter(Boolean); // filter out any nulls

      res.status(200).json({
        success: true,
        data: {
          employee,
          equity,
          recentPayslips: payslips,
        },
      });
    } catch (error) {
      console.error("Get employee dashboard error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch employee dashboard",
      });
    }
  }

  /**
   * Get audit statistics
   * GET /api/dashboard/audit-stats
   */
  async getAuditStats(req, res) {
    try {
      const companyId = req.user.company;
      const { startDate, endDate } = req.query;

      if (startDate && isNaN(new Date(startDate))) {
        return res.status(400).json({ success: false, message: "Invalid startDate" });
      }

      const stats = await auditService.getAuditStats(
        companyId,
        startDate,
        endDate
      );

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error("Get audit stats error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch audit statistics",
      });
    }
  }

  /**
   * Get activity timeline
   * GET /api/dashboard/activity-timeline
   */
  async getActivityTimeline(req, res) {
    try {
      const companyId = req.user.company;
      const { startDate, endDate, groupBy ="day" } = req.query;

      const allowed = ["day", "week", "month", "year"];
      if (!allowed.includes(groupBy)) {
        return res.status(400).json({
          success: false,
          message: "Invalid groupBy value"
        });
      }
      const timeline = await auditService.getActivityTimeline(
        companyId,
        startDate,
        endDate,
        groupBy
      );

      res.status(200).json({
        success: true,
        data: timeline,
      });
    } catch (error) {
      console.error("Get activity timeline error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch activity timeline",
      });
    }
  }

  /**
   * Get recent activities
   * GET /api/dashboard/recent-activities
   */
  async getRecentActivities(req, res) {
    try {
      const companyId = req.user.company;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);;

      const activities = await auditService.getRecentActivities(
        companyId,
        limit
      );

      res.status(200).json({
        success: true,
        data: activities,
      });
    } catch (error) {
      console.error("Get recent activities error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch recent activities",
      });
    }
  }

  /**
   * Get critical activities
   * GET /api/dashboard/critical-activities
   */
  async getCriticalActivities(req, res) {
    try {
      const companyId = req.user.company;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);

      const activities = await auditService.getCriticalActivities(
        companyId,
        limit
      );

      res.status(200).json({
        success: true,
        data: activities,
      });
    } catch (error) {
      console.error("Get critical activities error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch critical activities",
      });
    }
  }

  /**
   * Get failed activities
   * GET /api/dashboard/failed-activities
   */
  async getFailedActivities(req, res) {
    try {
      const companyId = req.user.company;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);

      const activities = await auditService.getFailedActivities(
        companyId,
        limit
      );

      res.status(200).json({
        success: true,
        data: activities,
      });
    } catch (error) {
      console.error("Get failed activities error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch failed activities",
      });
    }
  }

  /**
   * Search audit logs
   * POST /api/dashboard/search-audit
   */
  async searchAuditLogs(req, res) {
    try {
      const companyId = req.user.company;
      const filters = {
        ...req.body,
        page: req.query.page || 1,
        limit: req.query.limit || 50,
      };

      const result = await auditService.searchAuditLogs(companyId, filters);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("Search audit logs error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to search audit logs",
      });
    }
  }

  /**
   * Export audit logs
   * GET /api/dashboard/export-audit
   */
  async exportAuditLogs(req, res) {
    try {
      const companyId = req.user.company;
      const filters = {
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        module: req.query.module,
        action: req.query.action,
      };

      const logs = await auditService.exportAuditLogs(companyId, filters);

      res.status(200).json({
        success: true,
        data: logs,
        message: "Audit logs exported successfully",
      });
    } catch (error) {
      console.error("Export audit logs error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to export audit logs",
      });
    }
  }

  /**
   * Get company metrics summary
   * GET /api/dashboard/metrics
   */
  async getMetricsSummary(req, res) {
    try {
      const companyId = req.user.company;
      const currentYear = new Date().getFullYear();

      const [
        totalEmployees,
        activeEmployees,
        totalPayrollYTD,
        totalEquityGranted,
        activeFinancingCount,
      ] = await Promise.all([
        Employee.countDocuments({ company: companyId }),
        Employee.countDocuments({ company: companyId, isActive: true }),

        Payroll.aggregate([
          {
            $match: {
              company: companyId,
              "payrollPeriod.year": currentYear,
              status: "completed",
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: "$summary.totalNet" },
            },
          },
        ]).then((result) => result[0]?.total || 0),

        EquityGrant.aggregate([
          { $match: { company: companyId } },
          { $group: { _id: null, total: { $sum: "$totalShares" } } },
        ]).then((result) => result[0]?.total || 0),

        Financing.countDocuments({
          company: companyId,
          status: { $in: ["active", "disbursed"] },
        }),
      ]);

      res.status(200).json({
        success: true,
        data: {
          employees: {
            total: totalEmployees,
            active: activeEmployees,
            inactive: totalEmployees - activeEmployees,
          },
          payroll: {
            yearToDate: totalPayrollYTD,
            year: currentYear,
          },
          equity: {
            totalSharesGranted: totalEquityGranted,
          },
          financing: {
            activeLoans: activeFinancingCount,
          },
        },
      });
    } catch (error) {
      console.error("Get metrics summary error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch metrics summary",
      });
    }
  }
}

export default new DashboardController();
