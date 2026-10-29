import "dotenv/config";
import connectDB from "./config/db.js";
import app from "./app.js";
import { QUEUE_ENABLED } from "./config/paymentQueue.js";
import worker from "./services/paymentWorker.js";
import reconciliationWorker, {
  startReconciliationSchedule,
} from "./services/reconciliationWorker.js";

const startServer = async () => {
  try {
    await connectDB();

    if (QUEUE_ENABLED) {
      console.log("Payment worker started and listening for jobs...");
    } else {
      console.log(
        "Payment queue disabled (ENABLE_QUEUE is not 'true'): payments run directly, Redis not used.",
      );
    }

    // Does nothing when the queue is disabled
    await startReconciliationSchedule();
    if (QUEUE_ENABLED) {
      console.log("Reconciliation worker started...");
    }

    const PORT = process.env.PORT || 5000;
    const server = app.listen(PORT, () => {
      console.log(
        `Server running in ${process.env.NODE_ENV} mode on port ${PORT}`,
      );
      console.log(`API URL: http://localhost:${PORT}/api`);
      console.log(`Health Check: http://localhost:${PORT}/api/health\n`);
      if (process.env.DISABLE_SUBSCRIPTION_CHECK === "true") {
        console.log(
          "\n\x1b[41m\x1b[37m%s\x1b[0m",
          "  WARNING: DISABLE_SUBSCRIPTION_CHECK=true — subscription gating is OFF  ",
        );
        console.log(
          "\x1b[41m\x1b[37m%s\x1b[0m\n",
          "  Do NOT deploy to production with this flag set!                       ",
        );
      }
    });

    process.on("unhandledRejection", (err) => {
      console.error(`Unhandled Rejection: ${err.message}`);
      server.close(() => process.exit(1));
    });

    process.on("SIGTERM", async () => {
      console.log("SIGTERM received. Shutting down gracefully...");

      // Both are null when the queue is disabled, so use ?. to skip them
      await worker?.close();
      console.log("Payment worker closed");
      await reconciliationWorker?.close();
      console.log("Reconciliation worker closed");

      server.close(() => {
        console.log("Process terminated");
        process.exit(0);
      });
    });
  } catch (error) {
    console.error(`Startup error: ${error.message}`);
    process.exit(1);
  }
};

startServer();
