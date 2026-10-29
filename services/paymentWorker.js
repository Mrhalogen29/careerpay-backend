import { Worker } from "bullmq";

import { connection, QUEUE_ENABLED } from "../config/paymentQueue.js";

import PaymentTransaction from "../models/paymentTransactionModel.js";

import Payroll from "../models/payrollModel.js";

import Audit from "../models/auditModel.js";

import Notification from "../models/notificationModel.js";

import payrollService from "./payrollService.js";

import paymentAlertService from "./paymentAlertService.js";

import gateways, { GATEWAY_PRIORITY } from "./gateways/index.js";

// * DISBURSE SINGLE PAYMENT

async function disburseSinglePayment(transaction, preferredGateway) {
  let lastError;

  const order =
    preferredGateway && GATEWAY_PRIORITY.includes(preferredGateway)
      ? [
          preferredGateway,
          ...GATEWAY_PRIORITY.filter((gateway) => gateway !== preferredGateway),
        ]
      : GATEWAY_PRIORITY;

  for (const gatewayName of order) {
    const gateway = gateways[gatewayName];

    if (!gateway) {
      console.error(`Gateway "${gatewayName}" is not configured`);
      continue;
    }

    try {
      console.log(
        `Attempting payment via ${gatewayName} for transaction ${transaction._id}`,
      );

      const result = await gateway.initiateTransfer(transaction);

      console.log(
        `Payment initiated via ${gatewayName} for transaction ${transaction._id}`,
      );

      return {
        ...result,
        gateway: gatewayName,
      };
    } catch (error) {
      console.error(
        `${gatewayName} failed for transaction ${transaction._id}: ${error.message}`,
      );

      lastError = error;

      const httpStatus = error.response?.status;
      const clearlyRejected =
        httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408;

      if (!clearlyRejected) {
        error.outcomeUnknown = true;
        break;
      }

      console.log(
        `Trying next available gateway for transaction ${transaction._id}`,
      );
    }
  }

  throw lastError || new Error("All configured payment gateways failed");
}

// CHECK AND FINALIZE PAYROLL

export async function checkAndFinalizePayroll(payrollId) {
  const payroll = await Payroll.findById(payrollId);

  if (!payroll) {
    console.error(`Cannot finalize payroll ${payrollId}: payroll not found`);
    return;
  }

  const transactions = await PaymentTransaction.find({
    payroll: payrollId,
    company: payroll.company,
  });

  if (!transactions.length) {
    payroll.status = "failed";

    await payroll.save();

    await Audit.log({
      company: payroll.company,
      user: payroll.processedBy,
      action: "payroll_failed",
      module: "payroll",
      resourceType: "payroll",
      resourceId: payroll._id,
      details: {
        reason: "No payment transactions were found",
      },
      status: "failure",
      severity: "critical",
    });

    return;
  }

  const allSettled = transactions.every((transaction) =>
    ["success", "failed", "cancelled"].includes(transaction.status),
  );

  if (!allSettled) {
    payroll.status = "processing";

    await payroll.save();

    return;
  }

  const successfulTransactions = transactions.filter(
    (transaction) => transaction.status === "success",
  );

  const failedTransactions = transactions.filter(
    (transaction) =>
      transaction.status === "failed" || transaction.status === "cancelled",
  );

  // SYNC PAYMENT TRANSACTIONS WITH PAYROLL ITEMS
  for (const transaction of transactions) {
    const payrollItem = payroll.payrollItems.find(
      (item) => item.employee.toString() === transaction.employee.toString(),
    );

    if (!payrollItem) {
      continue;
    }

    if (transaction.status === "success") {
      payrollItem.paymentStatus = "paid";

      payrollItem.paymentDate = transaction.paidAt || new Date();

      payrollItem.paymentReference = transaction.paymentReference;

      // Backup: make sure the loan repayment was recorded for paid employees.
      // Safe to repeat: a payroll can only be recorded on a loan once.
      await payrollService.applyLoanRepayment(
        payrollItem,
        payroll._id,
        payroll.company,
        transaction.paymentReference,
      );
    }

    if (transaction.status === "failed" || transaction.status === "cancelled") {
      payrollItem.paymentStatus = "failed";
    }
  }

  // Every payment succeeded
  if (successfulTransactions.length === transactions.length) {
    payroll.status = "completed";
  }

  // Every payment failed/cancelled
  else if (failedTransactions.length === transactions.length) {
    payroll.status = "failed";
  }

  // Some succeeded and some failed
  else {
    payroll.status = "processing";
  }

  await payroll.save();

  // AUDIT

  await Audit.log({
    company: payroll.company,
    user: payroll.processedBy,
    action:
      payroll.status === "completed"
        ? "payroll_completed"
        : payroll.status === "failed"
          ? "payroll_failed"
          : "payroll_processed",

    module: "payroll",

    resourceType: "payroll",

    resourceId: payroll._id,

    details: {
      month: payroll.payrollPeriod.month,
      year: payroll.payrollPeriod.year,

      totalTransactions: transactions.length,

      successful: successfulTransactions.length,

      failed: failedTransactions.length,

      status: payroll.status,
    },

    status: "success",

    severity: "high",
  });

  console.log(
    `Payroll ${payroll._id} finalized with status: ${payroll.status}`,
  );

  // Notify the company that payroll finalized
  await Notification.notify({
    company: payroll.company,
    user: payroll.processedBy,
    title:
      payroll.status === "completed"
        ? "Payroll completed successfully"
        : payroll.status === "failed"
          ? "Payroll processing failed"
          : "Payroll partially processed",
    message: `${successfulTransactions.length} of ${transactions.length} payments succeeded for ${payroll.payrollPeriod.month}/${payroll.payrollPeriod.year} payroll.`,
    type: "payroll",
    link: "payroll",
  });

  // Alert HR/admins about real failures (not admin cancellations)
  const reallyFailed = failedTransactions.filter(
    (transaction) => transaction.status === "failed",
  );

  if (reallyFailed.length > 0) {
    try {
      await paymentAlertService.notifyFailures(payroll, reallyFailed);
    } catch (alertError) {
      console.error(
        "Payment failure alert error (non-fatal):",
        alertError.message,
      );
    }
  }
}

