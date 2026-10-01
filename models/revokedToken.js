import mongoose from "mongoose";

const revokedTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  reason: {
    type: String,
    enum: ["logout", "password_change", "password_reset", "admin_revoke"],
    default: "logout",
  },

  // MongoDB TTL index: auto-deletes this document after expiresAt
  // Set to the token's original expiry so we don't store stale records
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 },
  },

  revokedAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("RevokedToken", revokedTokenSchema);
