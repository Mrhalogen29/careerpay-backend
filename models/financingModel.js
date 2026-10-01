import mongoose from "mongoose";

const repaymentScheduleSchema = new mongoose.Schema({

  amount: {
    type: Number,
    required: true,
    min: 0,
  },

  principal: {
    type: Number,
    required: true,
  },

  interest: {
    type: Number,
    required: true,
  },

  isPaid: {
    type: Boolean,
    default: false,
  },

  paidDate: Date,
  paidAmount: Number,
  paymentReference: String,
});

const financingSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },

    applicationDate: {
      type: Date,
      default: Date.now,
    },

    requestedAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    creditScore: {
      type: Number,
      min: 0,
      max: 100
    },
    riskMultiplier: {
      type: Number,
      min: 0.5, 
      max: 1.0
    },
    maxCreditLimit: {
      type: Number
    },

    currency: {
      type: String,
      enum: ["NGN", "USD"],
      default: "NGN",
    },

    purpose: {
      type: String,
      enum: ["payroll", "operations", "growth", "other"],
      default: "payroll",
    },
    repaymentTermDays: {
      type: Number,
      enum: [30, 60, 90]
    },
    repaymentFrequency: {
      type: String,
      enum:[ 'weekly', 'bi-weekly', 'monthly'],
      default: 'monthly'
    },

    status: {
      type: String,
      enum: [
        "pending",
        "under_review",
        "approved",
        "rejected",
        "disbursed",
        "active",
        "completed",
        "defaulted",
      ],
      default: "pending",
    },
    approvedAmount: Number,
    interestRate: {
      type: Number,
      min: 0,
      max: 24,
      default: 0
    },
    serviceCharge: Number, 
    disbursedToWallet: Number, 
    disbursementDate: Date,
    disbursementReference: String,

    dueDate: Date,   
    graceCutoff: Date,   
    totalRepaymentAmount: Number,
    amountRepaid: {
      type: Number,
      default: 0,
    },

    outstandingBalance: Number,
    repaymentSchedule: [repaymentScheduleSchema],
    financialPartner: {
      name: String,
      partnerId: String,
      contactEmail: String,
    },

    companyDetails: {
      monthlyRevenue: Number,
      employeeCount: Number,
      monthlyPayrollCost: Number,
      yearsInBusiness: Number,
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    reviewedAt: Date,
    reviewNotes: String,
    rejectionReason: String,
    documents: [
      {
        name: String,
        type: String,
        url: String,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  { timestamps: true }
);

// Calculating oustanding balance
financingSchema.pre("save", function (next) {
  if (this.approvedAmount != null && this.amountRepaid != null) {
    const interest = this.interestRate
      ? (this.approvedAmount * this.interestRate) / 100 : 0;
    this.outstandingBalance = Math.max( 0,this.approvedAmount + interest - this.amountRepaid
       );
  }
  next();
});

export default mongoose.model("Financing", financingSchema);
