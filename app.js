// src/app.js

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import routes from "./routes/index.js";
import { errorHandler, notFound } from "./middlewares/errorHandler.js";
import "dotenv/config";

const app = express();

// ===============================
// Security middleware
// ===============================
app.use(helmet());

// ===============================
// CORS configuration
// ===============================

const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  process.env.CORS_ORIGIN,
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests without an origin
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log("CORS blocked origin:", origin);

      return callback(new Error("Not allowed by CORS"));
    },

    credentials: true,
  }),
);

// ===============================
// Body parser middleware
// ===============================

app.use(express.json({ limit: "10mb" }));

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  }),
);

// ===============================
// Logging middleware
// ===============================

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// ===============================
// API routes
// ===============================

app.use("/api", routes);

// ===============================
// Root endpoint
// ===============================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to CareerPay API",
    version: "1.0.0",
    documentation: "/api/health",
  });
});

// ===============================
// 404 handler
// ===============================

app.use(notFound);

// ===============================
// Global error handler
// ===============================

app.use(errorHandler);

export default app;
