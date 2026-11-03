/*
  POST /api/payments/refund
  The Chiranvi Panel's Payments page → Refund on a Razorpay payment: { razorpayOrderId, razorpayPaymentId }.
  Only the owner may refund (checked by the database with their own login). The server asks Razorpay for the
  payment first: it must belong to that Razorpay order and have been taken ("captured"). Then Razorpay gives
  the whole amount back, and the database marks the order(s) refunded and cancelled (mark_checkout_refunded,
  secret key). Replies { refunded: true, refundId } or { refunded: false, error }.
  Test mode only: see the safety lock in lib/payments/razorpay-server.ts.
*/

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchRazorpayPayment, getRazorpayKeys, refundRazorpayPayment } from "@/lib/payments/razorpay-server";

export async function POST(request: Request) {
  const razorpayKeys = getRazorpayKeys();
  if ("problem" in razorpayKeys) return Response.json({ refunded: false, error: razorpayKeys.problem }, { status: 503 });

  const requestBody = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const orderId = requestBody?.razorpayOrderId;
  const paymentId = requestBody?.razorpayPaymentId;
  if (typeof orderId !== "string" || typeof paymentId !== "string" || !/^pay_\w+$/.test(paymentId)) {
    return Response.json({ refunded: false, error: "The payment details are missing." }, { status: 400 });
  }

  // Only the owner gives money back (the database knows who is logged in from their cookies)
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("is_owner");
  if (isOwner !== true) return Response.json({ refunded: false, error: "Only the owner can refund a payment." }, { status: 403 });

  try {
    const payment = await fetchRazorpayPayment(razorpayKeys.keys, paymentId);
    if (payment.order_id !== orderId) return Response.json({ refunded: false, error: "This payment doesn't belong to that order." }, { status: 409 });
    if (payment.status !== "captured") {
      return Response.json({ refunded: false, error: `This payment can't be refunded (it is ${payment.status}).` }, { status: 409 });
    }
    const refund = await refundRazorpayPayment(razorpayKeys.keys, paymentId);
    const marked = await createAdminClient().rpc("mark_checkout_refunded", { p_razorpay_order_id: orderId, p_razorpay_refund_id: refund.id });
    if (marked.error) throw marked.error;
    return Response.json({ refunded: true, refundId: refund.id });
  } catch (refundError) {
    console.error("Could not refund the payment", paymentId, refundError);
    const message = refundError instanceof Error && refundError.message ? refundError.message : "Please try again.";
    return Response.json({ refunded: false, error: `Couldn't refund: ${message}` }, { status: 502 });
  }
}
