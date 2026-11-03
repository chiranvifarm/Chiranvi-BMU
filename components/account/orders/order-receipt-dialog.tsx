"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { Order } from "@/store/orders-store";
import styles from "./order-receipt-dialog.module.css";

/*
  My Orders → "Order details": the order's receipt in a pop-up on the same page.
  - Paid:            "Payment successful", the amount received, the payment details and the bill.
  - Payment failed:  "Payment failed", the amount that was not charged, Razorpay's reason, and what
                     happens to money that may have left the account; "Go to cart" to try again.
  - Not charged:     orders placed before online payments were connected ("No online payment").
  The bill: each item (or the milk plan's bottles), item total, coupon, delivery fee, platform fee and the total.
  Escape, the close button or the dimmed page close it; the page behind does not scroll.
*/

const rupees = (amount: number) => `₹${Number(amount.toFixed(2)).toLocaleString("en-IN")}`;

// 1793430529503 -> "31 Oct 2026, 4:08 PM"
function formatDateAndTime(time: number) {
  return new Date(time)
    .toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(/\b(am|pm)\b/, (period) => period.toUpperCase());
}

// "Tomorrow by 7:00 AM" style: the promised morning
function formatPromisedMorning(time: number) {
  const day = new Date(time).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return `${day}, by 7:00 AM`;
}

