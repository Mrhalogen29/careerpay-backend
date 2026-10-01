import mongoose from "mongoose";

const employeeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    employeeId: {
      type: String,
      index: true,
      unique: true,
      sparse: true,
    },
    department: {
      type: String,
      trim: true,
      index: true,
    },
    position: {
      type: String,
      required: [true, "Position is required"],
      trim: true,
    },
    employmentType: {
      type: String,
      enum: ["full-time", "part-time", "contract"],
      default: "full-time",
      index: true,
    },
    startDate: {
      type: Date,
      required: [true, "Start date is required"],
      index: true,
    },
    endDate: {
      type: Date,
    },
    salary: {
      amount: {
        type: Number,
        required: [true, "Salary amount is required"],
        min: 0,
      },
      currency: {
        type: String,
        enum: ["NGN", "USD"],
        default: "NGN",
      },
      payFrequency: {
        type: String,
        enum: ["monthly", "bi-weekly", "weekly"],
        default: "monthly",
      },
    },
    bankDetails: {
      bankName: String,
      bankCode: {
        type: String,
        match: [/^\d{3}$/, "Bank code must be exactly 3 digits"],
      },
      accountNumber: {
        type: String,
        match: [/^\d{10}$/, "Account number must be exactly 10 digits"],
      },
      accountName: String,
    },
    taxInformation: {
      taxId: String, // TIN (Tax Identification Number)
      pensionId: String, // RSA PIN
      nhfNumber: String, // National Housing Fund
      taxRelief: {
        type: Number,
        default: 200000, // Annual tax relief in NGN (₦200,000 + 20% of gross + 1% of gross)
      },
    },
    manager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "on-leave", "suspended"],
      default: "active",
      index: true,
    },
    terminationDate: Date,
    terminationReason: String,
  },
  {
    timestamps: true,
  },
);

// Generate unique employee ID
employeeSchema.pre("save", function (next) {
  if (this.isNew && !this.employeeId) {
    this.employeeId = `EMP-${this._id.toString().slice(-6).toUpperCase()}`;
  }
  next();
});

export default mongoose.model("Employee", employeeSchema);
