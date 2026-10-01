import * as flutterwave from "./flutterwave.js";
import * as monnify from "./monnify.js";

// Gateway registry — add new gateways here
const gateways = {
  flutterwave,
  monnify,
};

// Priority order — first gateway is tried first, rest are fallbacks
export const GATEWAY_PRIORITY = ["flutterwave", "monnify"];

export default gateways;