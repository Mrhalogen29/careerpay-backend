import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["payroll", "employee", "financing", "equity", "system"],
      default: "system",
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    link: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

notificationSchema.index({ company: 1, createdAt: -1 });

notificationSchema.statics.notify = async function (data) {
  try {
    return await this.create(data);
  } catch (error) {
    console.error("Notification creation failed:", error);
  }
};

export default mongoose.model("Notification", notificationSchema);
