import { Queue } from "bullmq";
import { Redis } from "ioredis";

// Master switch. Redis is only touched when ENABLE_QUEUE is exactly "true".
// Leave it unset (or "false") in dev/UAT; set it to "true" in production.
export const QUEUE_ENABLED = process.env.ENABLE_QUEUE === "true";

let connection = null;
let paymentQueue = null;

if (QUEUE_ENABLED) {
  if (!process.env.UPSTASH_REDIS_URL) {
    throw new Error(
      "ENABLE_QUEUE is true but UPSTASH_REDIS_URL is not set. Set it or disable the queue.",
    );
  }

  // Redis connection using Upstash TCP URL
  connection = new Redis(process.env.UPSTASH_REDIS_URL, {
    maxRetriesPerRequest: null, // Required by BullMQ
    tls: {}, // Required for rediss:// (SSL)
  });

  connection.on("connect", () => console.log("Redis connected"));
  connection.on("ready", () => console.log("Redis ready"));
  connection.on("error", (err) =>
    console.error("❌ Redis error:", err.message),
  );

  // Payment queue — one job per employee payment
  paymentQueue = new Queue("payroll-payments", {
    connection,
    defaultJobOptions: {
      attempts: 5, // Max 5 retries
      backoff: {
        type: "fixed",
        delay: 5 * 60 * 1000, // 5 minutes between retries
      },
      removeOnComplete: false, // Keep completed jobs for audit
      removeOnFail: false, // Keep failed jobs for investigation
    },
  });
} else {
  console.log(
    "Payment queue disabled (ENABLE_QUEUE is not 'true'). Redis not connected.",
  );
}

export { paymentQueue, connection };
