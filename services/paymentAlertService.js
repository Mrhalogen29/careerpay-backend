import PaymentTransaction from "../models/paymentTransactionModel.js";
import User from "../models/userModel.js";
import Notification from "../models/notificationModel.js";
import emailService from "./emailService.js";

class PaymentAlertService {
  async notifyFailures(payroll, failedTransactions) {
    const fresh = await PaymentTransaction.find({
      _id: { $in: failedTransactions.map((t) => t._id) },
      failureNotifiedAt: null,
    })
      .populate({
        path: "employee",
        select: "employeeId",
        populate: { path: "user", select: "firstName lastName" },
      })
      .lean();

    if (fresh.length === 0) return;

    // Claim them first so a repeated webhook can't alert twice
    const claim = await PaymentTransaction.updateMany(
      { _id: { $in: fresh.map((t) => t._id) }, failureNotifiedAt: null },
      { $set: { failureNotifiedAt: new Date() } },
    );
    if (claim.modifiedCount === 0) return;

    const recipients = await User.find({
      company: payroll.company,
      role: { $in: ["founder", "admin", "hr"] },
      isActive: true,
    }).select("email firstName");

    const period = `${payroll.payrollPeriod.month}/${payroll.payrollPeriod.year}`;

    const failures = fresh.map((t) => ({
      name:
        `${t.employee?.user?.firstName || ""} ${t.employee?.user?.lastName || ""}`.trim() ||
        "Unknown employee",
      employeeId: t.employee?.employeeId || "",
      amount: t.amount,
      reason: t.failureReason || t.gatewayMessage || "Unknown reason",
      reference: t.paymentReference,
    }));

    for (const user of recipients) {
      try {
        await Notification.notify({
          company: payroll.company,
          user: user._id,
          title: "Payroll payment failures",
          message: `${failures.length} payment(s) failed for the ${period} payroll. Check the Audit log.`,
          type: "payroll",
          link: "audit-log",
        });
      } catch (err) {
        console.error("In-app failure notification error:", err.message);
      }

      const result = await emailService.sendPaymentFailureEmail(user, {
        period,
        currency: payroll.currency,
        failures,
      });

      if (!result?.success) {
        console.error(
          `Failure email to ${user.email} not sent:`,
          result?.error,
        );
      }
    }
  }
}

export default new PaymentAlertService();
