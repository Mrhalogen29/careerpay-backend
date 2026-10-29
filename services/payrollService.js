import mongoose from "mongoose";

import Payroll from "../models/payrollModel.js";
import Employee from "../models/employeeModel.js";
import Company from "../models/companyModel.js";
import Financing from "../models/financingModel.js";
import Audit from "../models/auditModel.js";
import PaymentTransaction from "../models/paymentTransactionModel.js";
import EmployeeLoan from "../models/employeeLoanModel.js";
import subscriptionService from "./subscriptionService.js";
import taxCalculationService from "./taxCalculationService.js";

/**
 * Send one payment to BullMQ when the queue is enabled (ENABLE_QUEUE=true).
 * When the queue is off, process the payment directly in this process instead.
 * Returns the BullMQ job id, or null when the payment was processed directly.
 */
async function dispatchPayment(transaction, preferredGateway, jobId = null) {
  const transactionId = transaction._id.toString();
  const { paymentQueue, QUEUE_ENABLED } =
    await import("../config/paymentQueue.js");

  if (QUEUE_ENABLED && paymentQueue) {
    const job = await paymentQueue.add(
      "process-payment",
      { transactionId, preferredGateway },
      { jobId: jobId || `payment-${transactionId}` },
    );

    return job.id;
  }

  // Queue disabled: run the payment now. The processor records success or
  // failure on the transaction itself, so errors are logged, not rethrown.
  const { processPaymentJob } = await import("./paymentWorker.js");

  try {
    await processPaymentJob({
      id: `direct-${transactionId}`,
      data: { transactionId, preferredGateway },
    });
  } catch (error) {
    console.error(`Direct payment ${transactionId} failed: ${error.message}`);
  }

  return null;
}

function getMonthName(month) {
  return new Date(2000, month - 1, 1).toLocaleString("default", {
    month: "long",
  });
}

class PayrollService {
  /**
   * Create a new payroll run
   */
  async createPayroll(companyId, month, year, userId) {
    const company = await Company.findById(companyId).select(
      "baseCurrency payrollSettings bankDetails name",
    );

    if (!company) {
      throw new Error("Company not found");
    }

    if (!company.baseCurrency || !company.payrollSettings?.payFrequency) {
      const error = new Error(
        "Complete company settings before creating payroll",
      );
      error.statusCode = 400;
      throw error;
    }

    const activeEmployeeCount = await Employee.countDocuments({
      company: companyId,
      isActive: true,
    });

    if (activeEmployeeCount === 0) {
      const error = new Error("Cannot create payroll with no active employees");
      error.statusCode = 400;
      throw error;
    }

    const maxPeriodsPerMonth = {
      monthly: 1,
      "bi-weekly": 2,
      weekly: 4,
    };

    const payFrequency = company.payrollSettings?.payFrequency || "monthly";

    const maxPeriods = maxPeriodsPerMonth[payFrequency];

    const existingCount = await Payroll.countDocuments({
      company: companyId,
      "payrollPeriod.month": month,
      "payrollPeriod.year": year,
    });

    if (existingCount >= maxPeriods) {
      const error = new Error(
        payFrequency === "monthly"
          ? `Payroll already exists for ${getMonthName(month)} ${year}`
          : `Maximum payroll runs for ${getMonthName(month)} ${year} reached. Your pay frequency allows ${maxPeriods} payroll runs per month.`,
      );

      error.statusCode = 400;
      throw error;
    }

    const periodNumber = existingCount + 1;

    const bankWarning = !company.bankDetails?.accountNumber
      ? "Add bank details to your company profile to use the financing option"
      : null;

    const payroll = await Payroll.create({
      company: companyId,
      createdBy: userId,
      currency: company.baseCurrency,
      payrollPeriod: {
        month,
        year,
        periodNumber,
      },
      status: "draft",
    });

    await Audit.log({
      company: companyId,
      user: userId,
      action: "payroll_created",
      module: "payroll",
      resourceType: "payroll",
      resourceId: payroll._id,
      details: {
        month,
        year,
        periodNumber,
        period: `${getMonthName(month)} ${year} - Period ${periodNumber}`,
        activeEmployees: activeEmployeeCount,
      },
      status: "success",
      severity: "medium",
    });

    return {
      payroll,
      bankWarning,
    };
  }

  /**
   * Calculate payroll for all active employees
   */
  async calculatePayroll(payrollId, companyId, userId) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const payroll = await Payroll.findOne({
        _id: payrollId,
        company: companyId,
      }).session(session);

      if (!payroll) {
        throw new Error("Payroll not found");
      }

      if (payroll.status !== "draft") {
        throw new Error("Payroll can only be calculated when in draft status");
      }

      const periodEndDate = new Date(
        payroll.payrollPeriod.year,
        payroll.payrollPeriod.month,
        0,
      );

      const employees = await Employee.find({
        company: companyId,
        isActive: true,
        status: { $ne: "suspended" },
        startDate: {
          $lte: periodEndDate,
        },
      })
        .session(session)
        .populate("user", "firstName lastName email");

      if (employees.length === 0) {
        throw new Error("No active employees found");
      }

      // Staff loans are under review: no loan deductions unless switched on
      const loansEnabled = process.env.ENABLE_STAFF_LOANS === "true";
      const hasFinancing =
        loansEnabled &&
        (await subscriptionService.hasActiveSubscription(
          companyId,
          "financing",
        ));
      const activeLoans = hasFinancing
        ? await EmployeeLoan.find({
            company: companyId,
            status: "active",
            employee: { $in: employees.map((e) => e._id) },
          }).session(session)
        : [];

