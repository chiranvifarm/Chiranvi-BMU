/*
  POST /api/payments/failed
  The Razorpay pop-up told the cart a payment failed: { razorpay_order_id, razorpay_payment_id }.
  The browser's word is not enough, so the server asks Razorpay for that payment. Only if Razorpay says it
  failed, and it belongs to that Razorpay order, does the database mark the checkout's order(s) "payment
  failed" (with Razorpay's reason), so the customer gets a "Payment failed" receipt in My Orders.
  Replies { recorded: true } or { recorded: false, error }.
  Test mode only: see the safety lock in lib/payments/razorpay-server.ts.
*/

import { fetchRazorpayPayment, getRazorpayKeys } from "@/lib/payments/razorpay-server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const razorpayKeys = getRazorpayKeys();
  if ("problem" in razorpayKeys) return Response.json({ recorded: false, error: razorpayKeys.problem }, { status: 503 });

  const requestBody = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const orderId = requestBody?.razorpay_order_id;
  const paymentId = requestBody?.razorpay_payment_id;
  if (typeof orderId !== "string" || typeof paymentId !== "string" || !/^pay_\w+$/.test(paymentId)) {
    return Response.json({ recorded: false, error: "The payment details are missing." }, { status: 400 });
  }

  try {
    const payment = await fetchRazorpayPayment(razorpayKeys.keys, paymentId);
    if (payment.order_id !== orderId || payment.status !== "failed") {
      return Response.json({ recorded: false, error: "This payment did not fail." }, { status: 409 });
    }
    const failed = await createAdminClient().rpc("mark_checkout_failed", {
      p_razorpay_order_id: orderId,
      p_razorpay_payment_id: paymentId,
      p_reason: payment.error_description ?? "",
    });
    if (failed.error) throw failed.error;
    return Response.json({ recorded: true });
  } catch (recordError) {
    console.error("Could not record the failed payment", paymentId, recordError);
    return Response.json({ recorded: false, error: "Could not record the failed payment." }, { status: 502 });
  }
}
