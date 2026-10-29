import mongoose from "mongoose";

const purchaseSchema = new mongoose.Schema(
  {
    // Random, unguessable. Acts as the claim code at sign-up.
    reference: { type: String, required: true, unique: true },

    email: { type: String, required: true, lowercase: true, trim: true },

    items: [
      {
        _id: false,
        module: {
          type: String,
          enum: ["payroll", "financing", "esop"],
          required: true,
        },
        usdAmount: { type: Number, required: true },
        ngnAmount: { type: Number, required: true },
      },
    ],

    currency: { type: String, enum: ["USD", "NGN"], required: true },

    // Exactly what Flutterwave must collect, in `currency`
    chargeAmount: { type: Number, required: true },
    exchangeRate: { type: Number, required: true },

    status: {
      type: String,
      enum: ["pending", "paid", "claimed"],
      default: "pending",
      index: true,
    },

    transactionId: String,
    paidAt: Date,

    claimedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    claimedAt: Date,
    // Set only for purchases made by an existing company (in-app renewal)
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },

  { timestamps: true },
);

export default mongoose.model("SubscriptionPurchase", purchaseSchema);
