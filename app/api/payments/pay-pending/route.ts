/*
  POST /api/payments/pay-pending
  Pays the pending amount of a pay-later order, from Billing & payment.
    - { orderNumber }                                   -> makes a Razorpay order for the amount still due and
                                                           links it to the pay-later order(s); answers { razorpayOrderId, amount, currency, keyId }.
    - { razorpay_order_id, razorpay_payment_id, razorpay_signature }
                                                        -> checks the signature and marks the order(s) paid
                                                           (mark_pay_later_paid), keeping the plan's dates.
  Test mode only: see the safety lock in lib/payments/razorpay-server.ts.
*/

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRazorpayOrder, getRazorpayKeys, isSignatureGenuine } from "@/lib/payments/razorpay-server";

export async function POST(request: Request) {
  const razorpayKeys = getRazorpayKeys();
  if ("problem" in razorpayKeys) return Response.json({ error: razorpayKeys.problem }, { status: 503 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Please try again." }, { status: 400 });

  // Confirm a finished payment
  if (typeof body.razorpay_signature === "string") {
    const orderId = body.razorpay_order_id;
    const paymentId = body.razorpay_payment_id;
    if (typeof orderId !== "string" || typeof paymentId !== "string") {
      return Response.json({ verified: false, error: "The payment details are missing." }, { status: 400 });
    }
    if (!isSignatureGenuine(`${orderId}|${paymentId}`, body.razorpay_signature, razorpayKeys.keys.keySecret)) {
      console.error("Pay-later signature did not match for payment", paymentId);
      return Response.json({ verified: false, error: "The payment could not be confirmed." }, { status: 400 });
    }
    const paid = await createAdminClient().rpc("mark_pay_later_paid", { p_razorpay_order_id: orderId, p_razorpay_payment_id: paymentId });
    if (paid.error || !paid.data) {
      console.error("Could not mark the pay-later payment", paymentId, paid.error);
      return Response.json({ verified: false, error: "The payment could not be confirmed." }, { status: 500 });
    }
    return Response.json({ verified: true, orders: paid.data });
  }

  // Start a payment for the pending amount
  const orderNumber = body.orderNumber;
  if (typeof orderNumber !== "string") return Response.json({ error: "Which order?" }, { status: 400 });

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return Response.json({ error: "Please log in again to pay.", reason: "login" }, { status: 401 });

  const amount = await supabase.rpc("pay_later_amount", { p_order_number: orderNumber });
  if (amount.error || !amount.data) {
    return Response.json({ error: amount.error?.message || "No pending amount for this order." }, { status: 400 });
  }
  const pending = amount.data as { checkoutId: string; amountPaise: number };

  try {
    const razorpayOrder = await createRazorpayOrder(razorpayKeys.keys, {
      amountPaise: pending.amountPaise,
      receipt: pending.checkoutId.slice(0, 40),
      notes: { checkout_id: pending.checkoutId, pay_later: "1" },
    });
    const linked = await createAdminClient().rpc("attach_pay_later_razorpay", {
      p_checkout_id: pending.checkoutId,
      p_razorpay_order_id: razorpayOrder.id,
    });
    if (linked.error) throw linked.error;
    return Response.json({
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: razorpayKeys.keys.keyId,
    });
  } catch (paymentError) {
    console.error("Could not start the pay-later payment:", paymentError);
    return Response.json({ error: "We could not start the payment. Please try again." }, { status: 502 });
  }
}
