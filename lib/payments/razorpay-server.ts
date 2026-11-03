/*
  Server-side Razorpay helpers, shared by the payment routes in app/api/payments/. Reads the keys from
  .env.local (on Vercel: the project's environment variables). The key secret is only ever used here, on
  the server. Talks to Razorpay's API directly (https://api.razorpay.com/v1), so no extra npm package.

  Safety lock (test mode only): if the key id does not start with "rzp_test_", no payment is created, so a
  live key put in .env.local by mistake can never charge real money. Remove this lock on purpose when the
  site goes live.
*/

import { createHmac, timingSafeEqual } from "node:crypto";

export type RazorpayKeys = { keyId: string; keySecret: string };

// A Razorpay payment, as its API describes it (only what we use)
export type RazorpayPayment = { id: string; order_id: string; status: string; amount: number; error_description?: string | null };

// The keys, or a plain-English reason they cannot be used
export function getRazorpayKeys(): { keys: RazorpayKeys } | { problem: string } {
  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";
  if (!keyId || !keySecret) return { problem: "Payments are not set up yet. Please try again later." };
  if (!keyId.startsWith("rzp_test_")) return { problem: "Live payments are switched off." };
  return { keys: { keyId, keySecret } };
}

// One call to Razorpay's API with the key id and secret (Basic auth). Throws Razorpay's own error message.
async function callRazorpay<Answer>(keys: RazorpayKeys, path: string, body?: unknown): Promise<Answer> {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString("base64")}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const answer = (await response.json().catch(() => null)) as (Answer & { error?: { description?: string } }) | null;
  if (!response.ok || !answer) throw new Error(answer?.error?.description ?? `Razorpay answered ${response.status}`);
  return answer;
}

// A Razorpay order for exactly this amount (paise); its id goes to the pop-up and to our orders
export function createRazorpayOrder(keys: RazorpayKeys, details: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
  return callRazorpay<{ id: string; amount: number; currency: string }>(keys, "/orders", {
    amount: details.amountPaise,
    currency: "INR",
    receipt: details.receipt,
    notes: details.notes,
  });
}

// A payment as Razorpay knows it (used to check a "failed" report from the browser)
export function fetchRazorpayPayment(keys: RazorpayKeys, paymentId: string) {
  return callRazorpay<RazorpayPayment>(keys, `/payments/${encodeURIComponent(paymentId)}`);
}

// Gives a captured payment's money back in full (the Payments page's Refund, owner only)
export function refundRazorpayPayment(keys: RazorpayKeys, paymentId: string) {
  return callRazorpay<{ id: string; amount: number; status: string }>(keys, `/payments/${encodeURIComponent(paymentId)}/refund`, { speed: "normal" });
}

// HMAC-SHA256 of text with a secret, compared with a signature in constant time (no hints from timing)
export function isSignatureGenuine(text: string, signature: string, secret: string) {
  const expected = Buffer.from(createHmac("sha256", secret).update(text).digest("hex"), "utf8");
  const received = Buffer.from(signature, "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
