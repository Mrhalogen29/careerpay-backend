import { Worker, Queue } from "bullmq";
import { connection } from "../config/paymentQueue.js";
import PaymentTransaction from "../models/paymentTransactionModel.js";
import payrollService from "./payrollService.js";
import { checkAndFinalizePayroll } from "./paymentWorker.js";
import gateways from "./gateways/index.js";

const RECONCILIATION_QUEUE = "payment-reconciliation";
const STALE_THRESHOLD_MINUTES = 5;

// Queue that holds the repeatable reconciliation job
export const reconciliationQueue = new Queue(RECONCILIATION_QUEUE, { connection });

/**
 * Schedules the reconciliation job to run every 5 minutes.
 * Called once on server startup.
 * Clears existing repeatable jobs first to prevent duplicates on restart.
 */
export async function startReconciliationSchedule() {
  const existing = await reconciliationQueue.getRepeatableJobs();
  for (const job of existing) {
    await reconciliationQueue.removeRepeatableByKey(job.key);
  }

  await reconciliationQueue.add(
    "reconcile-processing-payments",
    {},
    {
      repeat: { every: 5 * 60 * 1000 }, // every 5 minutes
    }
  );

  console.log("Reconciliation schedule started — runs every 5 minutes");
}

/**
 * Worker — processes one reconciliation job at a time.
 * Finds all transactions stuck in "processing" for more than 5 minutes,
 * queries Flutterwave directly for their current status,
 * and updates the transaction and payroll accordingly.
 */
const reconciliationWorker = new Worker(
  RECONCILIATION_QUEUE,
  async (job) => {
    console.log(`[Reconciliation] Job started at ${new Date().toISOString()}`);

    const staleThreshold = new Date(
      Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000
    );

    // Only reconcile transactions that:
    // 1. Are stuck in processing
    // 2. Have been processing for more than 5 minutes
    // 3. Have a gateway transfer ID (meaning gateway accepted the transfer)
    const staleTransactions = await PaymentTransaction.find({
      status: "processing",
      lastAttemptAt: { $lt: staleThreshold },
      gatewayTransferId: { $exists: true, $ne: null },
    });

    if (staleTransactions.length === 0) {
      console.log("[Reconciliation] No stale transactions found");
      return;
    }

    console.log(
      `[Reconciliation] Found ${staleTransactions.length} stale transaction(s) — checking with gateway`
    );

    for (const transaction of staleTransactions) {
      try {
       // Use the correct gateway based on which one processed this transaction
        const gatewayName = transaction.gateway || "flutterwave"; // ← ADDED fallback
        const gateway = gateways[gatewayName]; // ← CHANGED from hardcoded Flutterwave axios call

        if (!gateway) {
          console.error(
            `[Reconciliation] Unknown gateway "${gatewayName}" for transaction ${transaction._id} — skipping`
          );
          continue;
        }

        const flwStatus = await gateway.verifyTransfer(transaction.gatewayTransferId);

        console.log(
          `[Reconciliation] Transaction ${transaction._id} — ${gatewayName} status: ${flwStatus}`
        );

        if (flwStatus === "SUCCESSFUL") {
          transaction.status = "success";
          transaction.paidAt = new Date();
          transaction.gatewayMessage = `Transfer successful (reconciled via ${gatewayName})`;
          await transaction.save();

          await payrollService.markPayrollItemPaid(
            transaction.payroll,
            transaction.employee,
            transaction.paymentReference
          );

          await checkAndFinalizePayroll(transaction.payroll);

          console.log(
            `[Reconciliation] Transaction ${transaction._id} — marked as success via ${gatewayName}`
          );
        } else if (flwStatus === "FAILED") {
          transaction.status = "failed";
         transaction.failureReason = `Transfer failed (reconciled via ${gatewayName})`;
          transaction.gatewayMessage = `Transfer failed via ${gatewayName}`;
          await transaction.save();

          await checkAndFinalizePayroll(transaction.payroll);

          console.log(
            `[Reconciliation] Transaction ${transaction._id} — marked as failed via ${gatewayName}`
          );
        } else {
          // Status is still NEW or PENDING — Flutterwave hasn't settled it yet
          // Will be picked up again in the next reconciliation cycle
          console.log(
            `[Reconciliation] Transaction ${transaction._id} — still ${flwStatus} on ${gatewayName}, will check next cycle`
          );
        }
      } catch (error) {
        // Log and continue — one failed transaction should not block the rest
        console.error(
          `[Reconciliation] Error processing transaction ${transaction._id}:`,
          error.message
        );
      }
    }

    console.log(`[Reconciliation] Job completed at ${new Date().toISOString()}`);
  },
  {
    connection,
    concurrency: 1, // one reconciliation run at a time
  }
);

reconciliationWorker.on("completed", (job) => {
  console.log(`[Reconciliation] Job ${job.id} completed`);
});

reconciliationWorker.on("failed", (job, error) => {
  console.error(`[Reconciliation] Job ${job.id} failed:`, error.message);
});

reconciliationWorker.on("error", (error) => {
  console.error("[Reconciliation] Worker error:", error);
});

export default reconciliationWorker;