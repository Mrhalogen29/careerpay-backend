import subscriptionService from "../services/subscriptionService.js";
import Subscription from "../models/subscriptionModel.js";

/**
 * Middleware factory — checks if company has active subscription for a module
 * Expired companies get read-only access (GET allowed, mutations blocked)
 * Companies with no subscription ever are blocked completely
 */
const requireSubscription = (module) => {
  return async (req, res, next) => {
    if (process.env.DISABLE_SUBSCRIPTION_CHECK === "true") {
      return next();
    }
    try {
      const companyId = req.user.company;

      const isActive = await subscriptionService.hasActiveSubscription(
        companyId,
        module,
      );

      if (isActive) {
        return next();
      }

      // No active subscription — check if they ever had one (read-only access)
      const hadSubscription = await Subscription.findOne({
        company: companyId,
        module,
      });

      if (hadSubscription && req.method === "GET") {
        // Expired — allow read-only
        req.isReadOnly = true;
        return next();
      }

      // Never subscribed or expired trying to mutate
      return res.status(403).json({
        success: false,
        message: hadSubscription
          ? `Your ${module} subscription has expired. Please renew to continue.`
          : `You do not have an active ${module} subscription. Please subscribe to access this feature.`,
        subscriptionRequired: true,
        module,
      });
    } catch (error) {
      console.error("Subscription check error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to verify subscription",
      });
    }
  };
};

export default requireSubscription;