      const loanByEmployee = new Map(
        activeLoans.map((l) => [l.employee.toString(), l]),
      );

      const payrollItems = [];

      for (const employee of employees) {
        const existingItem = payroll.payrollItems.find(
          (item) => item.employee.toString() === employee._id.toString(),
        );

        const proration = taxCalculationService.getProrationDetails(
          employee,
          payroll.payrollPeriod.month,
          payroll.payrollPeriod.year,
        );

        const effectiveBaseSalary = proration.isProrated
          ? taxCalculationService.calculateProration(
              employee.salary.amount,
              proration.daysInMonth,
              proration.daysWorked,
            )
          : employee.salary.amount;

        const effectiveAllowances = (
          existingItem?.additions?.allowances || []
        ).map((allowance) => ({
          ...allowance,
          amount: proration.isProrated
            ? taxCalculationService.calculateProration(
                allowance.amount,
                proration.daysInMonth,
                proration.daysWorked,
              )
            : allowance.amount,
        }));

        const effectiveBonus = existingItem?.additions?.bonus || 0;

        const effectiveOvertime = existingItem?.additions?.overtime || 0;

        // Tax is calculated on taxable earnings only.
        // Overtime is deliberately NOT passed in: it is paid untaxed.
        const calculation = taxCalculationService.calculateEmployeePayroll({
          grossSalary: effectiveBaseSalary,
          currency: employee.salary.currency,
          allowances: effectiveAllowances,
          bonuses: effectiveBonus,
          otherDeductions: existingItem?.deductions?.otherDeductions || [],
          taxRelief: employee.taxInformation?.taxRelief || null,
        });

        // Overtime is added after tax
        const payBeforeLoan = calculation.netSalary + effectiveOvertime;

        const loan = loanByEmployee.get(employee._id.toString());
        const loanRepayment = loan
          ? Math.round(
              Math.max(
                0,
                Math.min(
                  loan.monthlyInstallment,
                  loan.outstandingBalance,
                  payBeforeLoan,
                ),
              ) * 100,
            ) / 100
          : 0;

        payrollItems.push({
          employee: employee._id,

          baseSalary: effectiveBaseSalary,

          grossSalary: calculation.grossSalary + effectiveOvertime,

          deductions: {
            tax: calculation.deductions.tax,
            pension: calculation.deductions.pension,
            nhf: calculation.deductions.nhf,
            loanRepayment,
            loan: loanRepayment > 0 ? loan._id : undefined,
            otherDeductions: calculation.deductions.otherDeductions,
          },

          additions: {
            bonus: calculation.additions.bonuses,
            allowances: calculation.additions.allowances,
            overtime: effectiveOvertime,
          },

          employerContributions: {
            pension: calculation.employerContributions.pension,
            nhis: calculation.employerContributions.nhis,
            itf: calculation.employerContributions.itf,
            nsitf: calculation.employerContributions.nsitf,
          },

          netSalary: Math.round((payBeforeLoan - loanRepayment) * 100) / 100,

          paymentStatus: "pending",

          prorationDetails: {
            isProrated: proration.isProrated,
            daysWorked: proration.isProrated ? proration.daysWorked : null,
            daysInMonth: proration.isProrated ? proration.daysInMonth : null,
            note: proration.isProrated ? proration.prorationNote : null,
          },
        });
      }

      payroll.payrollItems = payrollItems;

      payroll.summary = {
        totalGross: payrollItems.reduce(
          (sum, item) => sum + item.grossSalary,
          0,
        ),

        totalDeductions: payrollItems.reduce(
          (sum, item) =>
            sum +
            item.deductions.tax +
            item.deductions.pension +
            item.deductions.nhf +
            (item.deductions.loanRepayment || 0),
          0,
        ),

        totalAdditions: payrollItems.reduce(
          (sum, item) =>
            sum +
            item.additions.bonus +
            item.additions.overtime +
            item.additions.allowances.reduce(
              (allowanceSum, allowance) =>
                allowanceSum + (allowance.amount || 0),
              0,
            ),
          0,
        ),

        totalNet: payrollItems.reduce((sum, item) => sum + item.netSalary, 0),

        totalEmployerContributions: payrollItems.reduce(
          (sum, item) =>
            sum +
            item.employerContributions.pension +
            item.employerContributions.nhis +
            item.employerContributions.itf +
            item.employerContributions.nsitf,
          0,
        ),

        totalEmployees: payrollItems.length,
      };

      payroll.status = "calculated";

      await payroll.save({
        session,
      });

      await Audit.log(
        {
          company: companyId,
          user: userId,
          action: "payroll_calculated",
          module: "payroll",
          resourceType: "payroll",
          resourceId: payroll._id,

          details: {
            month: payroll.payrollPeriod.month,
            year: payroll.payrollPeriod.year,
            totalEmployees: payroll.summary.totalEmployees,
            totalNet: payroll.summary.totalNet,
          },

          status: "success",
          severity: "medium",

          metadata: {
            affectedRecords: payroll.summary.totalEmployees,
          },
        },
        session,
      );

      await session.commitTransaction();

      return payroll;
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      throw error;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Approve payroll
   */
  async approvePayroll(payrollId, companyId, userId) {
    const payroll = await Payroll.findOne({
      _id: payrollId,
      company: companyId,
    });

    if (!payroll) {
      throw new Error("Payroll not found");
    }

    if (payroll.status !== "calculated") {
      throw new Error("Payroll must be calculated before approval");
    }

    payroll.status = "approved";
    payroll.approvedBy = userId;
    payroll.approvedAt = new Date();

    await payroll.save();

    await Audit.log({
      company: companyId,
      user: userId,
      action: "payroll_approved",
      module: "payroll",
      resourceType: "payroll",
      resourceId: payroll._id,

      details: {
        month: payroll.payrollPeriod.month,
        year: payroll.payrollPeriod.year,
        totalAmount: payroll.summary.totalNet,
      },

      status: "success",
      severity: "high",
    });

    return payroll;
  }

