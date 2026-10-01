import mongoose from "mongoose";
import bcrypt from "bcrypt";

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^\S+@\S+\.\S+$/,
    },

    password: {
      type: String,
      required: true,
      minLength: 8,
      select: false,
    },

    firstName: {
      type: String,
      required: true,
      trim: true,
    },

    lastName: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      trim: true,
      required: true,
      unique: true,
    },

    profilePhoto: {
      type: String,
      trim: true,
    },

    role: {
      type: String,
      enum: ["founder", "admin", "hr", "employee"],
      default: "employee",
    },

    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    lastLogin: {
      type: Date,
    },

    refreshTokens: [
      {
        token: String,
        expiresAt: Date,
        ipAddress: String,
        userAgent: String,
        createdAt: {
          type: Date,
          default: Date.now,
        }
      }
    ],
    passwordChangedAt: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,

    passwordHistory: {
      type: [
        {
          hash: String,
          changedAt: {
            type: Date,
            default: Date.now,
          },
        },
      ],
      select: false,
    },

    loginAttempts: {
      type: Number,
      default: 0
    },
    loginAttemptsWindowStart: Date,
    lockUntil: Date,

    knownDevices: [
      {
        userAgent: String,
        ipAddress: String,
        firstSeenAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // For future 2FA implementation — fields added now to avoid migration later
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorSecret: {
      type: String,
      select: false,
    },

  },
  {
    timestamps: true,
  }
);

// Hashing Password
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Comparing Password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

//Check if the password changed after JWT was issued
userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (!JWTTimestamp) return false;

  if (this.passwordChangedAt) {
    const changedTimestamp = Math.floor(
      this.passwordChangedAt.getTime() / 1000
    );
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

// Check if password exists in last 3 
userSchema.methods.isPasswordInHistory = async function (candidatePassword) {
  if (!this.passwordHistory || this.passwordHistory.length === 0) return false;
  for (const entry of this.passwordHistory) {
    const match = await bcrypt.compare(candidatePassword, entry.hash);
    if (match) return true;
  }
  return false;
};

// Push current password hash to history, keep only last 3
userSchema.methods.addToPasswordHistory = function (hashedPassword) {
  if (!this.passwordHistory) this.passwordHistory = [];
  this.passwordHistory.unshift({ hash: hashedPassword });
  if (this.passwordHistory.length > 3) {
    this.passwordHistory = this.passwordHistory.slice(0, 3);
  }
};

export default mongoose.model("User", userSchema);
