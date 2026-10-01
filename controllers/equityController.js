import vestingService from "../services/vestingService.js";
import Employee from "../models/employeeModel.js";
import EquityGrant from "../models/esopModel.js"

class EquityController {
  /**
   * Create equity grant for an employee
   * POST /api/equity/grants
   */
  async createEquityGrant(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;
      const grantData = req.body;

      // Validate required fields
      if (
        !grantData.employeeId ||
        !grantData.totalShares ||
        !grantData.vestingStartDate
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Employee ID, total shares, and vesting start date are required",
        });
      }

      const grant = await vestingService.createEquityGrant(
        grantData,
        companyId,
        userId
      );

      res.status(201).json({
        success: true,
        message: "Equity grant created successfully",
        data: grant,
      });
    } catch (error) {
      console.error("Create equity grant error:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to create equity grant",
      });
    }
  }

  /**
   * Upload cap table (CSV)
   * POST /api/equity/cap-table/upload
   */
  async uploadCapTable(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;
      const { capTableData } = req.body;

      if (
        !capTableData ||
        !Array.isArray(capTableData) ||
        capTableData.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Valid cap table data is required",
        });
      }

      const results = await vestingService.uploadCapTable(
        capTableData,
        companyId,
        userId
      );

      res.status(200).json({
        success: true,
        message: `Cap table uploaded. ${results.successful.length} successful, ${results.failed.length} failed`,
        data: results,
      });
    } catch (error) {
      console.error("Upload cap table error:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to upload cap table",
      });
    }
  }

  /**
   * Process vesting for all eligible grants
   * POST /api/equity/process-vesting
   */
  async processVesting(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;

      const result = await vestingService.processVesting(companyId, userId);

      res.status(200).json({
        success: true,
        message: `Processed vesting for ${result.processed} grants`,
        data: result,
      });
    } catch (error) {
      console.error("Process vesting error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to process vesting",
      });
    }
  }

  /**
   * Get employee equity information
   * GET /api/equity/employee/:employeeId
   */
  async getEmployeeEquity(req, res) {
    try {
      const companyId = req.user.company;
      const { employeeId } = req.params;

      // If employee role, can only view their own equity
      if (req.user.role === "employee") {
        const employee = await Employee.findOne({
          user: req.user.id,
          company: companyId,
        });

        if (!employee || employee._id.toString() !== employeeId) {
          return res.status(403).json({
            success: false,
            message: "You can only view your own equity information",
          });
        }
      }

      const equity = await vestingService.getEmployeeEquity(
        employeeId,
        companyId
      );

      res.status(200).json({
        success: true,
        data: equity,
      });
    } catch (error) {
      console.error("Get employee equity error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch employee equity",
      });
    }
  }

  /**
   * Get current user's equity (for employee dashboard)
   * GET /api/equity/my-equity
   */
  async getMyEquity(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;

      // Find employee record for current user
      const employee = await Employee.findOne({
        user: userId,
        company: companyId,
      });

      if (!employee) {
        return res.status(404).json({
          success: false,
          message: "Employee record not found",
        });
      }

      const equity = await vestingService.getEmployeeEquity(
        employee._id,
        companyId
      );

      res.status(200).json({
        success: true,
        data: equity,
      });
    } catch (error) {
      console.error("Get my equity error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch equity information",
      });
    }
  }

  /**
   * Get company equity overview
   * GET /api/equity/overview
   */
  async getCompanyEquityOverview(req, res) {
    try {
      const companyId = req.user.company;

      const overview = await vestingService.getCompanyEquityOverview(companyId);

      res.status(200).json({
        success: true,
        data: overview,
      });
    } catch (error) {
      console.error("Get equity overview error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch equity overview",
      });
    }
  }

  /**
   * Update equity grant
   * PUT /api/equity/grants/:id
   */
  async updateEquityGrant(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;
      const { id } = req.params;
      const updateData = req.body;

      const grant = await vestingService.updateEquityGrant(
        id,
        updateData,
        companyId,
        userId
      );

      res.status(200).json({
        success: true,
        message: "Equity grant updated successfully",
        data: grant,
      });
    } catch (error) {
      console.error("Update equity grant error:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to update equity grant",
      });
    }
  }

  /**
   * Terminate equity grant
   * DELETE /api/equity/grants/:id
   */
  async terminateEquityGrant(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;
      const { id } = req.params;
      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({
          success: false,
          message: "Termination reason is required",
        });
      }

      const grant = await vestingService.terminateEquityGrant(
        id,
        companyId,
        userId,
        reason
      );

      res.status(200).json({
        success: true,
        message: "Equity grant terminated successfully",
        data: grant,
      });
    } catch (error) {
      console.error("Terminate equity grant error:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to terminate equity grant",
      });
    }
  }

  /**
   * Get equity grant by ID
   * GET /api/equity/grants/:id
   */
  async getEquityGrantById(req, res) {
    try {
      const companyId = req.user.company;
      const { id } = req.params;

      const grant = await EquityGrant.findOne({
        _id: id,
        company: companyId,
      })
        .populate("employee", "user employeeId position")
        .populate({
          path: "employee",
          populate: {
            path: "user",
            select: "firstName lastName email",
          },
        })
        .lean();

      if (!grant) {
        return res.status(404).json({
          success: false,
          message: "Equity grant not found",
        });
      }

      // Calculate additional fields
      grant.sharesUnvested = grant.totalShares - grant.sharesVested;
      grant.vestingProgress = (
        (grant.sharesVested / grant.totalShares) *
        100
      ).toFixed(2);

      // Find next vesting date
      const nextVesting = grant.vestingSchedule.find(
        (v) => !v.isProcessed && new Date(v.vestingDate) > new Date()
      );
      grant.nextVestingDate = nextVesting ? nextVesting.vestingDate : null;
      grant.nextVestingShares = nextVesting ? nextVesting.sharesVested : null;

      res.status(200).json({
        success: true,
        data: grant,
      });
    } catch (error) {
      console.error("Get equity grant error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch equity grant",
      });
    }
  }

  /**
   * Get all equity grants for company
   * GET /api/equity/grants
   */
  async getAllEquityGrants(req, res) {
    try {
      const companyId = req.user.company;
      const { status, grantType, employeeId } = req.query;

      const query = { company: companyId };
      if (status) query.status = status;
      if (grantType) query.grantType = grantType;
      if (employeeId) query.employee = employeeId;

      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const skip = (page - 1) * limit;

      const [grants, total] = await Promise.all([
        EquityGrant.find(query)
        .populate("employee", "user employeeId position department")
        .populate({
          path: "employee",
          populate: {
            path: "user",
            select: "firstName lastName email",
          },
        })
        .sort({ grantDate: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      EquityGrant.countDocuments(query)
      ]);


      // Add calculated fields
      const grantsWithCalculations = grants.map((grant) => ({
        ...grant,
        sharesUnvested: grant.totalShares - grant.sharesVested,
        vestingProgress: (
          (grant.sharesVested / grant.totalShares) *
          100
        ).toFixed(2),
        nextVestingDate:
          grant.vestingSchedule.find(
            (v) => !v.isProcessed && new Date(v.vestingDate) > new Date()
          )?.vestingDate || null,
      }));

      res.status(200).json({
        success: true,
        data: grantsWithCalculations,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        }
      });
    } catch (error) {
      console.error("Get equity grants error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch equity grants",
      });
    }
  }
}

export default new EquityController();
