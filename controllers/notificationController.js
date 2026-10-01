import Notification from "../models/notificationModel.js";

class NotificationController {
  async getMyNotifications(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;
      const { unreadOnly } = req.query;

      // Show notifications targeted at this specific user, OR company-wide ones
      const query = {
        company: companyId,
        $or: [{ user: userId }, { user: null }],
      };

      if (unreadOnly === "true") {
        query.isRead = false;
      }

      const limit = Math.min(parseInt(req.query.limit) || 50, 100);

      const notifications = await Notification.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      const unreadCount = await Notification.countDocuments({
        ...query,
        isRead: false,
      });

      res.status(200).json({
        success: true,
        data: notifications,
        unreadCount,
      });
    } catch (error) {
      console.error("Get notifications error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch notifications",
      });
    }
  }

  async markAsRead(req, res) {
    try {
      const companyId = req.user.company;
      const { id } = req.params;

      const notification = await Notification.findOneAndUpdate(
        { _id: id, company: companyId },
        { isRead: true },
        { new: true },
      );

      if (!notification) {
        return res.status(404).json({
          success: false,
          message: "Notification not found",
        });
      }

      res.status(200).json({ success: true, data: notification });
    } catch (error) {
      console.error("Mark notification read error:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to update notification",
      });
    }
  }

  async markAllAsRead(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;

      await Notification.updateMany(
        {
          company: companyId,
          $or: [{ user: userId }, { user: null }],
          isRead: false,
        },
        { isRead: true },
      );

      res
        .status(200)
        .json({ success: true, message: "All notifications marked as read" });
    } catch (error) {
      console.error("Mark all read error:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to update notifications",
      });
    }
  }
}

export default new NotificationController();
