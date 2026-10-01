import axios from "axios";
import mongoose from "mongoose";
import Subscription from "../models/subscriptionModel.js";
import Audit from "../models/auditModel.js";

// Module pricing in USD
const MODULE_PRICES = {
  payroll: 20,
  financing: 15,
  esop: 20,
};

class SubscriptionService {
  /**
   * Fetch live USD/NGN exchange rate
   */
  async getExchangeRate() {
    try {
      const response = await axios.get(
        `https://v6.exchangerate-api.com/v6/${process.env.EXCHANGE_RATE_API_KEY}/pair/USD/NGN`
      );

      if (response.data.result !== "success") {
        throw new Error("Failed to fetch exchange rate");
      }

      return response.data.conversion_rate;
    } catch (error) {
      throw new Error(`Exchange rate fetch failed: ${error.message}`);
    }
  }

  /**
   * Initiate subscription payment via Flutterwave
   * Returns a Flutterwave payment link for the company to pay
   */
  async initiatePayment(companyId, module, currency, userEmail, userId) {
    try {
      if (!MODULE_PRICES[module]) {
        throw new Error(`Invalid module: ${module}`);
      }

      // Get live exchange rate
      const exchangeRate = await this.getExchangeRate();
      const usdAmount = MODULE_PRICES[module];
      const ngnAmount = Math.round(usdAmount * exchangeRate);

      // Determine amount based on currency
      const chargeAmount = currency === "USD" ? usdAmount : ngnAmount;
      const chargeCurrency = currency === "USD" ? "USD" : "NGN";

      // Generate unique reference
      const reference = `SUB-${module.toUpperCase()}-${companyId}-${Date.now()}`;

      // Create Flutterwave payment link
      const response = await axios.post(
        "https://api.flutterwave.com/v3/payments",
        {
          tx_ref: reference,
          amount: chargeAmount,
          currency: chargeCurrency,
          redirect_url: `${process.env.APP_URL}/subscription/verify?reference=${reference}`,
          customer: {
            email: userEmail,
          },
          meta: {
            companyId: companyId.toString(),
            module,
            usdAmount,
            ngnAmount,
            exchangeRate,
            userId: userId.toString(),
            currency,
            type: "subscription", // distinguishes from payroll transfers in webhook
          },
          customizations: {
            title: "CareerPay Subscription",
            description: `${module.charAt(0).toUpperCase() + module.slice(1)} module — 30 days`,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.data || response.data.status !== "success") {
        throw new Error("Failed to initialize payment");
      }

      return {
        paymentUrl: response.data.data.link,
        reference,
        usdAmount,
        ngnAmount,
        exchangeRate,
        currency,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Verify payment and activate subscription
   * Manual fallback — called if webhook didn't fire
   */
  async verifyAndActivate(reference, companyId, userId) {
    try {
      // Verify payment with Flutterwave
      const response = await axios.get(
        `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${reference}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
          },
        }
      );

      const transaction = response.data.data;

      if (!response.data || response.data.status !== "success" || transaction.status !== "successful") {
        throw new Error("Payment verification failed or payment not successful");
      }

      // Extract metadata saved during initiation
      const {
        module,
        usdAmount,
        ngnAmount,
        exchangeRate,
        companyId: metaCompanyId,
        currency: metaCurrency,
      } = transaction.meta;

      // Ensure reference belongs to this company
      if (metaCompanyId.toString() !== companyId.toString()) {
        throw new Error("Payment reference does not belong to this company");
      }

      // Check if already activated — prevents double activation
      const existing = await Subscription.findOne({
        paymentReference: reference,
      });
      if (existing) {
        throw new Error("This payment reference has already been used");
      }

      // Activate subscription
      const subscription = await this.activateSubscription({
        companyId,
        module,
        usdAmount,
        ngnAmount,
        exchangeRate,
        currency: metaCurrency,
        reference,
        transactionId: transaction.id.toString(),
        userId,
      });

      return subscription;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Activate or renew subscription
   * Shared between verifyAndActivate and webhook handler
   */
  async activateSubscription({
    companyId,
    module,
    usdAmount,
    ngnAmount,
    exchangeRate,
    currency,
    reference,
    transactionId,
    userId,
  }) {
    const session = await mongoose.startSession();
    let subscription;

    try {
      session.startTransaction();

      // Check for existing active subscription (renewal scenario)
      const activeSubscription = await Subscription.findOne({
        company: companyId,
        module,
        status: "active",
        endDate: { $gt: new Date() },
      }).session(session);

      let startDate;
      if (activeSubscription) {
        // Renewal — start from current end date so no days are lost
        startDate = activeSubscription.endDate;
        activeSubscription.status = "expired";
        await activeSubscription.save({ session });
      } else {
        // New subscription — start now
        startDate = new Date();
      }

      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 30);

      const created = await Subscription.create(
        [
          {
            company: companyId,
            module,
            status: "active",
            startDate,
            endDate,
            amount: currency === "USD" ? usdAmount : ngnAmount,
            currency,
            ngnAmount,
            exchangeRate,
            paymentReference: reference,
            transactionId,
            createdBy: userId,
          },
        ],
        { session }
      );

      subscription = created[0];

      await session.commitTransaction();
      session.endSession();
    } catch (txError) {
      await session.abortTransaction();
      session.endSession();
      throw txError;
    }

    // Log audit
    await Audit.log({
      company: companyId,
      user: userId,
      action: "subscription_activated",
      module: "subscription",
      resourceType: "subscription",
      resourceId: subscription._id,
      details: {
        module,
        currency,
        usdAmount,
        ngnAmount,
        exchangeRate,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        reference,
      },
      status: "success",
      severity: "high",
    });

    return subscription;
  }

  /**
   * Get all subscriptions for a company
   */
  async getCompanySubscriptions(companyId) {
    try {
      const now = new Date();

      await Subscription.updateMany(
        {
          company: companyId,
          status: "active",
          endDate: { $lte: now },
        },
        { status: "expired" }
      );

      const subscriptions = await Subscription.find({
        company: companyId,
      })
        .sort({ createdAt: -1 })
        .lean();

      const modules = ["payroll", "financing", "esop"];
      const summary = {};

      for (const mod of modules) {
        const active = subscriptions.find(
          (s) => s.module === mod && s.status === "active"
        );
        summary[mod] = active
          ? {
              status: "active",
              endDate: active.endDate,
              daysRemaining: Math.ceil(
                (new Date(active.endDate) - now) / (1000 * 60 * 60 * 24)
              ),
            }
          : { status: "inactive" };
      }

      return { summary, history: subscriptions };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get subscription status for a specific module
   */
  async getModuleSubscription(companyId, module) {
    try {
      const now = new Date();

      const subscription = await Subscription.findOne({
        company: companyId,
        module,
        status: "active",
        endDate: { $gt: now },
      });

      if (!subscription) {
        return { isActive: false };
      }

      const daysRemaining = Math.ceil(
        (new Date(subscription.endDate) - now) / (1000 * 60 * 60 * 24)
      );

      return {
        isActive: true,
        endDate: subscription.endDate,
        daysRemaining,
        subscription,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Check if company has active subscription for a module
   * Used by requireSubscription middleware
   */
  async hasActiveSubscription(companyId, module) {
    try {
      const now = new Date();
      const subscription = await Subscription.findOne({
        company: companyId,
        module,
        status: "active",
        endDate: { $gt: now },
      });

      return !!subscription;
    } catch (error) {
      return false;
    }
  }
}

export default new SubscriptionService();