// PROCESS ONE PAYMENT JOB
//
// This is the payment logic itself. It is a plain exported function so it can
// be run in two ways:
//   1. By the BullMQ worker below, when ENABLE_QUEUE is "true".
//   2. Directly by payrollService.dispatchPayment(), when the queue is off.
// It only reads job.id and job.data.

export async function processPaymentJob(job) {
  const { transactionId, preferredGateway } = job.data;

  console.log(
    `Starting payment job ${job.id} for transaction ${transactionId}`,
  );

  // LOAD TRANSACTION

  const existingTransaction = await PaymentTransaction.findById(transactionId);

  if (!existingTransaction) {
    throw new Error(`Transaction ${transactionId} not found`);
  }

  //  SAFETY CHECKS

  // Payment was cancelled before worker started
  if (existingTransaction.status === "cancelled") {
    console.log(`Skipping cancelled payment ${existingTransaction._id}`);

    return {
      skipped: true,
      reason: "cancelled",
    };
  }

  // Payment has already succeeded
  if (existingTransaction.status === "success") {
    console.log(
      `Skipping already successful payment ${existingTransaction._id}`,
    );

    return {
      skipped: true,
      reason: "already_successful",
    };
  }

  // ATOMIC pending → processing

  const transaction = await PaymentTransaction.findOneAndUpdate(
    {
      _id: transactionId,
      status: "pending",
    },

    {
      $set: {
        status: "processing",
        lastAttemptAt: new Date(),
      },

      $inc: {
        attemptCount: 1,
      },
    },

    {
      new: true,
    },
  );

  /**
   * Another worker/process already changed the transaction.
   */
  if (!transaction) {
    const currentTransaction = await PaymentTransaction.findById(transactionId);

    if (!currentTransaction) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    if (currentTransaction.status === "cancelled") {
      console.log(`Payment ${transactionId} was cancelled before processing`);

      return {
        skipped: true,
        reason: "cancelled",
      };
    }

    if (currentTransaction.status === "success") {
      console.log(`Payment ${transactionId} is already successful`);

      return {
        skipped: true,
        reason: "already_successful",
      };
    }

    /**
     * If it is already processing, do not send another
     * gateway request.
     */
    if (currentTransaction.status === "processing") {
      console.log(`Payment ${transactionId} is already processing`);

      return {
        skipped: true,
        reason: "already_processing",
      };
    }

    throw new Error(
      `Transaction ${transactionId} is already ${currentTransaction.status}`,
    );
  }

  // ATTEMPT PAYMENT

  // IDEMPOTENCY: never pay the same employee twice in one payroll
  const alreadyPaid = await PaymentTransaction.exists({
    payroll: transaction.payroll,
    employee: transaction.employee,
    status: "success",
    _id: { $ne: transaction._id },
  });

  if (alreadyPaid) {
    transaction.status = "cancelled";
    transaction.gatewayMessage =
      "Skipped: employee already paid in this payroll";
    transaction.failureReason = "Duplicate payment blocked";
    await transaction.save();

    console.warn(`Blocked duplicate payment ${transaction._id}`);
    await checkAndFinalizePayroll(transaction.payroll);

    return { skipped: true, reason: "already_paid" };
  }

  try {
    const result = await disburseSinglePayment(transaction, preferredGateway);

    /**
     * Gateway accepted the transfer.
     *
     * IMPORTANT:
     * Keep status = processing.
     *
     * The webhook will later change it to success/failed.
     */
    transaction.gatewayTransferId = result.transferId || null;

    transaction.gatewayMessage =
      result.message || "Payment initiated successfully";

    transaction.gateway = result.gateway;

    transaction.status = "processing";

    await transaction.save();

    console.log(
      `Payment ${transaction._id} initiated successfully via ${result.gateway}`,
    );

    return {
      transactionId: transaction._id.toString(),
      gateway: result.gateway,
      status: "processing",
      message: "Payment initiated and awaiting gateway confirmation",
    };
  } catch (gatewayError) {
    // GATEWAY FAILURE

    console.error(`Payment ${transaction._id} failed: ${gatewayError.message}`);

    /**
     * We don't know whether the money moved (timeout, network error, 5xx).
     * Do NOT retry or fail over: leave it for reconciliation.
     * Returning (not throwing) stops BullMQ from retrying the job.
     */

    if (gatewayError.outcomeUnknown) {
      transaction.status = "processing";
      transaction.gatewayMessage =
        "Outcome unknown. Awaiting reconciliation; not retried automatically.";
      await transaction.save();

      return {
        transactionId: transaction._id.toString(),
        status: "processing",
        message: "Outcome unknown; left for reconciliation",
      };
    }

    transaction.gatewayMessage = gatewayError.message;

    /**
     * Maximum retry reached.
     */

    if (transaction.attemptCount >= transaction.maxRetries) {
      transaction.status = "failed";

      transaction.failureReason =
        `Failed after ${transaction.maxRetries} attempts across all gateways. ` +
        `Last error: ${gatewayError.message}`;

      await transaction.save();

      console.error(
        `Payment ${transaction._id} permanently failed after ${transaction.attemptCount} attempts`,
      );

      /**
       * Check whether the payroll can now be finalized.
       */
      await checkAndFinalizePayroll(transaction.payroll);
    } else {
      /**
       * Retry is still available.
       */
      transaction.status = "pending";

      await transaction.save();

      console.log(
        `Payment ${transaction._id} returned to pending for retry ` +
          `(${transaction.attemptCount}/${transaction.maxRetries})`,
      );
    }

    /**
     * Throwing allows BullMQ to register the job as failed
     * and apply its configured retry/backoff policy.
     */
    throw gatewayError;
  }
}

//  PAYMENT WORKER
//
// Only created when ENABLE_QUEUE is "true". When the queue is off this is
// null and nothing connects to Redis.

const worker = QUEUE_ENABLED
  ? new Worker("payroll-payments", processPaymentJob, {
      connection,

      /**
       * Process up to 5 employee payments concurrently.
       */
      concurrency: 5,

      /**
       * Poll Redis less often when idle to save Upstash commands.
       * drainDelay is in seconds (default 5); stalledInterval in ms (default 30000).
       */
      drainDelay: 30,
      stalledInterval: 120000,
    })
  : null;

/**

  WORKER EVENTS

 */

worker?.on("completed", (job, result) => {
  console.log(`Payment job ${job.id} completed.`, result || "");
});

worker?.on("failed", (job, error) => {
  console.error(`Payment job ${job?.id} failed: ${error.message}`);
});

worker?.on("error", (error) => {
  console.error("Payment worker error:", error);
});

worker?.on("stalled", (jobId) => {
  console.warn(`Payment job ${jobId} has stalled and may be retried.`);
});

export default worker;
