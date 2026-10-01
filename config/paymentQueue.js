import { Queue } from "bullmq";
import { Redis } from "ioredis";

// Redis connection using Upstash TCP URL
const connection = new Redis(process.env.UPSTASH_REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ
  tls: {}, // Required for rediss:// (SSL)
});

// Payment queue — one job per employee payment
const paymentQueue = new Queue("payroll-payments", {
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

export { paymentQueue, connection };

connection.on("connect", () => {
  console.log("✅ Redis connected");
});

connection.on("ready", () => {
  console.log("✅ Redis ready");
});

connection.on("error", (err) => {
  console.error("❌ Redis error:", err.message);
});
