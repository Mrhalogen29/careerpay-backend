import mongoose from "mongoose";

const payrollItemSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee",
    required: true,
  },

  // snapshot of base salary at time of payroll — BRD 3.4
  baseSalary: {
    type: Number,
    required: true,
    min: 0,
  },

  grossSalary: {
    type: Number,
    required: true,
    min: 0,
  },

  deductions: {
    tax: { type: Number, default: 0 },
    pension: { type: Number, default: 0 },
    nhf: { type: Number, default: 0 },
    otherDeductions: [
      {
        name: String,
        amount: Number,
        description: String,
      },
    ],
  },

  additions: {
    bonus: { type: Number, default: 0 },
    allowances: [
      {
        name: String,
        amount: Number,
        description: String,
      },
    ],
    overtime: { type: Number, default: 0 },
  },
  employerContributions: {
    pension: { type: Number, default: 0 },
    nhis: { type: Number, default: 0 },
    itf: { type: Number, default: 0 },
    nsitf: { type: Number, default: 0 },
  },
  netSalary: {
    type: Number,
    required: true,
  },

  paymentStatus: {
    type: String,
    enum: ["pending", "processing", "paid", "failed", "cancelled"],
    default: "pending",
  },
  paymentDate: Date,
  paymentReference: String,
  prorationDetails: {
    isProrated: { type: Boolean, default: false },
    daysWorked: { type: Number },
    daysInMonth: { type: Number },
    note: { type: String },
  },
});

const payrollSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },

    currency: {
      type: String,
      enum: ["NGN", "USD"],
      default: "NGN",
    },

    payrollPeriod: {
      month: {
        type: Number,
        required: true,
        min: 1,
        max: 12,
      },
      year: {
        type: Number,
        required: true,
      },
      periodNumber: {
        type: Number,
        required: true,
        default: 1,
        // Monthly: always 1
        // Bi-weekly: 1 or 2
        // Weekly: 1, 2, 3, or 4
      },
    },

    payrollItems: [payrollItemSchema],
    summary: {
      totalGross: { type: Number, default: 0 },
      totalDeductions: { type: Number, default: 0 },
      totalAdditions: { type: Number, default: 0 },
      totalNet: { type: Number, default: 0 },
      totalEmployerContributions: { type: Number, default: 0 },
      totalEmployees: { type: Number, default: 0 },
    },

    status: {
      type: String,
      enum: [
        "draft",
        "calculated",
        "approved",
        "processing",
        "completed",
        "failed",
      ],
      default: "draft",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    approvedAt: Date,

    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    processedAt: Date,

    financingUsed: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Financing",
    },
    isOffCycle: {
      type: Boolean,
      default: false,
    },
    offCycleReason: {
      type: String,
      default: null,
    },
    notes: String,
  },

  {
    timestamps: true,
  },
);

payrollSchema.index(
  {
    company: 1,
    "payrollPeriod.month": 1,
    "payrollPeriod.year": 1,
    "payrollPeriod.periodNumber": 1,
  },
  { unique: true },
);

export default mongoose.model("Payroll", payrollSchema);
