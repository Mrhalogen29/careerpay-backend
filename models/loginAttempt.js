import mongoose from "mongoose";

const loginAttemptSchema = new mongoose.Schema({
  ipAddress: {
    type: String,
    required: true
  },
  attempts: {
    type: Number,
    default: 0
  },
  windowStart: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date
  }
});

loginAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("LoginAttempt", loginAttemptSchema);