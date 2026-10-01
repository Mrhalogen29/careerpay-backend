import subscriptionService from "../services/subscriptionService.js";

class SubscriptionController {
  /**
   * Get pricing and current exchange rate
   * GET /api/subscriptions/pricing
   */
  async getPricing(req, res) {
    try {
      const exchangeRate = await subscriptionService.getExchangeRate();

      const pricing = {
        exchangeRate,
        modules: {
          payroll: {
            usd: 20,
            ngn: Math.round(20 * exchangeRate),
          },
          financing: {
            usd: 15,
            ngn: Math.round(15 * exchangeRate),
          },
          esop: {
            usd: 20,
            ngn: Math.round(20 * exchangeRate),
          },
        },
      };

      res.status(200).json({
        success: true,
        data: pricing,
      });
    } catch (error) {
      console.error("Get pricing error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch pricing",
      });
    }
  }

  /**
   * Initiate subscription payment
   * POST /api/subscriptions/:module/initiate
   */
  async initiatePayment(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;
      const userEmail = req.user.email;
      const { module } = req.params;
      const { currency } = req.body;

      const validModules = ["payroll", "financing", "esop"];
      if (!validModules.includes(module)) {
        return res.status(400).json({
          success: false,
          message: "Invalid module. Must be payroll, financing, or esop",
        });
      }

      if (!currency || !["USD", "NGN"].includes(currency)) {
        return res.status(400).json({
          success: false,
          message: "Currency is required. Must be USD or NGN",
        });
      }

      const result = await subscriptionService.initiatePayment(
        companyId,
        module,
        currency,
        userEmail,
        userId
      );

      res.status(200).json({
        success: true,
        message: "Payment initiated. Complete payment at the provided URL.",
        data: result,
      });
    } catch (error) {
      console.error("Initiate payment error:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to initiate payment",
      });
    }
  }

  /**
   * Verify payment and activate subscription
   * POST /api/subscriptions/verify
   */
  async verifyPayment(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;
      const { reference } = req.body;

      if (!reference) {
        return res.status(400).json({
          success: false,
          message: "Payment reference is required",
        });
      }

      const subscription = await subscriptionService.verifyAndActivate(
        reference,
        companyId,
        userId
      );

      res.status(200).json({
        success: true,
        message: "Subscription activated successfully",
        data: subscription,
      });
    } catch (error) {
      console.error("Verify payment error:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to verify payment",
      });
    }
  }

  /**
   * Get all company subscriptions
   * GET /api/subscriptions
   */
  async getCompanySubscriptions(req, res) {
    try {
      const companyId = req.user.company;

      const result = await subscriptionService.getCompanySubscriptions(
        companyId
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("Get subscriptions error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch subscriptions",
      });
    }
  }

  /**
   * Get subscription status for a specific module
   * GET /api/subscriptions/:module
   */
  async getModuleSubscription(req, res) {
    try {
      const companyId = req.user.company;
      const { module } = req.params;

      const validModules = ["payroll", "financing", "esop"];
      if (!validModules.includes(module)) {
        return res.status(400).json({
          success: false,
          message: "Invalid module. Must be payroll, financing, or esop",
        });
      }

      const result = await subscriptionService.getModuleSubscription(
        companyId,
        module
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("Get module subscription error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch subscription",
      });
    }
  }
}

export default new SubscriptionController();