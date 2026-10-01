import "dotenv/config";
import connectDB from "./config/db.js";
import app from "./app.js";
import worker from "./services/paymentWorker.js";
import reconciliationWorker, {
  startReconciliationSchedule,
} from "./services/reconciliationWorker.js";

const startServer = async () => {
  try {
    // Connect to database
    await connectDB();

    // Start payment worker — processes payroll payment jobs from queue
    // Runs continuously in background alongside the API server
    console.log("Payment worker started and listening for jobs...");

    await startReconciliationSchedule(); // ← ADD
    console.log("Reconciliation worker started...");

    // Start listening
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

    // Handle unhandled promise rejections
    process.on("unhandledRejection", (err) => {
      console.error(`Unhandled Rejection: ${err.message}`);
      server.close(() => process.exit(1));
    });

    // Handle SIGTERM — graceful shutdown
    // Close worker before shutting down so no jobs are lost mid-processing
    process.on("SIGTERM", async () => {
      console.log("SIGTERM received. Shutting down gracefully...");

      // Close worker first — waits for current job to finish before stopping
      await worker.close();
      console.log("Payment worker closed");
      await reconciliationWorker.close();
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
