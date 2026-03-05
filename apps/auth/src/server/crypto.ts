/**
 * HMAC-SHA256 signing for OTP session cookies.
 *
 * Signs the payload so it is tamper-proof (not encrypted — the payload
 * is not secret). Cookie value: base64url(payload).base64url(hmac).
 * Uses SESSION_ENCRYPTION_KEY (32 bytes hex) as the HMAC key.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const getKey = (): Buffer => {
  const hex = process.env.SESSION_ENCRYPTION_KEY ?? "";
  if (hex.length !== 64 || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("SESSION_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }
  return Buffer.from(hex, "hex");
};

const hmac = (data: string): string =>
  createHmac("sha256", getKey()).update(data).digest("base64url");

export const sign = (payload: string): string => {
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${hmac(encoded)}`;
};

export const verify = (signed: string): string => {
  const dotIndex = signed.indexOf(".");
  if (dotIndex === -1) throw new Error("Invalid signed cookie");
  const encoded = signed.slice(0, dotIndex);
  const signature = signed.slice(dotIndex + 1);
  const expected = hmac(encoded);
  if (
    expected.length !== signature.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  ) {
    throw new Error("Invalid signature");
  }
  return Buffer.from(encoded, "base64url").toString("utf8");
};
