/*
  POST /api/payments/create-order
  "Pay now" on the cart page: starts a Razorpay payment for the logged-in customer's checkout.

  The browser sends the milk plan's order and / or the one-time items' order (place_order()'s details: what
  is bought, the coupon code, the address) and the total the customer saw:
    { planOrder, itemsOrder, shownTotal }
  1. The database prices them and saves them as orders awaiting payment (start_checkout). If its total is
     not the one the customer saw, nothing is saved: 409 with reason "prices", and the cart takes today's
     prices. A product sold out or a coupon that no longer works: 409 with that reason and message.
  2. Razorpay gets an order for exactly that amount in paise, and the database links the two (secret key).
  Answers { razorpayOrderId, amount, currency, keyId, orders }.
  Test mode only: see the safety lock in lib/payments/razorpay-server.ts.
*/

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRazorpayOrder, getRazorpayKeys } from "@/lib/payments/razorpay-server";

type StartedCheckout = { checkoutId: string; amountPaise: number; orders: unknown[] };

export async function POST(request: Request) {
  const razorpayKeys = getRazorpayKeys();
  if ("problem" in razorpayKeys) return Response.json({ error: razorpayKeys.problem }, { status: 503 });

  const details = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!details || (!details.planOrder && !details.itemsOrder)) {
    return Response.json({ error: "Your cart could not be read. Please refresh and try again." }, { status: 400 });
  }

  // The customer's own login (from their cookies): the database knows who is ordering
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return Response.json({ error: "Please log in again to pay.", reason: "login" }, { status: 401 });

  // 1. Priced and saved by the database, awaiting payment
  const started = await supabase.rpc("start_checkout", {
    details: { planOrder: details.planOrder ?? null, itemsOrder: details.itemsOrder ?? null, shownTotal: details.shownTotal },
  });
  if (started.error || !started.data) {
    const hint = started.error?.hint;
    const reason = hint === "prices" || hint === "unavailable" || hint === "coupon" ? hint : undefined;
    const message = started.error?.code === "P0001" && started.error.message ? started.error.message : "We could not save your order. Please try again.";
    return Response.json({ error: message, reason }, { status: reason ? 409 : 400 });
  }
  const checkout = started.data as StartedCheckout;

  // 2. The Razorpay order for exactly that amount, linked to our orders
  try {
    const razorpayOrder = await createRazorpayOrder(razorpayKeys.keys, {
      amountPaise: checkout.amountPaise,
      receipt: checkout.checkoutId.slice(0, 40),
      notes: { checkout_id: checkout.checkoutId },
    });
    const linked = await createAdminClient().rpc("attach_razorpay_order", {
      p_checkout_id: checkout.checkoutId,
      p_razorpay_order_id: razorpayOrder.id,
    });
    if (linked.error) throw linked.error;
    return Response.json({
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: razorpayKeys.keys.keyId,
      orders: checkout.orders,
    });
  } catch (paymentError) {
    console.error("Could not start the Razorpay payment:", paymentError);
    return Response.json({ error: "We could not start the payment. Please try again." }, { status: 502 });
  }
}
