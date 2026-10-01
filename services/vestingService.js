import EquityGrant from "../models/esopModel.js";
import Employee from "../models/employeeModel.js";
import Audit from "../models/auditModel.js";

class VestingService {
  /**
   * Generate vesting schedule for an equity grant
   */
  generateVestingSchedule(grantData) {
    const {
      totalShares,
      vestingStartDate,
      vestingPeriodMonths,
      cliffMonths,
      vestingFrequency,
    } = grantData;

    const schedule = [];
    const startDate = new Date(vestingStartDate);

    // Determine vesting interval in months
    let intervalMonths;
    switch (vestingFrequency) {
      case "monthly":
        intervalMonths = 1;
        break;
      case "quarterly":
        intervalMonths = 3;
        break;
      case "yearly":
        intervalMonths = 12;
        break;
      default:
        intervalMonths = 1;
    }

    // Calculate shares per interval
    const totalIntervals = Math.floor(vestingPeriodMonths / intervalMonths);
    const sharesPerInterval = totalShares / totalIntervals;

    let cumulativeVested = 0;
    let currentMonth = 0;

    while (currentMonth < vestingPeriodMonths) {
      currentMonth += intervalMonths;

      // Skip intervals before cliff
      if (currentMonth < cliffMonths) {
        continue;
      }

      // Calculate vesting date
      const vestingDate = new Date(startDate);
      vestingDate.setMonth(vestingDate.getMonth() + currentMonth);

      // For cliff period, vest all accumulated shares
      let sharesVested;
      if (currentMonth === cliffMonths) {
        // Calculate how many intervals occurred during cliff
        const cliffIntervals = Math.floor(cliffMonths / intervalMonths);
        sharesVested = sharesPerInterval * cliffIntervals;
      } else {
        sharesVested = sharesPerInterval;
      }

      cumulativeVested += sharesVested;

      schedule.push({
        vestingDate,
        sharesVested: Math.round(sharesVested * 100) / 100, // Round to 2 decimals
        cumulativeVested: Math.round(cumulativeVested * 100) / 100,
        isProcessed: false,
      });
    }

    return schedule;
  }

