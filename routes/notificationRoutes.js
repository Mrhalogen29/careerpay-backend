import express from "express";
import notificationController from "../controllers/notificationController.js";
import { protect, requireVerified } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(requireVerified);

router.get("/", notificationController.getMyNotifications);
router.patch("/:id/read", notificationController.markAsRead);
router.patch("/read-all", notificationController.markAllAsRead);

export default router;