  async processPayroll(
    payrollId,
    companyId,
    userId,
    useFinancing = false,
    preferredGateway = null,
  ) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const payroll = await Payroll.findOne({
        _id: payrollId,
        company: companyId,
      })
        .populate("company")
        .populate({
          path: "payrollItems.employee",
          select: "bankDetails salary user",
          populate: {
            path: "user",
            select: "firstName lastName email",
          },
        })
        .session(session);

      if (!payroll) {
        throw new Error("Payroll not found");
      }

      if (payroll.status !== "approved") {
        throw new Error("Payroll must be approved before processing");
      }

      /**
       * DUPLICATE PAYMENT PROTECTION
       *
       * Never create another active/success transaction
       * for the same payroll.
       */

      const existingTransactions = await PaymentTransaction.find({
        payroll: payrollId,
        company: companyId,
        status: {
          $in: ["pending", "processing", "success"],
        },
      }).session(session);

      if (existingTransactions.length > 0) {
        throw new Error(
          "Payment has already been initiated for this payroll. Duplicate payment is not allowed.",
        );
      }

      const oldFailedTransactions = await PaymentTransaction.find({
        payroll: payrollId,
        company: companyId,
        status: "failed",
      }).session(session);

      if (oldFailedTransactions.length > 0) {
        throw new Error(
          "This payroll already has failed payment transactions. Use the retry failed payments action instead of processing the payroll again.",
        );
      }

      for (const item of payroll.payrollItems) {
        const employee = item.employee;

        if (!employee?.bankDetails?.accountNumber) {
          throw new Error(
            `Employee ${employee?._id || item.employee} does not have a bank account number.`,
          );
        }

        if (!employee?.bankDetails?.bankCode) {
          throw new Error(
            `Employee ${employee?._id || item.employee} does not have a bank code.`,
          );
        }
      }

      /**
       * Financing check
       */
      if (useFinancing) {
        const activeFinancing = await Financing.findOne({
          company: companyId,
          status: "active",
          outstandingBalance: {
            $gte: payroll.summary.totalNet,
          },
        }).session(session);

        if (!activeFinancing) {
          throw new Error(
            "No active financing available with sufficient balance",
          );
        }

        payroll.financingUsed = activeFinancing._id;
      }

      /**
       * Move payroll into processing.
       */
      payroll.status = "processing";
      payroll.processedBy = userId;
      payroll.processedAt = new Date();

      payroll.payrollItems.forEach((item) => {
        item.paymentStatus = "processing";
      });

      await payroll.save({
        session,
      });

      await Audit.log(
        {
          company: companyId,
          user: userId,
          action: "payroll_processed",
          module: "payroll",
          resourceType: "payroll",
          resourceId: payrollId,

          details: {
            month: payroll.payrollPeriod.month,
            year: payroll.payrollPeriod.year,
            totalEmployees: payroll.summary.totalEmployees,
            totalNet: payroll.summary.totalNet,
            preferredGateway: preferredGateway || "automatic",
          },

          status: "success",
          severity: "high",
        },
        session,
      );

      await session.commitTransaction();

      /**
       * End Mongo session BEFORE starting queue work.
       */
      await session.endSession();

      const queuedTransactions = [];

      /**
       * Create one payment transaction per employee.
       */
      for (const item of payroll.payrollItems) {
        const employee = item.employee;

        try {
          const paymentReference =
            `PAY-${payrollId.toString().slice(-8)}-` +
            `${employee._id.toString().slice(-8)}-` +
            `${Date.now().toString(36)}`;

          const transaction = await PaymentTransaction.create({
            company: companyId,
            payroll: payrollId,
            employee: employee._id,

            amount: item.netSalary,

            currency: payroll.currency,

            bankDetails: {
              bankName: employee.bankDetails.bankName,
              bankCode: employee.bankDetails.bankCode,
              accountNumber: employee.bankDetails.accountNumber,
              accountName: employee.bankDetails.accountName,
            },

            status: "pending",

            gateway: preferredGateway === "monnify" ? "monnify" : "flutterwave",

            paymentReference,

            initiatedBy: userId,
          });

          /**
           * Queue the payment in BullMQ, or process it directly
           * when the queue is disabled.
           */
          const jobId = await dispatchPayment(transaction, preferredGateway);

          if (jobId) {
            transaction.queueJobId = jobId;

            await transaction.save();
          }

          queuedTransactions.push(transaction);
        } catch (paymentError) {
          console.error(
            `Failed to queue payment for employee ${employee._id}:`,
            paymentError.message,
          );

          /**
           * Mark that payroll item as failed instead of
           * leaving it permanently in processing.
           */
          await Payroll.updateOne(
            {
              _id: payrollId,
              company: companyId,
              "payrollItems.employee": employee._id,
            },
            {
              $set: {
                "payrollItems.$.paymentStatus": "failed",
              },
            },
          );

          await Audit.log({
            company: companyId,
            user: userId,
            action: "payroll_failed",
            module: "payroll",
            resourceType: "payroll",
            resourceId: payrollId,

            details: {
              employeeId: employee._id,
              reason: paymentError.message,
            },

            status: "failure",
            errorMessage: paymentError.message,
            severity: "critical",
          });
        }
      }

