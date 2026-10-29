import axios from "axios";
import crypto from "crypto";
import SubscriptionPurchase from "../models/subscriptionPurchaseModel.js";
import Subscription from "../models/subscriptionModel.js";
import subscriptionService, { MODULE_PRICES } from "./subscriptionService.js";

const VALID_MODULES = Object.keys(MODULE_PRICES);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const flwHeaders = () => ({
  Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
  "Content-Type": "application/json",
});

// Only what the browser is allowed to see
const publicView = (p) => ({
  reference: p.reference,
  email: p.email,
  status: p.status,
  currency: p.currency,
  chargeAmount: p.chargeAmount,
  modules: p.items.map((i) => i.module),
});

class SubscriptionPurchaseService {
  /**
   * Start a payment for one or more modules.
   * - Public (before sign-up): prefix "PUR", no company.
   * - In-app (logged-in founder): prefix "SUBM", company + createdBy set.
   * The controller decides prefix/company. Never pass them from the request body.
   */
  async initiate({
    modules,
    currency,
    email,
    prefix = "PUR",
    company,
    createdBy,
  }) {
    if (!Array.isArray(modules) || modules.length === 0) {
      throw new Error("Choose at least one module");
    }
    const unique = [...new Set(modules)];
    if (unique.some((m) => !VALID_MODULES.includes(m))) {
      throw new Error("Invalid module selected");
    }
    if (!["USD", "NGN"].includes(currency)) {
      throw new Error("Currency must be USD or NGN");
    }
    if (!email || !EMAIL_RE.test(String(email))) {
      throw new Error("A valid email address is required");
    }

    const exchangeRate = await subscriptionService.getExchangeRate();
    const items = unique.map((m) => ({
      module: m,
      usdAmount: MODULE_PRICES[m],
      ngnAmount: Math.round(MODULE_PRICES[m] * exchangeRate),
    }));
    const chargeAmount = items.reduce(
      (sum, i) => sum + (currency === "USD" ? i.usdAmount : i.ngnAmount),
      0,
    );
    const reference = `${prefix}-${crypto.randomBytes(12).toString("hex")}`;

    const purchase = await SubscriptionPurchase.create({
      reference,
      email: String(email).toLowerCase().trim(),
      items,
      currency,
      chargeAmount,
      exchangeRate,
      company,
      createdBy,
    });

    try {
      const response = await axios.post(
        "https://api.flutterwave.com/v3/payments",
        {
          tx_ref: reference,
          amount: chargeAmount,
          currency,
          redirect_url: `${process.env.APP_URL}/subscription/verify?reference=${reference}`,
          customer: { email: purchase.email },
          meta: { type: "subscription_purchase", purchaseRef: reference },
          customizations: {
            title: "CareerPay Subscription",
            description: `${unique.join(", ")} — 30 days`,
          },
        },
        { headers: flwHeaders() },
      );

      if (!response.data || response.data.status !== "success") {
        throw new Error("Failed to initialize payment");
      }

      return {
        paymentUrl: response.data.data.link,
        reference,
        items,
        currency,
        chargeAmount,
        exchangeRate,
      };
    } catch (error) {
      console.error(
        "Purchase initiate error:",
        error.response?.data || error.message,
      );
      await SubscriptionPurchase.deleteOne({
        _id: purchase._id,
        status: "pending",
      });
      throw new Error("Could not start the payment. Please try again.");
    }
  }