export default function OrderReceiptDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Latest onClose, so the Escape listener below is set up only once
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    closeButtonRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", closeOnEscape);
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  const paymentState =
    order.paymentStatus === "failed" ? "failed" : order.paymentStatus === "paid" ? "paid" : "not-charged";
  const plan = order.subscription;
  const itemTotal = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryFee = order.deliveryFee ?? 0;
  // "CF‑60006" with a hyphen that never breaks onto two lines
  const orderNumber = order.orderId.replace("-", "‑");

  const heading =
    paymentState === "paid" ? "Payment successful" : paymentState === "failed" ? "Payment failed" : "Order details";
  const summary =
    paymentState === "paid"
      ? `We have received your payment of ${rupees(order.total)} for order ${orderNumber}. Thank you for shopping with Chiranvi Farm.`
      : paymentState === "failed"
        ? `Your payment of ${rupees(order.total)} for order ${orderNumber} did not go through, so the order has not been placed.`
        : `This order was placed before online payments were available, so no payment was taken online.`;

  return (
    <div className={styles["receipt-overlay"]}>
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className={styles["receipt-dimmed-page"]}
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-receipt-heading"
        className={styles["receipt-card"]}
      >
        <button
          ref={closeButtonRef}
          type="button"
          aria-label="Close"
          className={styles["receipt-close-button"]}
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        {/* Payment result: tick (paid), exclamation mark (failed) or receipt (not charged) */}
        <div className={styles["receipt-result"]}>
          <span
            className={`${styles["receipt-result-icon"]} ${styles[`receipt-result-icon-${paymentState}`]}`}
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24">
              {paymentState === "paid" ? (
                <path d="M6 12.5l4 4 8-9" />
              ) : paymentState === "failed" ? (
                <path d="M12 6.5v7M12 17.2v.3" />
              ) : (
                <path d="M7 4h10v16l-2.5-1.5L12 20l-2.5-1.5L7 20zM9.5 9h5M9.5 12.5h5" />
              )}
            </svg>
          </span>
          <h2 id="order-receipt-heading" className={styles["receipt-heading"]}>
            {heading}
          </h2>
          <p className={styles["receipt-amount"]}>{rupees(order.total)}</p>
          <p className={styles["receipt-summary"]}>{summary}</p>
          {paymentState === "failed" && (
            <p className={styles["receipt-failure-note"]} role="note">
              {order.paymentFailureReason ? (
                <>
                  <strong>Reason:</strong> {order.paymentFailureReason}
                  <br />
                </>
              ) : null}
              If any money was deducted from your account, your bank will refund it automatically within 5–7 working
              days.
            </p>
          )}
        </div>

        {/* Order and payment details */}
        <dl className={styles["receipt-details"]}>
          <div className={styles["receipt-detail-row"]}>
            <dt>Order number</dt>
            <dd>{order.orderId}</dd>
          </div>
          <div className={styles["receipt-detail-row"]}>
            <dt>Order date</dt>
            <dd>{formatDateAndTime(order.placedAt)}</dd>
          </div>
          {order.paymentMethod && (
            <div className={styles["receipt-detail-row"]}>
              <dt>Payment method</dt>
              <dd>{order.paymentMethod}</dd>
            </div>
          )}
          {order.razorpayPaymentId && (
            <div className={styles["receipt-detail-row"]}>
              <dt>Payment ID</dt>
              <dd className={styles["receipt-payment-id"]}>{order.razorpayPaymentId}</dd>
            </div>
          )}
          {paymentState === "paid" && order.paidAt && (
            <div className={styles["receipt-detail-row"]}>
              <dt>Paid on</dt>
              <dd>{formatDateAndTime(order.paidAt)}</dd>
            </div>
          )}
          {order.deliverTo && (
            <div className={styles["receipt-detail-row"]}>
              <dt>Delivery address</dt>
              <dd>{order.deliverTo}</dd>
            </div>
          )}
          {paymentState !== "failed" && order.promisedAt && order.status !== "cancelled" && (
            <div className={styles["receipt-detail-row"]}>
              <dt>{order.status === "delivered" ? "Delivery" : "Expected delivery"}</dt>
              <dd>{order.status === "delivered" ? "Delivered" : formatPromisedMorning(order.promisedAt)}</dd>
            </div>
          )}
        </dl>

        {/* The bill */}
        <div className={styles["receipt-bill"]}>
          <h3 className={styles["receipt-bill-heading"]}>Bill details</h3>
          <ul className={styles["receipt-bill-lines"]}>
            {order.items.map((item) => (
              <li key={item.productId} className={styles["receipt-bill-line"]}>
                <span className={styles["receipt-bill-line-name"]}>
                  {plan ? `${item.name} · ${plan.planName} plan` : item.name}
                  <span className={styles["receipt-bill-line-detail"]}>
                    {plan
                      ? `${plan.bottleCount} × ${plan.bottleLabel ?? "1 L"} bottles at ${rupees(item.price)} each`
                      : `${item.packSize ? `${item.packSize} · ` : ""}${item.quantity} × ${rupees(item.price)}`}
                  </span>
                </span>
                <span className={styles["receipt-bill-line-amount"]}>{rupees(item.price * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <dl className={styles["receipt-bill-totals"]}>
            <div className={styles["receipt-bill-total-row"]}>
              <dt>Item total</dt>
              <dd>{rupees(itemTotal)}</dd>
            </div>
            {order.couponCode && order.couponDiscount ? (
              <div className={`${styles["receipt-bill-total-row"]} ${styles["receipt-bill-saving"]}`}>
                <dt>Coupon ({order.couponCode})</dt>
                <dd>−{rupees(order.couponDiscount)}</dd>
              </div>
            ) : null}
            <div className={styles["receipt-bill-total-row"]}>
              <dt>Delivery fee</dt>
              <dd>{deliveryFee > 0 ? rupees(deliveryFee) : "Free"}</dd>
            </div>
            {/* Once per checkout (on the plan's order when there was one) */}
            {order.platformFee ? (
              <div className={styles["receipt-bill-total-row"]}>
                <dt>Platform fee</dt>
                <dd>{rupees(order.platformFee)}</dd>
              </div>
            ) : null}
            <div className={`${styles["receipt-bill-total-row"]} ${styles["receipt-bill-grand-total"]}`}>
              <dt>
                {paymentState === "paid"
                  ? "Total paid"
                  : paymentState === "failed"
                    ? "Amount not charged"
                    : "Order total"}
              </dt>
              <dd>{rupees(order.total)}</dd>
            </div>
          </dl>
        </div>

        {/* Kept at the bottom of the pop-up while the receipt scrolls */}
        <div className={styles["receipt-footer"]}>
          <div className={styles["receipt-buttons"]}>
            {paymentState === "failed" ? (
              <Link href="/cart" className={styles["receipt-primary-button"]}>
                Go to cart
              </Link>
            ) : null}
            <button type="button" className={styles["receipt-secondary-button"]} onClick={onClose}>
              Close
            </button>
          </div>
          <p className={styles["receipt-help"]}>
            Need help with this order? <Link href="/account/help">Contact us</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
