import mongoose from "mongoose";

const repaymentSchema = new mongoose.Schema({
  payroll: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Payroll",
    required: true,
  },
  amount: { type: Number, required: true, min: 0 },
  paymentReference: String,
  paidAt: { type: Date, default: Date.now },
});

const employeeLoanSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    requestedAmount: { type: Number, required: true, min: 1 },
    purpose: { type: String, trim: true },
    termMonths: { type: Number, required: true, min: 1, max: 24 },

    // Set by HR/founder at approval
    approvedAmount: { type: Number, min: 0 },
    monthlyInstallment: { type: Number, min: 0 },

    amountRepaid: { type: Number, default: 0 },
    outstandingBalance: { type: Number, default: 0 },

    status: {
      type: String,
      enum: [
        "pending",
        "approved",
        "rejected",
        "active",
        "completed",
        "cancelled",
      ],
      default: "pending",
    },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
    rejectionReason: String,

    repayments: [repaymentSchema],
  },
  { timestamps: true },
);

employeeLoanSchema.index({ company: 1, employee: 1, status: 1 });

export default mongoose.model("EmployeeLoan", employeeLoanSchema);
