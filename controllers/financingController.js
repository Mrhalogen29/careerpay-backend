import Financing from "../models/financingModel.js";
import Company from "../models/companyModel.js";
import Employee from "../models/employeeModel.js";
import Audit from "../models/auditModel.js";

function checkEligibility(company, activeEmployeeCount) {
  const checks = [
    {
      passed: (company.monthsActive || 0) >= 3,
      reason: "Company must be active on CareerPay for at least 3 months",
    },
    {
      passed: activeEmployeeCount >= 3,
      reason: "Company must have at least 3 active employees",
    },
    {
      passed: (company.payrollRunsLast3Months || 0) >= 2,
      reason: "Company must have run payroll at least 2 times in the last 3 months",
    },
    {
      passed: !company.hasOutstandingDefault,
      reason: "Company has an outstanding loan default that must be cleared first",
    },
    {
      passed: company.kycComplete === true,
      reason: "KYC must be complete (CAC certificate, director IDs, 6-month bank statements)",
    },
  ];

  const failed = checks.filter((c) => !c.passed);
  return {
    passed: failed.length === 0,
    reasons: failed.map((c) => c.reason),
  };
}

function calculateRiskMultiplier(company) {
  const months = company.monthsActive || 0;
  let base;
  if (months < 6) base = 0.5;
  else if (months < 12) base = 0.7;
  else if (months < 24) base = 0.85;
  else base = 1.0;

  const latePayments = company.latePaymentsCount || 0;
  const paymentBonus = latePayments === 0 ? 0.15 : latePayments === 1 ? 0.05 : 0;

  const stage = company.fundingStage || "bootstrapped";
  const fundingBonus = stage === "seed+" ? 0.1 : stage === "pre-seed" ? 0.05 : 0;

  return Math.min(base + paymentBonus + fundingBonus, 1.0);
}

function calculateCreditLimit(monthlyPayrollCost, riskMultiplier) {
  const HARD_CAP = 5000000;
  const base = Math.min(monthlyPayrollCost * 3, HARD_CAP);
  return Math.round(base * riskMultiplier);
}

function calculateCreditScore(riskMultiplier, company) {
  const riskScore = ((riskMultiplier - 0.5) / 0.5) * 50;
  const eligScore = 30;
  const kycScore = company.kycComplete ? 20 : 0;
  const score = Math.round(riskScore + eligScore + kycScore);

  let decision;
  if (score >= 70) decision = "approved";
  else if (score >= 50) decision = "under_review";
  else decision = "rejected";

  return { score, decision };
}

function calculateServiceCharge(loanAmount) {
  const serviceCharge = Math.round(loanAmount * 0.15);
  const disbursedToWallet = loanAmount - serviceCharge;
  return { serviceCharge, disbursedToWallet };
}

function getRepaymentDates(termDays, disbursementDate = new Date()) {
  const graceDaysMap = { 30: 7, 60: 10, 90: 15 };
  const graceDays = graceDaysMap[termDays] || 7;

  const dueDate = new Date(disbursementDate);
  dueDate.setDate(dueDate.getDate() + termDays);

  const graceCutoff = new Date(dueDate);
  graceCutoff.setDate(graceCutoff.getDate() + graceDays);

  return { dueDate, graceCutoff };
}

function generateRepaymentSchedule(
  approvedAmount,
  totalRepaymentAmount,
  repaymentTermDays,
  repaymentFrequency
) {
  const schedule = [];

  // Convert days to equivalent months for payment interval calculation
  // 30 days = 1 month, 60 days = 2 months, 90 days = 3 months
  const monthsEquivalent = repaymentTermDays / 30;

  // Determine number of payments
  let numberOfPayments;

  if (repaymentFrequency === "weekly") {
    numberOfPayments = monthsEquivalent * 4;
  } else if (repaymentFrequency === "bi-weekly") {
    numberOfPayments = monthsEquivalent * 2;
  } else {
    numberOfPayments = monthsEquivalent; // default
  }

  const installmentAmount = totalRepaymentAmount / numberOfPayments;

  for (let i = 1; i <= numberOfPayments; i++) {
    schedule.push({
      installmentNumber: i,
      amount: Math.round(installmentAmount),
      status: "pending",
    });
  }

  return schedule;
}


