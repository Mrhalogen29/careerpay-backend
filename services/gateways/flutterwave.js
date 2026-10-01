import axios from "axios";

/**
 * Initiate a salary transfer via Flutterwave
 * Returns { transferId, reference }
 */
export async function initiateTransfer(transaction) {
  const { amount, currency, bankDetails, paymentReference, attemptCount } = transaction;

  if (!bankDetails.bankCode) {
    throw new Error(
      `Bank code missing for account ${bankDetails.accountNumber}. Update employee bank details.`
    );
  }

  // Append attempt count and test suffix to reference
  const reference =
    process.env.FLUTTERWAVE_ENV === "production"
      ? `${paymentReference}-${attemptCount}`
      : `${paymentReference}-${attemptCount}_PMCK`;

  try {
    const response = await axios.post(
      "https://api.flutterwave.com/v3/transfers",
      {
        account_bank: bankDetails.bankCode,
        account_number: bankDetails.accountNumber,
        amount,
        currency,
        narration: "Salary payment - CareerPay",
        reference,
        callback_url: `${process.env.APP_URL}/api/payroll/payment-webhook`,
        debit_currency: currency,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.data || response.data.status !== "success") {
      throw new Error(
        response.data?.message || "Flutterwave transfer initiation failed"
      );
    }

    return {
      transferId: response.data.data.id.toString(),
      message: response.data.message,
    };
  } catch (error) {
    if (error.response) {
      console.error(
        "Flutterwave error response:",
        JSON.stringify(error.response.data, null, 2)
      );
      console.error(
        "Flutterwave request payload:",
        JSON.stringify(error.config?.data, null, 2)
      );
    }
    throw error;
  }
}

/**
 * Verify transfer status directly from Flutterwave
 * Called by reconciliation worker
 * Returns "SUCCESSFUL", "FAILED", "PENDING", or "NEW"
 */
export async function verifyTransfer(gatewayTransferId) {
  try {
    const response = await axios.get(
      `https://api.flutterwave.com/v3/transfers/${gatewayTransferId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
        },
      }
    );

    return response.data.data.status;
  } catch (error) {
    console.error(
      "Flutterwave verifyTransfer error:",
      error.response?.data || error.message
    );
    throw error;
  }
}