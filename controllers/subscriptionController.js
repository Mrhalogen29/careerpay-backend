import subscriptionService, {
  MODULE_PRICES,
} from "../services/subscriptionService.js";
import subscriptionPurchaseService from "../services/subscriptionPurchaseService.js";

class SubscriptionController {
  /**
   * PUBLIC: start a payment before sign-up
   * POST /api/subscriptions/purchase/initiate   Body: { modules, currency, email }
   */
  async initiatePurchase(req, res) {
    try {
      // Pick ONLY these fields. Never pass the whole body through, or a
      // visitor could set prefix/company themselves.
      const { modules, currency, email } = req.body || {};
      const result = await subscriptionPurchaseService.initiate({
        modules,
        currency,
        email,
      });
      res.status(200).json({
        success: true,
        message: "Payment initiated. Complete payment at the provided URL.",
        data: result,
      });
    } catch (error) {
      console.error("Initiate purchase error:", error.message);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to initiate payment",
      });
    }
  }

  /**
   * PUBLIC: confirm a payment made before sign-up
   * POST /api/subscriptions/purchase/verify   Body: { reference }
   */
  async verifyPurchase(req, res) {
    try {
      const { reference } = req.body || {};
      if (!reference || typeof reference !== "string") {
        return res.status(400).json({
          success: false,
          message: "Payment reference is required",
        });
      }
      const result = await subscriptionPurchaseService.verify(reference);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      console.error("Verify purchase error:", error.message);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to verify payment",
      });
    }
  }

  /**
   * Logged-in founder/admin: pay for one or more modules in one payment
   * POST /api/subscriptions/initiate   Body: { modules, currency }
   */
  async initiateBundle(req, res) {
    try {
      const { modules, currency } = req.body || {};
      const result = await subscriptionPurchaseService.initiate({
        modules,
        currency,
        email: req.user.email,
        prefix: "SUBM",
        company: req.user.company,
        createdBy: req.user.id,
      });
      res.status(200).json({
        success: true,
        message: "Payment initiated. Complete payment at the provided URL.",
        data: result,
      });
    } catch (error) {
      console.error("Initiate bundle error:", error.message);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to initiate payment",
      });
    }
  }

  async getPricing(req, res) {
    try {
      const exchangeRate = await subscriptionService.getExchangeRate();

      const pricing = {
        exchangeRate,
        modules: Object.fromEntries(
          Object.entries(MODULE_PRICES).map(([name, usd]) => [
            name,
            { usd, ngn: Math.round(usd * exchangeRate) },
          ]),
        ),
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
   * Initiate subscription payment (single module)
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
        userId,
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

      // Multi-module payments (SUBM-). Single-module SUB- payments continue below.
      if (reference.startsWith("SUBM-")) {
        const result = await subscriptionPurchaseService.verifyAndClaim(
          reference,
          companyId,
          userId,
        );
        return res.status(200).json({
          success: true,
          message: "Subscription activated successfully",
          data: result,
        });
      }

      const subscription = await subscriptionService.verifyAndActivate(
        reference,
        companyId,
        userId,
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

      const result =
        await subscriptionService.getCompanySubscriptions(companyId);

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
        module,
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

  /**
   * Which modules does the company have? (flags only, safe for any role)
   * GET /api/subscriptions/access
   */
  async getAccess(req, res) {
    try {
      const { summary } = await subscriptionService.getCompanySubscriptions(
        req.user.company,
      );

      res.status(200).json({
        success: true,
        data: {
          payroll: summary.payroll.status === "active",
          financing: summary.financing.status === "active",
          esop: summary.esop.status === "active",
        },
      });
    } catch (error) {
      console.error("Get access error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch access",
      });
    }
  }
}

export default new SubscriptionController();
