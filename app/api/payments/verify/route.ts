/*
  POST /api/payments/verify
  Checks that a Razorpay payment really happened before the cart shows "Your order has been placed".

  After a successful payment the Razorpay pop-up gives the browser three values, which it sends here:
    { razorpay_order_id, razorpay_payment_id, razorpay_signature }
  Razorpay made the signature with our key secret, so only Razorpay could have made it. The server makes the
  same signature itself (HMAC-SHA256 of "order_id|payment_id" with the key secret) and compares the two.
  Only when they match does the database mark the checkout's order(s) paid (mark_checkout_paid, secret key),
  which also counts the coupon use. Replies { verified: true, orders } or { verified: false, error }.
  (If the customer closes the tab before this, Razorpay's webhook marks the order(s) paid instead:
  app/api/payments/webhook.)
  Test mode only: see the safety lock in lib/payments/razorpay-server.ts.
*/

import { getRazorpayKeys, isSignatureGenuine } from "@/lib/payments/razorpay-server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const razorpayKeys = getRazorpayKeys();
  if ("problem" in razorpayKeys) return Response.json({ verified: false, error: razorpayKeys.problem }, { status: 503 });

  const requestBody = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const orderId = requestBody?.razorpay_order_id;
  const paymentId = requestBody?.razorpay_payment_id;
  const signature = requestBody?.razorpay_signature;
  if (typeof orderId !== "string" || typeof paymentId !== "string" || typeof signature !== "string") {
    return Response.json({ verified: false, error: "The payment details are missing." }, { status: 400 });
  }

  if (!isSignatureGenuine(`${orderId}|${paymentId}`, signature, razorpayKeys.keys.keySecret)) {
    console.error("Razorpay signature did not match for payment", paymentId);
    return Response.json({ verified: false, error: "The payment could not be confirmed." }, { status: 400 });
  }

  // Genuine: the order(s) become paid in the database
  const paid = await createAdminClient().rpc("mark_checkout_paid", {
    p_razorpay_order_id: orderId,
    p_razorpay_payment_id: paymentId,
  });
  if (paid.error || !paid.data) {
    console.error("The database could not mark the payment", paymentId, paid.error);
    return Response.json({ verified: false, error: "The payment could not be confirmed." }, { status: 500 });
  }
  return Response.json({ verified: true, orders: paid.data });
}
