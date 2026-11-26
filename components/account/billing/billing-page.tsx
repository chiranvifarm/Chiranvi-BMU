"use client";

import { useEffect, useState } from "react";
import { confirmPayLaterPayment, startPayLaterPayment, useOrdersAndFailedPayments, type Order } from "@/store/orders-store";
import { AccountPageHeading } from "../account-dashboard-layout";
import OrderReceiptDialog from "../orders/order-receipt-dialog";
import styles from "./billing-page.module.css";

/*
  "Billing & payment" dashboard page. One row per order:
    - Pay-later order (payment still due by the plan's last day) -> "Pay now" opens Razorpay (pay-pending route).
    - Paid order                                                 -> "View receipt" opens the same receipt pop-up My Orders uses.
*/

type RazorpaySuccess = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
const RAZORPAY_SRC = "https://checkout.razorpay.com/v1/checkout.js";

function loadRazorpay() {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const existing = document.querySelector(`script[src="${RAZORPAY_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(Boolean(window.Razorpay)));
      return;
    }
    const script = document.createElement("script");
    script.src = RAZORPAY_SRC;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function formatOrderDate(time: number) {
  return new Date(time).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDueDate(day: string) {
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function describeOrderItems(order: Order) {
  return order.items.map((orderItem) => (orderItem.quantity > 1 ? `${orderItem.name} × ${orderItem.quantity}` : orderItem.name)).join(", ");
}

export default function BillingPage() {
  const orders = useOrdersAndFailedPayments().filter((order) => order.paymentStatus !== "failed");
  const [billOrderId, setBillOrderId] = useState<string | null>(null);
  const billOrder = orders.find((order) => order.orderId === billOrderId);
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const [payError, setPayError] = useState("");

  // Opened from an order's link (/account/billing?bill=CF-xxxx): show that order's receipt
  useEffect(() => {
    const bill = new URLSearchParams(window.location.search).get("bill");
    if (bill) setBillOrderId(bill);
  }, []);

  async function payNow(order: Order) {
    if (payingOrderId) return;
    setPayError("");
    setPayingOrderId(order.orderId);
    const isReady = await loadRazorpay();
    if (!isReady || !window.Razorpay) {
      setPayingOrderId(null);
      setPayError("We couldn't reach the payment service. Please check your internet and try again.");
      return;
    }
    const started = await startPayLaterPayment(order.orderId);
    if ("error" in started) {
      setPayingOrderId(null);
      setPayError(started.error);
      return;
    }
    const popup = new window.Razorpay({
      key: started.keyId,
      order_id: started.razorpayOrderId,
      amount: started.amount,
      currency: started.currency,
      name: "Chiranvi Farm",
      description: `Pending amount · ${order.orderId}`,
      theme: { color: "#2F6B3F" },
      handler: async (success: RazorpaySuccess) => {
        const result = await confirmPayLaterPayment(success);
        setPayingOrderId(null);
        if ("error" in result) setPayError(result.error);
      },
      modal: { ondismiss: () => setPayingOrderId(null) },
    });
    popup.open();
  }

  return (
    <>
      <AccountPageHeading title="Billing & payment" description="Your bills, and any plan you chose to pay later" />

      {payError && <p className={styles["billing-pay-error"]}>{payError}</p>}

      <ul className={styles["billing-list"]}>
        {orders.map((order) => {
          const isPayLater = order.paymentStatus === "pay_later";
          return (
            <li key={order.orderId} className={`${styles["billing-row"]} ${isPayLater ? styles["billing-row-due"] : ""}`}>
              <div className={styles["billing-row-info"]}>
                <h2 className={styles["billing-row-title"]}>{describeOrderItems(order)}</h2>
                <p className={styles["billing-row-sub"]}>
                  Order {order.orderId} · {formatOrderDate(order.placedAt)}
                </p>
                {isPayLater ? (
                  <p className={styles["billing-amount-due"]}>
                    ₹{order.total.toLocaleString("en-IN")} due{order.paymentDueBy ? ` · pay by ${formatDueDate(order.paymentDueBy)}` : ""}
                  </p>
                ) : (
                  <p className={styles["billing-amount-paid"]}>₹{order.total.toLocaleString("en-IN")} paid</p>
                )}
              </div>
              {isPayLater ? (
                <button
                  type="button"
                  className={styles["billing-pay-now-button"]}
                  onClick={() => void payNow(order)}
                  disabled={payingOrderId === order.orderId}
                >
                  {payingOrderId === order.orderId ? "Opening…" : "Pay now"}
                </button>
              ) : (
                <button type="button" className={styles["billing-view-bill-button"]} onClick={() => setBillOrderId(order.orderId)}>
                  View receipt
                </button>
              )}
            </li>
          );
        })}

        {orders.length === 0 && <li className={styles["billing-empty"]}>No bills yet. Your orders and plans will show here.</li>}
      </ul>

      {billOrder && <OrderReceiptDialog order={billOrder} onClose={() => setBillOrderId(null)} />}
    </>
  );
}