      if (queuedTransactions.length === 0) {
        await Payroll.findOneAndUpdate(
          {
            _id: payrollId,
            company: companyId,
            status: "processing",
          },
          {
            status: "failed",
          },
        );

        throw new Error("No payroll payments could be queued.");
      }

      return await Payroll.findById(payrollId);
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      await session.endSession();

      await Payroll.findOneAndUpdate(
        {
          _id: payrollId,
          company: companyId,
          status: "approved",
        },
        {
          status: "failed",
        },
      );

      await Audit.log({
        company: companyId,
        user: userId,
        action: "payroll_failed",
        module: "payroll",
        resourceType: "payroll",
        resourceId: payrollId,

        status: "failure",
        errorMessage: error.message,
        severity: "critical",
      });

      throw error;
    }
  }

  async removeEmployeeFromOpenPayrolls(employeeId, companyId, userId) {
    const payrolls = await Payroll.find({
      company: companyId,
      status: { $in: ["draft", "calculated", "approved"] },
      "payrollItems.employee": employeeId,
    });

    for (const payroll of payrolls) {
      const previousStatus = payroll.status;

      payroll.payrollItems = payroll.payrollItems.filter(
        (item) => item.employee.toString() !== employeeId.toString(),
      );

      const items = payroll.payrollItems;
      const total = (fn) => items.reduce((sum, item) => sum + fn(item), 0);

      payroll.summary = {
        totalGross: total((i) => i.grossSalary || 0),
        totalDeductions: total(
          (i) =>
            (i.deductions?.tax || 0) +
            (i.deductions?.pension || 0) +
            (i.deductions?.nhf || 0) +
            (i.deductions?.loanRepayment || 0),
        ),
        totalAdditions: total(
          (i) =>
            (i.additions?.bonus || 0) +
            (i.additions?.overtime || 0) +
            (i.additions?.allowances || []).reduce(
              (s, a) => s + (a.amount || 0),
              0,
            ),
        ),
        totalNet: total((i) => i.netSalary || 0),
        totalEmployerContributions: total(
          (i) =>
            (i.employerContributions?.pension || 0) +
            (i.employerContributions?.nhis || 0) +
            (i.employerContributions?.itf || 0) +
            (i.employerContributions?.nsitf || 0),
        ),
        totalEmployees: items.length,
      };

      if (previousStatus !== "draft") {
        payroll.status = "draft";
        payroll.approvedBy = undefined;
        payroll.approvedAt = undefined;
      }

      await payroll.save();

      await Audit.log({
        company: companyId,
        user: userId,
        action: "payroll_item_corrected",
        module: "payroll",
        resourceType: "payroll",
        resourceId: payroll._id,
        details: {
          action: "employee_removed_after_delete",
          employeeId,
          previousStatus,
          month: payroll.payrollPeriod.month,
          year: payroll.payrollPeriod.year,
        },
        status: "success",
        severity: "medium",
      });
    }

    return payrolls.length;
  }

  /**
   * Get payroll by ID
   */
  async getPayrollById(payrollId, companyId) {
    const payroll = await Payroll.findOne({
      _id: payrollId,
      company: companyId,
    })
      .populate({
        path: "payrollItems.employee",
        select: "user employeeId position department bankDetails",
        populate: {
          path: "user",
          select: "firstName lastName email",
        },
      })

      .populate("approvedBy", "firstName lastName email")
      .populate("processedBy", "firstName lastName email")
      .populate("createdBy", "firstName lastName email")
      .populate("financingUsed", "requestedAmount status");

    if (!payroll) {
      throw new Error("Payroll not found");
    }

    return payroll;
  }

  /**
   * Get all payrolls for a company
   */
  async getCompanyPayrolls(companyId, filters = {}) {
    const query = {
      company: companyId,
    };

    if (filters.year) {
      query["payrollPeriod.year"] = parseInt(filters.year);
    }

    if (filters.month) {
      query["payrollPeriod.month"] = parseInt(filters.month);
    }

    if (filters.status) {
      query.status = filters.status;
    }

    const page = parseInt(filters.page) || 1;

    const limit = Math.min(parseInt(filters.limit) || 20, 100);

    const skip = (page - 1) * limit;

    const [payrolls, total] = await Promise.all([
      Payroll.find(query)
        .sort({
          "payrollPeriod.year": -1,
          "payrollPeriod.month": -1,
        })
        .select(
          "payrollPeriod summary status currency approvedAt processedAt createdBy",
        )
        .skip(skip)
        .limit(limit)
        .lean(),

      Payroll.countDocuments(query),
    ]);

    return {
      data: payrolls,

      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get employee payslip
   */
  async getEmployeePayslip(payrollId, employeeId, companyId) {
    const payroll = await Payroll.findOne({
      _id: payrollId,
      company: companyId,
    }).populate("company", "name email address logo");

    if (!payroll) {
      throw new Error("Payroll not found");
    }

    const payrollItem = payroll.payrollItems.find(
      (item) => item.employee.toString() === employeeId.toString(),
    );

    if (!payrollItem) {
      throw new Error("Employee not found in this payroll");
    }

    const employee = await Employee.findById(employeeId).populate(
      "user",
      "firstName lastName email",
    );

    if (!employee) {
      throw new Error("Employee not found");
    }

    return {
      company: payroll.company,

      currency: payroll.currency,

      employee: {
        name: `${employee.user.firstName} ${employee.user.lastName}`,

        employeeId: employee.employeeId,

        position: employee.position,

        department: employee.department,
      },

      payrollPeriod: payroll.payrollPeriod,

      payslip: payrollItem,

      generatedDate: new Date(),
    };
  }

  /**
   * Export payroll data
   */
  async exportPayroll(payrollId, companyId, userId) {
    const payroll = await Payroll.findOne({
      _id: payrollId,
      company: companyId,
    }).populate({
      path: "payrollItems.employee",
      populate: {
        path: "user",
        select: "firstName lastName",
      },
    });

    if (!payroll) {
      throw new Error("Payroll not found");
    }

    await Audit.log({
      company: companyId,
      user: userId,
      action: "payroll_exported",
      module: "payroll",
      resourceType: "payroll",
      resourceId: payrollId,
      status: "success",
      severity: "low",
    });

    return payroll.payrollItems.map((item) => ({
      employeeId: item.employee.employeeId,

      name: `${item.employee.user.firstName} ${item.employee.user.lastName}`,

      position: item.employee.position,

      department: item.employee.department,

      baseSalary: item.baseSalary,

      grossSalary: item.grossSalary,

      tax: item.deductions.tax,

      pension: item.deductions.pension,

      nhf: item.deductions.nhf,

      netSalary: item.netSalary,

      currency: payroll.currency,

      paymentStatus: item.paymentStatus,

      paymentReference: item.paymentReference,
    }));
  }

  /**
   * Get payroll statistics for dashboard
   */
  async getPayrollStats(companyId, year) {
    const payrolls = await Payroll.find({
      company: companyId,
      "payrollPeriod.year": year,
      status: "completed",
    }).lean();

    const stats = {
      totalPayrollRuns: payrolls.length,

      totalPaid: payrolls.reduce(
        (sum, payroll) => sum + payroll.summary.totalNet,
        0,
      ),

      totalEmployees:
        payrolls.length > 0 ? payrolls[0].summary.totalEmployees : 0,

      averageMonthlyPayroll: 0,

      monthlyBreakdown: [],
    };

    if (payrolls.length > 0) {
      stats.averageMonthlyPayroll = stats.totalPaid / payrolls.length;
    }

    for (let month = 1; month <= 12; month++) {
      const monthPayroll = payrolls.find(
        (payroll) => payroll.payrollPeriod.month === month,
      );

      stats.monthlyBreakdown.push({
        month,

        amount: monthPayroll ? monthPayroll.summary.totalNet : 0,

        status: monthPayroll ? monthPayroll.status : "not_run",
      });
    }

    return stats;
  }

  /**
   * Correct a payroll item
   */
  async correctPayrollItem(
    payrollId,
    companyId,
    employeeId,
    corrections,
    userId,
  ) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const payroll = await Payroll.findOne({
        _id: payrollId,
        company: companyId,
      }).session(session);

      if (!payroll) {
        throw new Error("Payroll not found");
      }

      if (!["draft", "calculated"].includes(payroll.status)) {
        throw new Error(
          "Corrections can only be made to payrolls in draft or calculated status",
        );
      }

      const itemIndex = payroll.payrollItems.findIndex(
        (item) => item.employee.toString() === employeeId.toString(),
      );

      if (itemIndex === -1) {
        throw new Error("Employee not found in this payroll");
      }

      const item = payroll.payrollItems[itemIndex];

      if (corrections.bonus !== undefined) {
        item.additions.bonus = corrections.bonus;
      }

      if (corrections.overtime !== undefined) {
        item.additions.overtime = corrections.overtime;
      }

      if (corrections.allowances !== undefined) {
        item.additions.allowances = corrections.allowances;
      }

      if (corrections.otherDeductions !== undefined) {
        item.deductions.otherDeductions = corrections.otherDeductions;
      }

      const totalAllowances = item.additions.allowances.reduce(
        (sum, allowance) => sum + (allowance.amount || 0),
        0,
      );

      // Tax applies to taxable earnings only; overtime is paid untaxed
      const taxableGross =
        item.baseSalary + item.additions.bonus + totalAllowances;
      const overtime = item.additions.overtime || 0;
      item.grossSalary = taxableGross + overtime;

      const recalculated = taxCalculationService.calculateEmployeePayroll({
        grossSalary: taxableGross,
        currency: payroll.currency,
        allowances: item.additions.allowances,
        bonuses: item.additions.bonus,
        otherDeductions: item.deductions.otherDeductions,
      });

      item.deductions.tax = recalculated.deductions.tax;
      item.deductions.pension = recalculated.deductions.pension;
      item.deductions.nhf = recalculated.deductions.nhf;
      item.employerContributions = recalculated.employerContributions;

      item.netSalary = Math.max(
        0,
        recalculated.netSalary +
          overtime -
          (item.deductions.loanRepayment || 0),
      );

      payroll.summary.totalGross = payroll.payrollItems.reduce(
        (sum, currentItem) => sum + currentItem.grossSalary,
        0,
      );

      payroll.summary.totalDeductions = payroll.payrollItems.reduce(
        (sum, currentItem) =>
          sum +
          currentItem.deductions.tax +
          currentItem.deductions.pension +
          currentItem.deductions.nhf +
          (currentItem.deductions.loanRepayment || 0),
        0,
      );

      payroll.summary.totalAdditions = payroll.payrollItems.reduce(
        (sum, currentItem) =>
          sum +
          currentItem.additions.bonus +
          currentItem.additions.overtime +
          currentItem.additions.allowances.reduce(
            (allowanceSum, allowance) => allowanceSum + (allowance.amount || 0),
            0,
          ),
        0,
      );

      payroll.summary.totalNet = payroll.payrollItems.reduce(
        (sum, currentItem) => sum + currentItem.netSalary,
        0,
      );

      payroll.summary.totalEmployerContributions = payroll.payrollItems.reduce(
        (sum, currentItem) =>
          sum +
          currentItem.employerContributions.pension +
          currentItem.employerContributions.nhis +
          currentItem.employerContributions.itf +
          currentItem.employerContributions.nsitf,
        0,
      );

      if (payroll.status === "calculated") {
        payroll.status = "draft";
      }

      await payroll.save({
        session,
      });

      await Audit.log(
        {
          company: companyId,
          user: userId,
          action: "payroll_item_corrected",
          module: "payroll",
          resourceType: "payroll",
          resourceId: payroll._id,

          details: {
            employeeId,
            corrections,
            month: payroll.payrollPeriod.month,
            year: payroll.payrollPeriod.year,
          },

          status: "success",
          severity: "medium",
        },
        session,
      );

      await session.commitTransaction();

      return payroll;
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      throw error;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Add compensation before calculation
   */
  async addPayrollCompensation(
    payrollId,
    companyId,
    compensationItems,
    userId,
  ) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const payroll = await Payroll.findOne({
        _id: payrollId,
        company: companyId,
      }).session(session);

      if (!payroll) {
        throw new Error("Payroll not found");
      }

      if (payroll.status !== "draft") {
        throw new Error(
          "Compensation can only be added to payrolls in draft status",
        );
      }

      const activeEmployeeIds = await Employee.find({
        company: companyId,
        isActive: true,
      })
        .select("_id")
        .session(session)
        .then((employees) =>
          employees.map((employee) => employee._id.toString()),
        );

      const errors = [];

      for (const item of compensationItems) {
        const { employeeId, bonus, overtime, allowances } = item;

        if (!activeEmployeeIds.includes(employeeId.toString())) {
          errors.push(`Employee ${employeeId} not found or not active`);
          continue;
        }

        const payrollItem = payroll.payrollItems.find(
          (currentItem) =>
            currentItem.employee.toString() === employeeId.toString(),
        );

        if (!payrollItem) {
          payroll.payrollItems.push({
            employee: employeeId,

            baseSalary: 0,

            grossSalary: 0,

            netSalary: 0,

            additions: {
              bonus: bonus || 0,
              allowances: allowances || [],
              overtime: overtime || 0,
            },

            paymentStatus: "pending",
          });
        } else {
          if (bonus !== undefined) {
            payrollItem.additions.bonus = bonus;
          }

          if (overtime !== undefined) {
            payrollItem.additions.overtime = overtime;
          }

          if (allowances !== undefined) {
            payrollItem.additions.allowances = allowances;
          }
        }
      }

      if (errors.length > 0) {
        await session.abortTransaction();

        return {
          success: false,
          errors,
        };
      }

      await payroll.save({
        session,
      });

      await Audit.log(
        {
          company: companyId,
          user: userId,
          action: "payroll_compensation_added",
          module: "payroll",
          resourceType: "payroll",
          resourceId: payroll._id,

          details: {
            month: payroll.payrollPeriod.month,
            year: payroll.payrollPeriod.year,
            employeesUpdated: compensationItems.length,
          },

          status: "success",
          severity: "medium",
        },
        session,
      );

      await session.commitTransaction();

      return {
        success: true,
        payroll,
      };
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      throw error;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Mark a specific payroll item as paid
   */
  async markPayrollItemPaid(
    payrollId,
    companyId,
    employeeId,
    paymentReference,
  ) {
    const payroll = await Payroll.findOne({
      _id: payrollId,
      company: companyId,
    });

    if (!payroll) {
      throw new Error("Payroll not found");
    }

    const item = payroll.payrollItems.find(
      (currentItem) =>
        currentItem.employee.toString() === employeeId.toString(),
    );

    if (!item) {
      throw new Error("Payroll item not found");
    }

    // A repeated webhook must not rewrite the payment record
    if (item.paymentStatus !== "paid") {
      item.paymentStatus = "paid";
      item.paymentDate = new Date();
      item.paymentReference = paymentReference;
      await payroll.save();
    }

    await this.applyLoanRepayment(item, payrollId, companyId, paymentReference);

    return payroll;
  }

  async applyLoanRepayment(item, payrollId, companyId, paymentReference) {
    const repayment = item.deductions?.loanRepayment || 0;
    const loanId = item.deductions?.loan;
    if (repayment <= 0 || !loanId) return;

    await EmployeeLoan.findOneAndUpdate(
      {
        _id: loanId,
        company: companyId,
        "repayments.payroll": { $ne: payrollId },
      },
      {
        $inc: { amountRepaid: repayment, outstandingBalance: -repayment },
        $push: {
          repayments: {
            payroll: payrollId,
            amount: repayment,
            paymentReference,
          },
        },
      },
    );

    // Close the loan once it's fully repaid
    await EmployeeLoan.updateOne(
      {
        _id: loanId,
        company: companyId,
        status: "active",
        outstandingBalance: { $lte: 0.01 },
      },
      { status: "completed" },
    );
  }

  async retryFailedPayments(
    payrollId,
    companyId,
    userId,
    preferredGateway = null,
  ) {
    const payroll = await Payroll.findOne({
      _id: payrollId,
      company: companyId,
    }).populate({
      path: "payrollItems.employee",
      select: "bankDetails salary user",
      populate: {
        path: "user",
        select: "firstName lastName email",
      },
    });

    if (!payroll) {
      throw new Error("Payroll not found");
    }

    if (!["failed", "processing"].includes(payroll.status)) {
      throw new Error(
        "Retry is only allowed for failed or processing payrolls.",
      );
    }

    let failedTransactions = await PaymentTransaction.find({
      payroll: payrollId,
      company: companyId,
      status: "failed",
    });

    // Never retry an employee who was already paid in this payroll
    const paid = await PaymentTransaction.find({
      payroll: payrollId,
      company: companyId,
      status: "success",
    })
      .select("employee")
      .lean();
    const paidIds = new Set(paid.map((t) => t.employee.toString()));
    failedTransactions = failedTransactions.filter(
      (t) => !paidIds.has(t.employee.toString()),
    );

    if (failedTransactions.length === 0) {
      throw new Error("No failed transactions found for this payroll.");
    }

    /**
     * Do not retry while another transaction is
     * still actively processing.
     */
    const activeTransactions = await PaymentTransaction.find({
      payroll: payrollId,
      company: companyId,
      status: {
        $in: ["pending", "processing"],
      },
    });

    if (activeTransactions.length > 0) {
      throw new Error(
        "Some payments are still pending or processing. Wait until they finish before retrying failed payments.",
      );
    }

    payroll.status = "processing";

    for (const transaction of failedTransactions) {
      const item = payroll.payrollItems.find(
        (currentItem) =>
          currentItem.employee.toString() === transaction.employee.toString(),
      );

      if (item) {
        item.paymentStatus = "processing";
      }
    }

    await payroll.save();

    await Audit.log({
      company: companyId,
      user: userId,
      action: "payroll_processed",
      module: "payroll",
      resourceType: "payroll",
      resourceId: payroll._id,

      details: {
        action: "payment_retry",
        month: payroll.payrollPeriod.month,
        year: payroll.payrollPeriod.year,
        failedCount: failedTransactions.length,
      },

      status: "success",
      severity: "high",
    });

    let retriedCount = 0;

    for (const transaction of failedTransactions) {
      try {
        /**
         * Generate a fresh reference because gateways
         * can reject reused transfer references.
         */
        const newReference =
          `PAY-${payrollId.toString().slice(-8)}-` +
          `${transaction.employee.toString().slice(-8)}-` +
          `${Date.now().toString(36)}`;

        transaction.status = "pending";
        transaction.attemptCount = 0;

        transaction.failureReason = null;
        transaction.failureNotifiedAt = null;
        transaction.gatewayMessage = null;
        transaction.gatewayTransferId = null;

        transaction.paymentReference = newReference;

        /**
         * Preserve selected gateway or let worker
         * use automatic priority.
         */
        if (
          preferredGateway === "flutterwave" ||
          preferredGateway === "monnify"
        ) {
          transaction.gateway = preferredGateway;
        }

        /**
         * Save the reset (pending) state BEFORE dispatching so the
         * payment processor always sees the up-to-date transaction.
         */
        await transaction.save();

        const jobId = await dispatchPayment(
          transaction,
          preferredGateway,
          `payment-${transaction._id}-retry-${Date.now()}`,
        );

        if (jobId) {
          transaction.queueJobId = jobId;

          await transaction.save();
        }

        retriedCount++;
      } catch (error) {
        console.error(
          `Failed to retry transaction ${transaction._id}:`,
          error.message,
        );

        transaction.status = "failed";
        transaction.failureReason = error.message;

        await transaction.save();

        const item = payroll.payrollItems.find(
          (currentItem) =>
            currentItem.employee.toString() === transaction.employee.toString(),
        );

        if (item) {
          item.paymentStatus = "failed";
        }
      }
    }

    await payroll.save();

    return {
      payroll,
      retriedCount,

      message: `${retriedCount} failed payment(s) queued for retry.`,
    };
  }

  /**
   * Cancel pending payroll payments
   *
   * Successful payments are never reversed.
   * Processing payments cannot be safely cancelled.
   */
  async cancelPayroll(payrollId, companyId, userId) {
    const payroll = await Payroll.findOne({
      _id: payrollId,
      company: companyId,
    });

    if (!payroll) {
      throw new Error("Payroll not found");
    }

    if (payroll.status !== "processing") {
      throw new Error(
        `Payroll cannot be cancelled while its status is "${payroll.status}".`,
      );
    }

    const { paymentQueue } = await import("../config/paymentQueue.js");

    const transactions = await PaymentTransaction.find({
      payroll: payrollId,
      company: companyId,
    });

    if (!transactions.length) {
      throw new Error("No payment transactions found for this payroll");
    }

    const successfulTransactions = transactions.filter(
      (transaction) => transaction.status === "success",
    );

    if (successfulTransactions.length > 0) {
      throw new Error(
        `Cannot cancel this payroll because ${successfulTransactions.length} payment(s) have already been completed successfully.`,
      );
    }

    const processingTransactions = transactions.filter(
      (transaction) => transaction.status === "processing",
    );

    if (processingTransactions.length > 0) {
      throw new Error(
        `Cannot cancel payroll because ${processingTransactions.length} payment(s) are currently being processed. Wait for them to complete or fail.`,
      );
    }

    const pendingTransactions = transactions.filter(
      (transaction) => transaction.status === "pending",
    );

    if (!pendingTransactions.length) {
      throw new Error("There are no pending payments to cancel.");
    }

    /**
     * STEP 1:
     * Make sure every pending queue job can safely
     * be removed BEFORE changing anything.
     */
    for (const transaction of pendingTransactions) {
      if (!paymentQueue || !transaction.queueJobId) {
        continue;
      }

      const job = await paymentQueue.getJob(transaction.queueJobId);

      if (!job) {
        continue;
      }

      const state = await job.getState();

      console.log(
        `Payment ${transaction.paymentReference} queue state: ${state}`,
      );

      if (state === "active") {
        throw new Error(
          `Payment for employee ${transaction.employee} has already started processing. No payments were cancelled.`,
        );
      }

      if (!["waiting", "delayed", "prioritized"].includes(state)) {
        throw new Error(
          `Payment ${transaction.paymentReference} cannot be safely cancelled because its queue state is "${state}". No payments were cancelled.`,
        );
      }
    }

    /**
     * STEP 2:
     * Remove queue jobs.
     */
    for (const transaction of pendingTransactions) {
      if (!paymentQueue || !transaction.queueJobId) {
        continue;
      }

      const job = await paymentQueue.getJob(transaction.queueJobId);

      if (job) {
        await job.remove();

        console.log(`Removed payment job ${transaction.queueJobId}`);
      }
    }

    /**
     * STEP 3:
     * Cancel transactions.
     */
    let cancelledCount = 0;

    for (const transaction of pendingTransactions) {
      transaction.status = "cancelled";

      transaction.gatewayMessage = "Payment cancelled by payroll administrator";

      transaction.failureReason = "Payroll payment cancelled before processing";

      await transaction.save();

      const payrollItem = payroll.payrollItems.find(
        (item) => item.employee.toString() === transaction.employee.toString(),
      );

      if (payrollItem) {
        payrollItem.paymentStatus = "cancelled";
      }

      cancelledCount++;
    }

    /**
     * STEP 4:
     * Return payroll to draft.
     */
    payroll.status = "draft";

    await payroll.save();

    /**
     * STEP 5:
     * Audit.
     */
    await Audit.log({
      company: companyId,
      user: userId,
      action: "payroll_processed",
      module: "payroll",
      resourceType: "payroll",
      resourceId: payroll._id,

      details: {
        action: "payment_cancelled",
        month: payroll.payrollPeriod.month,
        year: payroll.payrollPeriod.year,
        cancelledPayments: cancelledCount,
        totalTransactions: transactions.length,
      },

      status: "success",
      severity: "high",
    });

    return {
      payroll,

      cancelledCount,

      message: `${cancelledCount} payroll payment(s) cancelled successfully. Payroll has been returned to draft.`,
    };
  }

  /**
   * Reset a stuck payroll back to draft.
   */
  async resetPayroll(payrollId, companyId, userId) {
    const payroll = await Payroll.findOne({
      _id: payrollId,
      company: companyId,
    });

    if (!payroll) {
      throw new Error("Payroll not found");
    }

    if (
      !["processing", "approved", "calculated", "failed"].includes(
        payroll.status,
      )
    ) {
      throw new Error(
        `Payroll cannot be reset while its status is "${payroll.status}".`,
      );
    }

    const previousStatus = payroll.status;

    const transactions = await PaymentTransaction.find({
      payroll: payrollId,
      company: companyId,
    });

    // Never reset a payroll if money has already been successfully paid.
    const successfulTransactions = transactions.filter(
      (transaction) => transaction.status === "success",
    );

    if (successfulTransactions.length > 0) {
      throw new Error(
        `Cannot reset this payroll because ${successfulTransactions.length} payment(s) have already been completed successfully.`,
      );
    }

    // Never reset while a gateway payment is actively processing.
    const processingTransactions = transactions.filter(
      (transaction) => transaction.status === "processing",
    );

    if (processingTransactions.length > 0) {
      throw new Error(
        `Cannot reset this payroll because ${processingTransactions.length} payment(s) are currently being processed.`,
      );
    }

    const { paymentQueue } = await import("../config/paymentQueue.js");

    const resettableTransactions = transactions.filter((transaction) =>
      ["pending", "failed", "cancelled"].includes(transaction.status),
    );

    for (const transaction of resettableTransactions) {
      // Remove queued payment jobs that have not started yet.
      if (
        paymentQueue &&
        transaction.status === "pending" &&
        transaction.queueJobId
      ) {
        const job = await paymentQueue.getJob(transaction.queueJobId);

        if (job) {
          const state = await job.getState();

          if (["waiting", "delayed", "prioritized"].includes(state)) {
            await job.remove();

            console.log(
              `Removed payment job ${transaction.queueJobId} during payroll reset`,
            );
          } else if (state === "active") {
            throw new Error(
              `Payment ${transaction.paymentReference} has already started processing. Reset stopped.`,
            );
          }
        }
      }

      // Keep the transaction as cancelled instead of deleting it.
      // This preserves the payment history for the audit trail.
      if (transaction.status !== "cancelled") {
        transaction.status = "cancelled";

        transaction.gatewayMessage =
          "Payment transaction cancelled during payroll reset";

        transaction.failureReason = "Payroll reset before successful payment";

        await transaction.save();
      }
    }

    // Reset payroll item payment states.
    payroll.payrollItems.forEach((item) => {
      item.paymentStatus = "pending";
      item.paymentDate = undefined;
      item.paymentReference = undefined;
    });

    // Return payroll to the beginning of the workflow.
    payroll.status = "draft";

    payroll.approvedBy = undefined;
    payroll.approvedAt = undefined;

    payroll.processedBy = undefined;
    payroll.processedAt = undefined;

    await payroll.save();

    // Record the reset without deleting the previous payment history.
    await Audit.log({
      company: companyId,
      user: userId,
      action: "payroll_processed",
      module: "payroll",
      resourceType: "payroll",
      resourceId: payroll._id,

      details: {
        action: "payroll_reset",
        month: payroll.payrollPeriod.month,
        year: payroll.payrollPeriod.year,
        previousStatus,
        transactionsFound: transactions.length,
        resetTransactions: resettableTransactions.length,
      },

      status: "success",
      severity: "high",
    });

    return {
      payroll,
      message:
        "Payroll has been reset to draft. You can now recalculate and process it again.",
    };
  }
}

export default new PayrollService();
