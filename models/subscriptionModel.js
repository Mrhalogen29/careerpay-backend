import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    module: {
      type: String,
      enum: ["payroll", "financing", "esop"],
      required: true,
    },

    status: {
      type: String,
      enum: ["active", "expired", "cancelled"],
      default: "active",
    },

    startDate: {
      type: Date,
      required: true,
    },

    endDate: {
      type: Date,
      required: true,
      index: true,
    },

    // Amount paid in the currency of payment
    amount: {
      type: Number,
      required: true,
    },

    currency: {
      type: String,
      enum: ["USD", "NGN"],
      required: true,
    },

    // NGN equivalent at time of payment
    ngnAmount: {
      type: Number,
      required: true,
    },

    // USD/NGN exchange rate at time of payment
    exchangeRate: {
      type: Number,
      required: true,
    },

    // Paystack payment reference
    paymentReference: {
      type: String,
      required: true,
      unique: true,
    },

    // Paystack transaction ID returned after verification
    transactionId: {
      type: String,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index — one active subscription per module per company
subscriptionSchema.index({ company: 1, module: 1, status: 1 });

export default mongoose.model("Subscription", subscriptionSchema);