  /**
   * Confirm a payment with Flutterwave and mark the purchase as paid.
   * Safe to call more than once.
   */
  async verify(reference) {
    const purchase = await SubscriptionPurchase.findOne({ reference });
    if (!purchase) throw new Error("Payment reference not found");

    if (purchase.status === "claimed") {
      throw new Error(
        "This payment has already been used to create an account",
      );
    }
    if (purchase.status === "paid") return publicView(purchase);

    let tx;
    try {
      const response = await axios.get(
        `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
        { headers: flwHeaders() },
      );
      if (response.data?.status !== "success") throw new Error("not found");
      tx = response.data.data;
    } catch {
      throw new Error(
        "We could not confirm this payment yet. If you were charged, wait a minute and refresh this page.",
      );
    }

    if (!tx || tx.status !== "successful") {
      throw new Error("Payment was not successful");
    }
    return this.markPaid(purchase, tx);
  }

  /**
   * Shared by verify() and the webhook. Checks the money is right.
   */
  async markPaid(purchase, tx) {
    if (
      tx.currency !== purchase.currency ||
      Number(tx.amount) < purchase.chargeAmount
    ) {
      throw new Error("Payment amount does not match this purchase");
    }

    const updated = await SubscriptionPurchase.findOneAndUpdate(
      { _id: purchase._id, status: "pending" },
      { status: "paid", paidAt: new Date(), transactionId: String(tx.id) },
      { new: true },
    );
    // If the webhook got there first, just return the current state
    return publicView(
      updated || (await SubscriptionPurchase.findById(purchase._id)),
    );
  }

  /**
   * Webhook path: never throws for bad data, so Flutterwave doesn't retry forever.
   */
  async markPaidFromWebhook(reference, tx) {
    try {
      const purchase = await SubscriptionPurchase.findOne({
        reference,
        status: "pending",
      });
      if (!purchase) return;
      await this.markPaid(purchase, tx);

      // In-app purchase: the company is known, so activate right away,
      // even if the buyer closed the tab.
      if (purchase.company) {
        await this.claim(reference, purchase.company, purchase.createdBy, true);
      }
      console.log(`Subscription purchase processed via webhook: ${reference}`);
    } catch (error) {
      console.error("Purchase webhook error:", error.message);
    }
  }

  /**
   * Used by sign-up BEFORE it creates the company, so a bad code fails early.
   */
  async assertClaimable(reference) {
    const purchase = await SubscriptionPurchase.findOne({ reference });
    if (!purchase) throw new Error("Payment reference not found");
    if (purchase.company) {
      throw new Error("This payment belongs to an existing company account");
    }
    if (purchase.status === "claimed") {
      throw new Error(
        "This payment has already been used to create an account",
      );
    }
    if (purchase.status !== "paid") {
      throw new Error("This payment has not been completed");
    }
    return purchase;
  }

  /**
   * Turns a paid purchase into real subscriptions. The status flip is atomic,
   * so two requests can never claim the same payment.
   * - Sign-up: inApp = false, only purchases with no owner can be claimed.
   * - In-app:  inApp = true, only the purchase's own company can claim it.
   */
  async claim(reference, companyId, userId, inApp = false) {
    const purchase = await SubscriptionPurchase.findOneAndUpdate(
      { reference, status: "paid", company: inApp ? companyId : null },
      { status: "claimed", claimedBy: companyId, claimedAt: new Date() },
      { new: true },
    );
    if (!purchase) {
      throw new Error(
        "This payment reference is invalid or has already been used",
      );
    }

    try {
      for (const item of purchase.items) {
        const subRef = `${purchase.reference}:${item.module}`;
        // Skip anything already activated by an earlier, interrupted attempt
        if (await Subscription.findOne({ paymentReference: subRef })) continue;

        await subscriptionService.activateSubscription({
          companyId,
          module: item.module,
          usdAmount: item.usdAmount,
          ngnAmount: item.ngnAmount,
          exchangeRate: purchase.exchangeRate,
          currency: purchase.currency,
          reference: subRef,
          transactionId: purchase.transactionId,
          userId,
        });
      }
    } catch (error) {
      // Give the payment back so it can be claimed again
      await SubscriptionPurchase.updateOne(
        { _id: purchase._id },
        { status: "paid", $unset: { claimedBy: "", claimedAt: "" } },
      );
      throw error;
    }

    return purchase;
  }

  /**
   * In-app: confirm the payment and activate the modules for THIS company.
   * Safe to call repeatedly, and safe if the webhook already did it.
   */
  async verifyAndClaim(reference, companyId, userId) {
    const purchase = await SubscriptionPurchase.findOne({ reference });
    if (
      !purchase ||
      !purchase.company ||
      String(purchase.company) !== String(companyId)
    ) {
      throw new Error("Payment reference not found");
    }

    if (purchase.status !== "claimed") {
      if (purchase.status === "pending") await this.verify(reference);
      try {
        await this.claim(reference, companyId, userId, true);
      } catch (error) {
        // The webhook may have claimed it a moment ago
        const again = await SubscriptionPurchase.findOne({ reference });
        if (again?.status !== "claimed") throw error;
      }
    }

    return { reference, modules: purchase.items.map((i) => i.module) };
  }
}

export default new SubscriptionPurchaseService();
