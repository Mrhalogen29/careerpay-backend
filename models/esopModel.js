import mongoose, { Schema } from "mongoose";

const vestingScheduleSchema = new mongoose.Schema({
  vestingDate: {
    type: Date,
    required: true,
    index: true
  },

  sharesVested: {
    type: Number,
    required: true,
    min: 0,
  },

  cumulativeVested: {
    type: Number,
    required: true,
  },

  isProcessed: {
    type: Boolean,
    default: false,
    index: true
  },

  processedAt: Date,
});

const equityGrantSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true
    },

    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },

    grantType: {
      type: String,
      enum: ["stock_option", "rsu", "restricted_stock", "phantom_stock"],
      default: "stock_option",
    },

    totalShares: {
      type: Number,
      required: true,
      min: 0,
    },

    grantDate: {
      type: Date,
      required: true,
      default: Date.now,
    },

    vestingStartDate: {
      type: Date,
      required: true,
    },

    vestingPeriodMonths: {
      type: Number,
      required: true,
      default: 48,
    },

    cliffMonths: {
      type: Number,
      default: 12,
    },

    vestingFrequency: {
      type: String,
      enum: ["monthly", "quarterly", "yearly"],
      default: "monthly",
    },

    strikePrice: {
      type: Number,
      min: 0,
    },

    // Fair Market Value
    currentFMV: {
      type: Number,
      min: 0,
    },

    sharesExercised: {
      type: Number,
      default: 0,
      min: 0,
    },

    vestingSchedule: [vestingScheduleSchema],
    status: {
      type: String,
      enum: ["active", "fully_vested", "terminated", "cancelled"],
      default: "active",
    },

    notes: String,
  },
  {
    timestamps: true,
  }
);

// Virtual to calculate unvested shares
equityGrantSchema.virtual("sharesUnvested").get(function () {
  return this.totalShares - this.sharesVested;
});

// Virtual to calculate vesting percentage progress
equityGrantSchema.virtual("vestingProgress").get(function () {
  return (this.sharesVested / this.totalShares) * 100;
});

// Virtual to calculate the next vesting date
equityGrantSchema.virtual("nextVestingDate").get(function () {
  const upcomingVesting = this.vestingSchedule.find(
    (v) => !v.isProcessed && v.vestingDate > new Date()
  );
  return upcomingVesting ? upcomingVesting.vestingDate : null;
});

export default mongoose.model("Esop", equityGrantSchema);
