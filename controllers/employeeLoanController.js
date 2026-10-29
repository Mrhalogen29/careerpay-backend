import mongoose from "mongoose";
import EmployeeLoan from "../models/employeeLoanModel.js";
import Audit from "../models/auditModel.js";
import Notification from "../models/notificationModel.js";
import User from "../models/userModel.js";

const OPEN_STATUSES = ["pending", "approved", "active"];

const fail = (res, code, message) =>
  res.status(code).json({ success: false, message });

// Audit failures must never break the request
const audit = (data) =>
  Audit.log({
    module: "financing",
    resourceType: "employee_loan",
    status: "success",
    severity: "medium",
    ...data,
  }).catch(() => {});

class EmployeeLoanController {
  /**
   * Employee requests a loan
   * POST /api/employee-loans
   */
  async requestLoan(req, res) {
    try {
      const employee = req.employee;
      if (!employee) {
        return fail(res, 403, "No employee record found for your account");
      }

      const requestedAmount = Number(req.body.requestedAmount);
      const termMonths = Number(req.body.termMonths);
      const purpose = req.body.purpose?.toString().trim();

      if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
        return fail(res, 400, "requestedAmount must be a positive number");
      }
      if (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > 24) {
        return fail(res, 400, "termMonths must be a whole number from 1 to 24");
      }

      // One open loan at a time
      const open = await EmployeeLoan.findOne({
        company: req.user.company,
        employee: employee._id,
        status: { $in: OPEN_STATUSES },
      });
      if (open) {
        return fail(
          res,
          400,
          "You already have a loan that is pending or active",
        );
      }

      const loan = await EmployeeLoan.create({
        company: req.user.company,
        employee: employee._id,
        requestedBy: req.user.id,
        requestedAmount,
        termMonths,
        purpose,
      });

      await audit({
        company: req.user.company,
        user: req.user.id,
        action: "employee_loan_requested",
        resourceId: loan._id,
        details: { requestedAmount, termMonths },
      });

      // ---- Notify founder / admin / HR ----
      // Never let a notification failure break the request, but log everything.
      try {
        const companyId = req.user.company?._id || req.user.company;
        const myId = String(req.user._id || req.user.id);

        // Case-insensitive role match, in case roles are stored as "Founder", "HR", etc.
        const approvers = await User.find({
          company: companyId,
          role: { $in: [/^founder$/i, /^admin$/i, /^hr$/i] },
        }).select("_id role email");

        console.log(
          `[loan-notify] company=${companyId} approvers found=${approvers.length}`,
          approvers.map((u) => `${u.role}:${u.email}`),
        );

        const who =
          `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() ||
          "An employee";
        const amt = Number(loan.requestedAmount).toLocaleString();

        for (const u of approvers) {
          if (String(u._id) === myId) continue; // don't notify the requester

          // Try the types your Notification enum might accept, until one works
          let sent = false;
          let lastErr;
          for (const type of ["payroll", "info", "system", "general"]) {
            try {
              await Notification.notify({
                company: companyId,
                user: u._id,
                title: "New loan request",
                message: `${who} requested a loan of ₦${amt}. Open Financing to review it.`,
                type,
                link: "financing",
              });
              sent = true;
              console.log(`[loan-notify] sent to ${u.email} (type=${type})`);
              break;
            } catch (err) {
              lastErr = err;
            }
          }
          if (!sent) {
            console.error(
              `[loan-notify] FAILED for ${u.email}:`,
              lastErr?.message,
              lastErr?.errors || "",
            );
          }
        }
      } catch (err) {
        console.error("[loan-notify] outer error:", err);
      }

      res.status(201).json({
        success: true,
        message: "Loan request submitted",
        data: loan,
      });
    } catch (error) {
      console.error("Request loan error:", error);
      fail(res, 400, error.message || "Failed to submit loan request");
    }
  }

  /**
   * Logged-in employee's own loans
   * GET /api/employee-loans/mine
   */
  async getMyLoans(req, res) {
    try {
      if (!req.employee) {
        return fail(res, 403, "No employee record found for your account");
      }

      const loans = await EmployeeLoan.find({
        company: req.user.company,
        employee: req.employee._id,
      })
        .sort({ createdAt: -1 })
        .lean();

      res.status(200).json({ success: true, data: loans });
    } catch (error) {
      console.error("Get my loans error:", error);
      fail(res, 500, "Failed to fetch your loans");
    }
  }

  /**
   * All loans in the company (HR and above)
   * GET /api/employee-loans?status=pending
   */
  async getCompanyLoans(req, res) {
    try {
      const query = { company: req.user.company };
      if (req.query.status) query.status = req.query.status;

      const loans = await EmployeeLoan.find(query)
        .populate({
          path: "employee",
          select: "employeeId position department",
          populate: { path: "user", select: "firstName lastName" },
        })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();

      res.status(200).json({ success: true, data: loans });
    } catch (error) {
      console.error("Get company loans error:", error);
      fail(res, 500, "Failed to fetch loans");
    }
  }

  /**
   * Approve a pending loan
   * PATCH /api/employee-loans/:id/approve
   * Body (optional): { approvedAmount, monthlyInstallment }
   */
  async approveLoan(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id))
        return fail(res, 400, "Invalid loan id");

      const loan = await EmployeeLoan.findOne({
        _id: id,
        company: req.user.company,
      });
      if (!loan) return fail(res, 404, "Loan not found");
      if (loan.status !== "pending") {
        return fail(
          res,
          400,
          `Only pending loans can be approved (this one is ${loan.status})`,
        );
      }

      // Separation of duties: nobody approves their own loan
      if (loan.requestedBy.toString() === req.user.id.toString()) {
        return fail(res, 403, "You cannot approve your own loan request");
      }

      const approvedAmount = Number(
        req.body.approvedAmount ?? loan.requestedAmount,
      );
      if (
        !Number.isFinite(approvedAmount) ||
        approvedAmount <= 0 ||
        approvedAmount > loan.requestedAmount
      ) {
        return fail(
          res,
          400,
          "approvedAmount must be more than 0 and not above the requested amount",
        );
      }

      const monthlyInstallment = Number(
        req.body.monthlyInstallment ??
          Math.ceil(approvedAmount / loan.termMonths),
      );
      if (
        !Number.isFinite(monthlyInstallment) ||
        monthlyInstallment <= 0 ||
        monthlyInstallment > approvedAmount
      ) {
        return fail(
          res,
          400,
          "monthlyInstallment must be more than 0 and not above the approved amount",
        );
      }

      // Conditional update: only succeeds if the loan is STILL pending
      const updated = await EmployeeLoan.findOneAndUpdate(
        { _id: id, company: req.user.company, status: "pending" },
        {
          status: "approved",
          approvedAmount,
          monthlyInstallment,
          reviewedBy: req.user.id,
          reviewedAt: new Date(),
        },
        { new: true },
      );
      if (!updated) return fail(res, 409, "This loan was already reviewed");

      await audit({
        company: req.user.company,
        user: req.user.id,
        action: "employee_loan_approved",
        resourceId: id,
        details: { approvedAmount, monthlyInstallment },
      });

      // Tell the employee. A notification failure must never break the approval.
      try {
        await Notification.notify({
          company: updated.company,
          user: updated.requestedBy,
          title: "Loan request approved",
          message: `Your loan request was approved for ₦${Number(updated.approvedAmount).toLocaleString()}. HR will activate it before the next payroll.`,
          type: "payroll",
          link: "my-loans",
        });
      } catch (err) {
        console.error("Loan approval notification error:", err.message);
      }

      res
        .status(200)
        .json({ success: true, message: "Loan approved", data: updated });
    } catch (error) {
      console.error("Approve loan error:", error);
      fail(res, 400, error.message || "Failed to approve loan");
    }
  }

  /**
   * Reject a pending loan
   * PATCH /api/employee-loans/:id/reject   Body: { reason }
   */
  async rejectLoan(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id))
        return fail(res, 400, "Invalid loan id");

      const reason = req.body.reason?.toString().trim();
      if (!reason) return fail(res, 400, "A rejection reason is required");

      const updated = await EmployeeLoan.findOneAndUpdate(
        { _id: id, company: req.user.company, status: "pending" },
        {
          status: "rejected",
          rejectionReason: reason,
          reviewedBy: req.user.id,
          reviewedAt: new Date(),
        },
        { new: true },
      );
      if (!updated) return fail(res, 404, "Pending loan not found");

      await audit({
        company: req.user.company,
        user: req.user.id,
        action: "employee_loan_rejected",
        resourceId: id,
        details: { reason },
      });

      try {
        await Notification.notify({
          company: updated.company,
          user: updated.requestedBy,
          title: "Loan request rejected",
          message: `Your loan request was rejected. Reason: ${reason}`,
          type: "payroll",
          link: "my-loans",
        });
      } catch (err) {
        console.error("Loan rejection notification error:", err.message);
      }

      res
        .status(200)
        .json({ success: true, message: "Loan rejected", data: updated });
    } catch (error) {
      console.error("Reject loan error:", error);
      fail(res, 400, error.message || "Failed to reject loan");
    }
  }

  /**
   * Activate an approved loan once the company has paid the employee.
   * From here, payroll starts deducting installments.
   * PATCH /api/employee-loans/:id/activate
   */

  async activateLoan(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id))
        return fail(res, 400, "Invalid loan id");

      const loan = await EmployeeLoan.findOne({
        _id: id,
        company: req.user.company,
      });
      if (!loan) return fail(res, 404, "Loan not found");

      const updated = await EmployeeLoan.findOneAndUpdate(
        { _id: id, company: req.user.company, status: "approved" },
        { status: "active", outstandingBalance: loan.approvedAmount },
        { new: true },
      );
      if (!updated)
        return fail(res, 400, "Only approved loans can be activated");

      await audit({
        company: req.user.company,
        user: req.user.id,
        action: "employee_loan_activated",
        resourceId: id,
        details: { outstandingBalance: updated.outstandingBalance },
      });

      res
        .status(200)
        .json({ success: true, message: "Loan activated", data: updated });
    } catch (error) {
      console.error("Activate loan error:", error);
      fail(res, 400, error.message || "Failed to activate loan");
    }
  }

  /**
   * Employee cancels their own pending request
   * PATCH /api/employee-loans/:id/cancel
   */
  async cancelLoan(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id))
        return fail(res, 400, "Invalid loan id");
      if (!req.employee)
        return fail(res, 403, "No employee record found for your account");

      const updated = await EmployeeLoan.findOneAndUpdate(
        {
          _id: id,
          company: req.user.company,
          employee: req.employee._id, // only the owner can cancel
          status: "pending",
        },
        { status: "cancelled" },
        { new: true },
      );
      if (!updated) return fail(res, 404, "Pending loan not found");

      res.status(200).json({
        success: true,
        message: "Loan request cancelled",
        data: updated,
      });
    } catch (error) {
      console.error("Cancel loan error:", error);
      fail(res, 400, error.message || "Failed to cancel loan");
    }
  }
}

export default new EmployeeLoanController();