class FinancingController {
  /**
   * Apply for payroll financing
   * POST /api/financing/apply
   */
  async applyForFinancing(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;
      const {
        requestedAmount,
        currency,
        purpose,
        repaymentFrequency,
        companyDetails,
      } = req.body;

      // Parsed separately — must be a number for the includes() check to work
      const repaymentTermDays = parseInt(req.body.repaymentTermDays);

      // Validate required fields
      if (!requestedAmount || !repaymentTermDays) {
        return res.status(400).json({
          success: false,
          message: "Requested amount and repayment term are required",
        });
      }

       if (![30, 60, 90].includes(repaymentTermDays)) {
        return res.status(400).json({
          success: false,
          message: "Repayment term must be 30, 60, or 90 days",
        });
      }

      if (requestedAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Requested amount must be greater than 0",
        });
      }

      // Get company and employee data for application
      const [company, employeeCount] = await Promise.all([
        Company.findById(companyId),
        Employee.countDocuments({ company: companyId, isActive: true }),
      ]);
      if (!company) {
        return res.status(404).json({
          success: false,
          message: "Company not found",
        });
      }

            // Check eligibility
      const eligibility = checkEligibility(company, employeeCount);
      if (!eligibility.passed) {
        return res.status(400).json({
          success: false,
          message: "Your company does not meet the eligibility criteria for credit financing",
          reasons: eligibility.reasons,
        });
      }

      // Calculate risk multiplier and credit limit
      const riskMultiplier = calculateRiskMultiplier(company);
      const monthlyPayrollCost = companyDetails?.monthlyPayrollCost || company.monthlyPayrollCost || 0;
      const maxCreditLimit = calculateCreditLimit(monthlyPayrollCost, riskMultiplier);

      if (requestedAmount > maxCreditLimit) {
        return res.status(400).json({
          success: false,
          message: `Requested amount exceeds your credit limit of ₦${maxCreditLimit.toLocaleString()}`,
          maxCreditLimit,
        });
      }

      // Calculate credit score and decision
      const { score, decision } = calculateCreditScore(riskMultiplier, company);

      if (decision === "rejected") {
        return res.status(400).json({
          success: false,
          message: "Credit application rejected based on risk assessment",
          creditScore: score,
        });
      }

      // Create financing application
      const financing = await Financing.create({
        company: companyId,
        requestedAmount,
        currency: currency || company.baseCurrency || "NGN",
        purpose: purpose || "payroll",
        repaymentTermDays,
        repaymentFrequency: repaymentFrequency || "monthly",
        status: decision, //approved or under review
        creditScore: score,
        riskMultiplier,
        maxCreditLimit,

        // Pre-fill approval fields if auto-approved
        ...(decision === "approved" && {
          approvedAmount: requestedAmount,
          interestRate: 0,
          totalRepaymentAmount: requestedAmount,
          outstandingBalance: requestedAmount,
        }),
        companyDetails: {
          ...companyDetails,
          employeeCount,
          monthlyPayrollCost
        }
      });

      // Log audit
      await Audit.log({
        company: companyId,
        user: userId,
        action: "financing_applied",
        module: "financing",
        resourceType: "financing",
        resourceId: financing._id,
        details: {
          requestedAmount,
          currency: financing.currency,
          repaymentTermDays,
          creditScore: score,
          decision
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        status: "success",
        severity: "high",
      });

      res.status(201).json({
        success: true,
        message:
          decision === "approved"
            ? "Application auto-approved! Proceed to disbursement."
            : "Application submitted and is pending manual review.",
        data: { financing, creditScore: score, maxCreditLimit },
      });
    } catch (error) {
      console.error("Apply for financing error:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to submit financing application",
      });
    }
  }

  /**
   * Get all financing applications for company
   * GET /api/financing
   */
  async getCompanyFinancing(req, res) {
    try {
      const companyId = req.user.company;
      const { status } = req.query;

      const query = { company: companyId };
      if (status) query.status = status;

      // Pagination — consistent with other modules (max 100 per page)
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const skip = (page - 1) * limit;

      const [financings, total] = await Promise.all([
        Financing.find(query)
          .sort({ applicationDate: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Financing.countDocuments(query),
      ]);

      res.status(200).json({
        success: true,
        data: financings,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        }
      });
    } catch (error) {
      console.error("Get company financing error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch financing applications",
      });
    }
  }

  /**
   * Get financing by ID
   * GET /api/financing/:id
   */
  async getFinancingById(req, res) {
    try {
      const companyId = req.user.company;
      const { id } = req.params;

      const financing = await Financing.findOne({
        _id: id,
        company: companyId,
      })
        .populate("reviewedBy", "firstName lastName email")
        .lean();

      if (!financing) {
        return res.status(404).json({
          success: false,
          message: "Financing application not found",
        });
      }

      res.status(200).json({
        success: true,
        data: financing,
      });
    } catch (error) {
      console.error("Get financing error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch financing application",
      });
    }
  }

  /**
   * Review financing application (Admin/Financial Partner)
   * PUT /api/financing/:id/review
   */
  async reviewFinancing(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;
      const { id } = req.params;
      const {
        status,
        approvedAmount,
        interestRate,
        reviewNotes,
        rejectionReason,
      } = req.body;

      // Only admin/founder can review
      if (req.user.role !== "founder" && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Only founders and admins can review financing applications",
        });
      }

      const financing = await Financing.findOne({
        _id: id,
        company: companyId,
      });

      if (!financing) {
        return res.status(404).json({
          success: false,
          message: "Financing application not found",
        });
      }

      if (
        financing.status !== "pending" &&
        financing.status !== "under_review"
      ) {
        return res.status(400).json({
          success: false,
          message: "Financing application has already been reviewed",
        });
      }

      // Update financing
      financing.status = status;
      financing.reviewedBy = userId;
      financing.reviewedAt = new Date();
      financing.reviewNotes = reviewNotes;

      if (status === "approved") {
        const principal = approvedAmount || financing.requestedAmount;

        // Check approved amount doesn't exceed the credit limit calculated at application time
        if (financing.maxCreditLimit && principal > financing.maxCreditLimit) {
          return res.status(400).json({
            success: false,
            message: `Approved amount exceeds this company's credit limit of ₦${financing.maxCreditLimit.toLocaleString()}`,
          });
        }
        financing.approvedAmount = principal;
        financing.interestRate = interestRate || 0;

        // Calculate total repayment
        const interest = (principal * financing.interestRate) / 100;
        financing.totalRepaymentAmount = principal + interest;
        financing.outstandingBalance = financing.totalRepaymentAmount;

        // Generate repayment schedule
        financing.repaymentSchedule = generateRepaymentSchedule(
          financing.approvedAmount,
          financing.totalRepaymentAmount,
          financing.repaymentTermDays,
          financing.repaymentFrequency
        );
      } else if (status === "rejected") {
        financing.rejectionReason = rejectionReason;
      } else if (status === "defaulted") {
        // ADDED: set hasOutstandingDefault on company when loan is manually marked defaulted
        // This blocks the company from applying for new financing — BRD eligibility check 4
        await Company.findByIdAndUpdate(financing.company, {
          hasOutstandingDefault: true,
        });
      }

      await financing.save();

      // Log audit
      await Audit.log({
        company: companyId,
        user: userId,
        action:
          status === "approved" ? "financing_approved" :
          status === "defaulted" ? "financing_defaulted" :
          "financing_rejected",
        module: "financing",
        resourceType: "financing",
        resourceId: financing._id,
        details: {
          requestedAmount: financing.requestedAmount,
          approvedAmount: financing.approvedAmount,
          status,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        status: "success",
        severity: "high",
      });

      res.status(200).json({
        success: true,
        message: `Financing application ${status}`,
        data: financing,
      });
    } catch (error) {
      console.error("Review financing error:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to review financing application",
      });
    }
  }

  /**
   * Disburse financing (Mark as disbursed)
   * POST /api/financing/:id/disburse
   */
  async disburseFinancing(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;
      const { id } = req.params;
      const { disbursementReference } = req.body;

      const financing = await Financing.findOne({
        _id: id,
        company: companyId,
      });

      if (!financing) {
        return res.status(404).json({
          success: false,
          message: "Financing application not found",
        });
      }

      if (financing.status !== "approved") {
        return res.status(400).json({
          success: false,
          message: "Only approved financing can be disbursed",
        });
      }

       // Calculate 15% service charge — deducted upfront from disbursement
      // Borrower repays full principal, wallet only receives the net amount
      const { serviceCharge, disbursedToWallet } = calculateServiceCharge(
        financing.approvedAmount
      );

      // Set due date and grace cutoff based on the loan term
      const { dueDate, graceCutoff } = getRepaymentDates(
        financing.repaymentTermDays,
        new Date()
      );

      financing.status = "active";
      financing.disbursementDate = new Date();
      financing.disbursementReference = disbursementReference || `DISB-${Date.now()}`;
      financing.serviceCharge = serviceCharge;
      financing.disbursedToWallet = disbursedToWallet;
      financing.dueDate = dueDate;
      financing.graceCutoff = graceCutoff;

      await financing.save();

      // Log audit
      await Audit.log({
        company: companyId,
        user: userId,
        action: "financing_disbursed",
        module: "financing",
        resourceType: "financing",
        resourceId: financing._id,
        details: {
          approvedAmount: financing.approvedAmount,
          serviceCharge,
          disbursedToWallet,
          dueDate,
          reference: financing.disbursementReference,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        status: "success",
        severity: "high",
      });

      res.status(200).json({
        success: true,
        message: "Financing disbursed successfully",
        data: financing,
      });
    } catch (error) {
      console.error("Disburse financing error:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to disburse financing",
      });
    }
  }

  /**
   * Make repayment
   * POST /api/financing/:id/repayment
   */
  async makeRepayment(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;
      const { id } = req.params;
      const { amount, paymentReference } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Valid payment amount is required",
        });
      }

      const financing = await Financing.findOne({
        _id: id,
        company: companyId,
      });

      if (!financing) {
        return res.status(404).json({
          success: false,
          message: "Financing not found",
        });
      }

      if (financing.status !== "active") {
        return res.status(400).json({
          success: false,
          message: "Financing is not active",
        });
      }

      if (amount > financing.outstandingBalance) {
        return res.status(400).json({
          success: false,
          message: "Payment amount exceeds outstanding balance",
        });
      }

      // Update repayment
      financing.amountRepaid += amount;


      // Mark schedule items as paid
      let remainingAmount = amount;
      for (const schedule of financing.repaymentSchedule) {
        if (!schedule.isPaid && remainingAmount > 0) {
          if (remainingAmount >= schedule.amount) {
            schedule.isPaid = true;
            schedule.paidDate = new Date();
            schedule.paidAmount = schedule.amount;
            schedule.paymentReference = paymentReference || `PAY-${Date.now()}`;
            remainingAmount -= schedule.amount;
          } else {
            // Partial payment
            schedule.paidAmount = (schedule.paidAmount || 0) + remainingAmount;
            remainingAmount = 0;
          }
        }
      }

      // Check if fully paid
      if (financing.amountRepaid >= financing.totalRepaymentAmount) {
        financing.status = "completed";

        await Company.findByIdAndUpdate(companyId, {
          hasOutstandingDefault: false,
        });
      }
      

      await financing.save();

      // Log audit
      await Audit.log({
        company: companyId,
        user: userId,
        action: "repayment_made",
        module: "financing",
        resourceType: "financing",
        resourceId: financing._id,
        details: {
          amount,
          outstandingBalance: financing.outstandingBalance,
          reference: paymentReference,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        status: "success",
        severity: "medium",
      });

      res.status(200).json({
        success: true,
        message: "Repayment processed successfully",
        data: financing,
      });
    } catch (error) {
      console.error("Make repayment error:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to process repayment",
      });
    }
  }

  /**
   * Get financing statistics
   * GET /api/financing/stats
   */
  async getFinancingStats(req, res) {
    try {
      const companyId = req.user.company;

      const [
        totalApplications,
        activeFinancing,
        completedFinancing,
        totalBorrowed,
        totalRepaid,
        outstandingBalance,
      ] = await Promise.all([
        Financing.countDocuments({ company: companyId }),
        Financing.countDocuments({ company: companyId, status: "active" }),
        Financing.countDocuments({ company: companyId, status: "completed" }),

        Financing.aggregate([
          {
            $match: {
              company: companyId,
              status: { $in: ["active", "completed"] },
            },
          },
          { $group: { _id: null, total: { $sum: "$approvedAmount" } } },
        ]).then((result) => result[0]?.total || 0),

        Financing.aggregate([
          { $match: { company: companyId } },
          { $group: { _id: null, total: { $sum: "$amountRepaid" } } },
        ]).then((result) => result[0]?.total || 0),

        Financing.aggregate([
          { $match: { company: companyId, status: "active" } },
          { $group: { _id: null, total: { $sum: "$outstandingBalance" } } },
        ]).then((result) => result[0]?.total || 0),
      ]);

      res.status(200).json({
        success: true,
        data: {
          totalApplications,
          activeLoans: activeFinancing,
          completedLoans: completedFinancing,
          totalBorrowed,
          totalRepaid,
          outstandingBalance,
        },
      });
    } catch (error) {
      console.error("Get financing stats error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch financing statistics",
      });
    }
  }


}

export default new FinancingController();
