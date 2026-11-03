/*
  POST /api/payments/webhook
  Razorpay calls this by itself after a payment, so an order is marked paid even if the customer closed the
  tab before the cart could confirm it (app/api/payments/verify). Set it up once in the Razorpay Dashboard →
  Webhooks: URL https://<the live site>/api/payments/webhook, events payment.captured, order.paid and
  payment.failed, and a secret that goes into RAZORPAY_WEBHOOK_SECRET.

  Razorpay signs the exact body it sends (HMAC-SHA256 with the webhook secret, header X-Razorpay-Signature);
  anything without a matching signature is refused. Then:
    payment.captured / order.paid   the checkout's order(s) become paid (mark_checkout_paid: safe to run
                                    again, so a payment the cart already confirmed changes nothing)
    payment.failed                  a "Payment failed" receipt for the customer (mark_checkout_failed)
  Other events are answered 200 and ignored. Razorpay retries when it doesn't get a 2xx answer.
*/

import { isSignatureGenuine } from "@/lib/payments/razorpay-server";
import { createAdminClient } from "@/lib/supabase/admin";

type RazorpayWebhook = {
  event?: string;
  payload?: { payment?: { entity?: { id?: string; order_id?: string; error_description?: string | null } } };
};

export async function POST(request: Request) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
  if (!webhookSecret) return Response.json({ error: "Webhook not set up" }, { status: 503 });

  // The signature is made from the body exactly as sent, so it is read as text first
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  if (!signature || !isSignatureGenuine(rawBody, signature, webhookSecret)) {
    return Response.json({ error: "Signature did not match" }, { status: 400 });
  }

  const webhook = JSON.parse(rawBody) as RazorpayWebhook;
  const payment = webhook.payload?.payment?.entity;
  if (!payment?.id || !payment.order_id) return Response.json({ received: true });

  const database = createAdminClient();
  if (webhook.event === "payment.captured" || webhook.event === "order.paid") {
    const paid = await database.rpc("mark_checkout_paid", { p_razorpay_order_id: payment.order_id, p_razorpay_payment_id: payment.id });
    // A Razorpay order that isn't ours (made elsewhere on the same account): nothing to mark
    if (paid.error && !paid.error.message.includes("No order for this payment")) {
      console.error("Webhook could not mark the payment", payment.id, paid.error);
      return Response.json({ error: "Could not record the payment" }, { status: 500 });
    }
  } else if (webhook.event === "payment.failed") {
    const failed = await database.rpc("mark_checkout_failed", {
      p_razorpay_order_id: payment.order_id,
      p_razorpay_payment_id: payment.id,
      p_reason: payment.error_description ?? "",
    });
    if (failed.error) {
      console.error("Webhook could not record the failed payment", payment.id, failed.error);
      return Response.json({ error: "Could not record the failed payment" }, { status: 500 });
    }
  }
  return Response.json({ received: true });
}
