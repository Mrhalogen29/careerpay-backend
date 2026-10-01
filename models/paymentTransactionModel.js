import mongoose from "mongoose";

const paymentTransactionSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    payroll: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payroll",
      required: true,
      index: true,
    },

    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },

    // Amount sent to employee
    amount: {
      type: Number,
      required: true,
    },

    currency: {
      type: String,
      enum: ["NGN", "USD"],
      default: "NGN",
    },

    bankDetails: {
      bankName: String,
      bankCode: String,
      accountNumber: String,
      accountName: String,
    },

    status: {
      type: String,
      enum: ["pending", "processing", "success", "failed", "cancelled"],
      default: "pending",
      index: true,
    },

    // Gateway used for this transaction
    gateway: {
      type: String,
      enum: ["flutterwave", "monnify"],
      default: "flutterwave",
    },

    // Unique reference sent to the gateway
    paymentReference: {
      type: String,
    },

    // Transfer ID returned by the gateway after initiation
    gatewayTransferId: {
      type: String,
    },

    // response message from gateway
    gatewayMessage: {
      type: String,
    },

    // Number of times payment has been attempted
    attemptCount: {
      type: Number,
      default: 0,
    },

    // Maximum retries allowed
    maxRetries: {
      type: Number,
      default: 5,
    },

    // Timestamp of last attempt
    lastAttemptAt: {
      type: Date,
    },

    // Timestamp of successful payment
    paidAt: {
      type: Date,
    },

    // Reason for permanent failure after all retries
    failureReason: {
      type: String,
    },

    // Job ID in BullMQ queue — used to track/cancel jobs
    queueJobId: {
      type: String,
    },

    initiatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// Compound index for tracking page queries
paymentTransactionSchema.index({
  company: 1,
  status: 1,
  createdAt: -1,
});

paymentTransactionSchema.index(
  { payroll: 1, employee: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["pending", "processing", "success"] },
    },
  },
);

export default mongoose.model("PaymentTransaction", paymentTransactionSchema);
