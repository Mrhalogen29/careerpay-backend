import axios from "axios";

// Cache access token so we don't fetch a new one for every transfer
let cachedToken = null;
let tokenExpiresAt = null;

/**
 * Get Monnify access token
 * Tokens are cached until they expire
 */
async function getAccessToken() {
  // Return cached token if still valid
  if (cachedToken && tokenExpiresAt && new Date() < tokenExpiresAt) {
    return cachedToken;
  }

  const credentials = Buffer.from(
    `${process.env.MONNIFY_API_KEY}:${process.env.MONNIFY_SECRET_KEY}`,
  ).toString("base64");

  const response = await axios.post(
    `${process.env.MONNIFY_BASE_URL}/api/v1/auth/login`,
    {},
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.data?.requestSuccessful) {
    throw new Error("Monnify authentication failed");
  }

  cachedToken = response.data.responseBody.accessToken;

  // Monnify tokens expire after 1 hour — cache for 55 minutes to be safe
  tokenExpiresAt = new Date(Date.now() + 55 * 60 * 1000);

  return cachedToken;
}

/**
 * Initiate a salary transfer via Monnify
 * Returns { transferId, reference }
 */
export async function initiateTransfer(transaction) {
  const { amount, currency, bankDetails, paymentReference, attemptCount } =
    transaction;

  if (!bankDetails.bankCode) {
    throw new Error(
      `Bank code missing for account ${bankDetails.accountNumber}. Update employee bank details.`,
    );
  }

  // Append attempt count to reference to avoid duplicate reference errors on retry
  const reference = `${paymentReference}-${attemptCount}`;

  try {
    const token = await getAccessToken();

    const response = await axios.post(
      `${process.env.MONNIFY_BASE_URL}/api/v2/disbursements/single`,
      {
        amount,
        reference,
        narration: "Salary payment - CareerPay",
        destinationBankCode: bankDetails.bankCode,
        destinationAccountNumber: bankDetails.accountNumber,
        destinationAccountName: bankDetails.accountName,
        currency,
        sourceAccountNumber: process.env.MONNIFY_WALLET_ACCOUNT,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.data?.requestSuccessful) {
      throw new Error(
        response.data?.responseMessage || "Monnify transfer initiation failed",
      );
    }

    return {
      transferId: response.data.responseBody.reference,
      message: response.data.responseMessage,
    };
  } catch (error) {
    if (error.response) {
      console.error(
        "Monnify error response:",
        JSON.stringify(error.response.data, null, 2),
      );
      console.error(
        "Monnify request payload:",
        JSON.stringify(error.config?.data, null, 2),
      );
    }
    throw error;
  }
}

/**
 * Verify transfer status directly from Monnify
 * Called by reconciliation worker
 * Returns "SUCCESSFUL", "FAILED", or "PENDING"
 */
export async function verifyTransfer(gatewayTransferId) {
  const token = await getAccessToken();

  const response = await axios.get(
    `${process.env.MONNIFY_BASE_URL}/api/v2/disbursements/single/summary`,
    {
      params: { reference: gatewayTransferId },
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  // Normalize Monnify status to match Flutterwave format
  const monnifyStatus = response.data.responseBody?.status;

  const statusMap = {
    SUCCESS: "SUCCESSFUL",
    FAILED: "FAILED",
    PENDING: "PENDING",
    OTP_SENT: "PENDING",
    PENDING_AUTHORIZATION: "PENDING",
  };

  return statusMap[monnifyStatus] || "PENDING";
}
