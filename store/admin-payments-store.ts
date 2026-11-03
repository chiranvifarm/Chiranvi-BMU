import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";

/*
  Payments seen in the Chiranvi Panel (Payments page, and the money on Reports and Coupons & offers), from
  the database (panel_payments(), supabase/migrations/0017_panel_payments.sql). No wallet: money comes in
  for orders and subscription plans, and goes out as refunds.
  - Online payments (Razorpay): one line per payment, Success or Failed, with its order numbers; a refunded
    one also has a Refund line. Refund gives the money back through Razorpay (owner only,
    app/api/payments/refund) and cancels the order(s).
  - Recorded by hand (Record payment: cash at the door, a bank transfer, a refund given by hand): saved in
    the manual_payments table; Refund on one of these records the refund by hand.
  A failed online payment is retried by the customer from their cart (nothing to do here).
  Read when first needed, again when the window comes back into focus, and after every change.
*/

export type PaymentType = "Order" | "Subscription" | "Refund";
// Net banking: paid on the website (no cash on delivery there); Cash: recorded in the panel
export type PaymentMethod = "UPI" | "Net banking" | "Card" | "Cash";
export type PaymentStatus = "Success" | "Failed";

export type AdminPayment = {
  id: string; // pay_… (online), TXN90001 (recorded by hand)
  paidAt: string; // ISO date and time
  customerName: string;
  area: string;
  type: PaymentType;
  method: PaymentMethod;
  amount: number; // money in is positive, refunds are negative
  status: PaymentStatus;
  websiteOrderId?: string; // paid on the website: its order number(s)
  isOnline: boolean; // Razorpay (false: recorded by hand)
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  isRefunded?: boolean; // an online payment already refunded
  failureReason?: string; // Razorpay's reason, on a failed payment
};

export const PAYMENT_METHODS: PaymentMethod[] = ["UPI", "Net banking", "Card", "Cash"];

type PaymentLine = Omit<AdminPayment, "paidAt"> & { paidAt: number };

const EMPTY: AdminPayment[] = [];
let payments: AdminPayment[] = EMPTY;
let isFollowing = false;
const listeners = new Set<() => void>();

async function loadPayments() {
  const supabase = createClient();
  // Payments are for the team: nobody logged in → nothing to read
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return;
  const { data, error } = await supabase.rpc("panel_payments");
  if (error) {
    // Not allowed (no Payments → View): an empty list, not an error
    if (error.code !== "P0001") console.error("Could not read the payments:", error.message || error.code);
    payments = EMPTY;
  } else {
    payments = ((data ?? []) as PaymentLine[]).map((line) => ({ ...line, paidAt: new Date(line.paidAt).toISOString(), amount: Number(line.amount) }));
  }
  listeners.forEach((onChange) => onChange());
}

function startFollowingPayments() {
  if (isFollowing || typeof window === "undefined") return;
  isFollowing = true;
  void loadPayments();
  window.addEventListener("focus", () => void loadPayments());
  createClient().auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") window.setTimeout(() => void loadPayments(), 0);
  });
}

// Money received or given back by hand (cash at the door, a bank transfer…). Answers the new line, or a problem.
export async function recordPayment(
  payment: Pick<AdminPayment, "customerName" | "area" | "type" | "method" | "amount">,
  recordedBy: string,
): Promise<AdminPayment | { error: string }> {
  const { data, error } = await createClient()
    .from("manual_payments")
    .insert({
      customer_name: payment.customerName,
      area: payment.area,
      payment_type: payment.type,
      method: payment.method,
      amount_paise: Math.round(payment.amount * 100),
      recorded_by: recordedBy,
    })
    .select("payment_number, recorded_at")
    .single();
  if (error || !data) {
    console.error("The database did not accept the payment", error);
    return { error: "Couldn't record the payment. You may not be allowed to (Payments → Create)." };
  }
  void loadPayments();
  return { ...payment, id: data.payment_number, paidAt: data.recorded_at, status: "Success", isOnline: false };
}

/*
  Refund: an online payment goes back through Razorpay (the owner only; the order(s) are cancelled); a payment
  recorded by hand gets a refund line recorded by hand. Answers null, or the problem to show.
*/
export async function refundPayment(payment: AdminPayment, recordedBy: string): Promise<string | null> {
  if (payment.isOnline) {
    const reply = (await fetch("/api/payments/refund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ razorpayOrderId: payment.razorpayOrderId, razorpayPaymentId: payment.razorpayPaymentId }),
    })
      .then((response) => response.json())
      .catch(() => null)) as { refunded?: boolean; error?: string } | null;
    if (!reply?.refunded) return reply?.error ?? "Couldn't refund. Check your internet and try again.";
    await loadPayments();
    return null;
  }
  const refund = await recordPayment(
    { customerName: payment.customerName, area: payment.area, type: "Refund", method: payment.method, amount: -Math.abs(payment.amount) },
    recordedBy,
  );
  return "error" in refund ? refund.error : null;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  startFollowingPayments();
  return () => {
    listeners.delete(onChange);
  };
}

export function useAdminPayments() {
  return useSyncExternalStore(subscribe, () => payments, () => EMPTY);
}