  /**
   * Create equity grant for an employee
   */
  async createEquityGrant(grantData, companyId, userId) {
    try {
      const {
        employeeId,
        grantType,
        totalShares,
        grantDate,
        vestingStartDate,
        vestingPeriodMonths,
        cliffMonths,
        vestingFrequency,
        strikePrice,
        currentFMV,
        notes,
      } = grantData;

      // Verify employee exists
      const employee = await Employee.findOne({
        _id: employeeId,
        company: companyId,
        isActive: true,
      });

      if (!employee) {
        throw new Error("Employee not found or inactive");
      }

      // Generate vesting schedule
      const vestingSchedule = this.generateVestingSchedule({
        totalShares,
        vestingStartDate,
        vestingPeriodMonths,
        cliffMonths,
        vestingFrequency,
      });

      // Create equity grant
      const equityGrant = await EquityGrant.create({
        company: companyId,
        employee: employeeId,
        grantType,
        totalShares,
        grantDate: grantDate || new Date(),
        vestingStartDate,
        vestingPeriodMonths,
        cliffMonths,
        vestingFrequency,
        strikePrice,
        currentFMV,
        vestingSchedule,
        notes,
      });

      // Log audit
      await Audit.log({
        company: companyId,
        user: userId,
        action: "equity_grant_created",
        module: "equity",
        resourceType: "equity_grant",
        resourceId: equityGrant._id,
        details: {
          employeeId,
          totalShares,
          vestingPeriodMonths,
        },
        status: "success",
        severity: "medium",
      });

      return equityGrant;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Upload cap table and create multiple equity grants
   */
  async uploadCapTable(capTableData, companyId, userId) {
    try {
      const results = {
        successful: [],
        failed: [],
      };

      for (const row of capTableData) {
        try {
          // Find employee by email
          const employee = await Employee.findOne({
            company: companyId,
            isActive: true,
          }).populate("user", "email");

          const matchedEmployee =
            employee && employee.user.email === row.email ? employee : null;

          if (!matchedEmployee) {
            results.failed.push({
              email: row.email,
              reason: "Employee not found",
            });
            continue;
          }

          // Create equity grant
          const grant = await this.createEquityGrant(
            {
              employeeId: matchedEmployee._id,
              grantType: row.grantType || "stock_option",
              totalShares: row.totalShares,
              grantDate: row.grantDate || new Date(),
              vestingStartDate: row.vestingStartDate || new Date(),
              vestingPeriodMonths: row.vestingPeriodMonths || 48,
              cliffMonths: row.cliffMonths || 12,
              vestingFrequency: row.vestingFrequency || "monthly",
              strikePrice: row.strikePrice,
              currentFMV: row.currentFMV,
            },
            companyId,
            userId
          );

          results.successful.push({
            email: row.email,
            grantId: grant._id,
          });
        } catch (error) {
          results.failed.push({
            email: row.email,
            reason: error.message,
          });
        }
      }

      // Log audit
      await Audit.log({
        company: companyId,
        user: userId,
        action: "cap_table_uploaded",
        module: "equity",
        details: {
          totalRecords: capTableData.length,
          successful: results.successful.length,
          failed: results.failed.length,
        },
        status: "success",
        severity: "high",
        metadata: {
          affectedRecords: results.successful.length,
        },
      });

      return results;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Process vesting for all eligible grants
   */
  async processVesting(companyId, userId) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find all active equity grants
      const grants = await EquityGrant.find({
        company: companyId,
        status: "active",
      });

      const processedGrants = [];

      for (const grant of grants) {
        let updated = false;

        // Check each vesting milestone
        for (const milestone of grant.vestingSchedule) {
          if (
            !milestone.isProcessed &&
            new Date(milestone.vestingDate) <= today
          ) {
            // Mark as processed
            milestone.isProcessed = true;
            milestone.processedAt = new Date();

            // Update vested shares
            grant.sharesVested = milestone.cumulativeVested;
            updated = true;

            // Check if fully vested
            if (grant.sharesVested >= grant.totalShares) {
              grant.status = "fully_vested";
            }
          }
        }

        if (updated) {
          await grant.save();
          processedGrants.push(grant);

          // Log audit
          await Audit.log({
            company: companyId,
            user: userId,
            action: "vesting_processed",
            module: "equity",
            resourceType: "equity_grant",
            resourceId: grant._id,
            details: {
              employeeId: grant.employee,
              sharesVested: grant.sharesVested,
              totalShares: grant.totalShares,
            },
            status: "success",
            severity: "medium",
          });

          // TODO: Send email notification to employee
        }
      }

      return {
        processed: processedGrants.length,
        grants: processedGrants,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get employee equity information
   */
  async getEmployeeEquity(employeeId, companyId) {
    try {
      const grants = await EquityGrant.find({
        company: companyId,
        employee: employeeId,
        status: { $in: ["active", "fully_vested"] },
      })
        .sort({ grantDate: -1 })
        .lean();

      const summary = {
        totalGranted: 0,
        totalVested: 0,
        totalUnvested: 0,
        totalExercised: 0,
        grants: [],
      };

      for (const grant of grants) {
        summary.totalGranted += grant.totalShares;
        summary.totalVested += grant.sharesVested;
        summary.totalUnvested += grant.totalShares - grant.sharesVested;
        summary.totalExercised += grant.sharesExercised || 0;

        // Find next vesting date
        const nextVesting = grant.vestingSchedule.find(
          (v) => !v.isProcessed && new Date(v.vestingDate) > new Date()
        );

        summary.grants.push({
          _id: grant._id,
          grantType: grant.grantType,
          totalShares: grant.totalShares,
          sharesVested: grant.sharesVested,
          sharesUnvested: grant.totalShares - grant.sharesVested,
          vestingProgress: (
            (grant.sharesVested / grant.totalShares) *
            100
          ).toFixed(2),
          nextVestingDate: nextVesting ? nextVesting.vestingDate : null,
          nextVestingShares: nextVesting ? nextVesting.sharesVested : null,
          grantDate: grant.grantDate,
          status: grant.status,
        });
      }

      return summary;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get company equity overview
   */
  async getCompanyEquityOverview(companyId) {
    try {
      const grants = await EquityGrant.find({ company: companyId })
        .populate("employee", "user employeeId position")
        .lean();

      const overview = {
        totalSharesGranted: 0,
        totalSharesVested: 0,
        totalSharesUnvested: 0,
        totalEmployeesWithEquity: new Set(),
        grantsByType: {},
        grantsByStatus: {},
      };

      for (const grant of grants) {
        overview.totalSharesGranted += grant.totalShares;
        overview.totalSharesVested += grant.sharesVested;
        overview.totalSharesUnvested += grant.totalShares - grant.sharesVested;
        overview.totalEmployeesWithEquity.add(grant.employee._id.toString());

        // Count by type
        overview.grantsByType[grant.grantType] =
          (overview.grantsByType[grant.grantType] || 0) + 1;

        // Count by status
        overview.grantsByStatus[grant.status] =
          (overview.grantsByStatus[grant.status] || 0) + 1;
      }

      overview.totalEmployeesWithEquity =
        overview.totalEmployeesWithEquity.size;

      return overview;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update equity grant
   */
  async updateEquityGrant(grantId, updateData, companyId, userId) {
    try {
      const grant = await EquityGrant.findOne({
        _id: grantId,
        company: companyId,
      });

      if (!grant) {
        throw new Error("Equity grant not found");
      }

      const before = { ...grant.toObject() };

      // Update allowed fields
      if (updateData.currentFMV !== undefined)
        grant.currentFMV = updateData.currentFMV;
      if (updateData.strikePrice !== undefined)
        grant.strikePrice = updateData.strikePrice;
      if (updateData.notes !== undefined) grant.notes = updateData.notes;
      if (updateData.status !== undefined) grant.status = updateData.status;

      await grant.save();

      // Log audit
      await Audit.log({
        company: companyId,
        user: userId,
        action: "equity_grant_updated",
        module: "equity",
        resourceType: "equity_grant",
        resourceId: grant._id,
        changes: {
          before,
          after: grant.toObject(),
        },
        status: "success",
        severity: "medium",
      });

      return grant;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Terminate equity grant (when employee leaves)
   */
  async terminateEquityGrant(grantId, companyId, userId, reason) {
    try {
      const grant = await EquityGrant.findOne({
        _id: grantId,
        company: companyId,
      });

      if (!grant) {
        throw new Error("Equity grant not found");
      }

      grant.status = "terminated";
      grant.notes = `${grant.notes || ""}\nTerminated: ${reason}`;
      await grant.save();

      // Log audit
      await Audit.log({
        company: companyId,
        user: userId,
        action: "equity_grant_deleted",
        module: "equity",
        resourceType: "equity_grant",
        resourceId: grant._id,
        details: { reason },
        status: "success",
        severity: "high",
      });

      return grant;
    } catch (error) {
      throw error;
    }
  }
}

export default new VestingService();
