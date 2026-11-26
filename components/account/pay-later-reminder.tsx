"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BULK_ORDER_POPUP_CLOSED_EVENT } from "@/components/bulk-order/bulk-order-popup";
import { useOrders, type Order } from "@/store/orders-store";
import styles from "./pay-later-reminder.module.css";

/*
  Pay-later payment reminder pop-up (mounted in app/layout.tsx). When staff sent a reminder
  (orders.payment_reminded_at, 0067), the customer sees it:
    - on the landing page: 2 seconds AFTER the bulk-order pop-up closes (so they never overlap);
    - on any other customer page: a couple of seconds after arriving.
    - never in the Chiranvi Panel (/admin) or the Delivery panel (/delivery).
  Shown at most twice per reminder, so it nudges without nagging. A newer reminder shows again.
*/

const COUNT_KEY = "chiranvi-pay-later-reminder-count";
const MAX_SHOWS = 2;
const SHOW_DELAY_MS = 2000;

function readCounts(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(COUNT_KEY) || "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function bumpCount(key: string) {
  try {
    const counts = readCounts();
    counts[key] = (counts[key] ?? 0) + 1;
    localStorage.setItem(COUNT_KEY, JSON.stringify(counts));
  } catch {
    // Private window: it may show a little more, which is fine for a reminder
  }
}

export default function PayLaterReminder() {
  const orders = useOrders();
  const router = useRouter();
  const pathname = usePathname();
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const [shown, setShown] = useState<Order | null>(null);

  const isPanel = pathname.startsWith("/admin") || pathname.startsWith("/delivery");
  const isLanding = pathname === "/";

  // Pick the latest pay-later reminder not yet shown MAX_SHOWS times, then show it (bumping its count)
  const showCandidate = useCallback(() => {
    const counts = readCounts();
    const candidate = ordersRef.current
      .filter((order) => order.paymentStatus === "pay_later" && order.paymentRemindedAt)
      .filter((order) => (counts[`${order.orderId}:${order.paymentRemindedAt}`] ?? 0) < MAX_SHOWS)
      .sort((first, second) => (second.paymentRemindedAt ?? 0) - (first.paymentRemindedAt ?? 0))[0];
    if (!candidate || !candidate.paymentRemindedAt) return;
    bumpCount(`${candidate.orderId}:${candidate.paymentRemindedAt}`);
    setShown(candidate);
  }, []);

  // Landing page: 2 s after the bulk-order pop-up closes
  useEffect(() => {
    if (isPanel) return;
    let timer = 0;
    function onBulkClosed() {
      window.clearTimeout(timer);
      timer = window.setTimeout(showCandidate, SHOW_DELAY_MS);
    }
    window.addEventListener(BULK_ORDER_POPUP_CLOSED_EVENT, onBulkClosed);
    return () => {
      window.removeEventListener(BULK_ORDER_POPUP_CLOSED_EVENT, onBulkClosed);
      window.clearTimeout(timer);
    };
  }, [isPanel, showCandidate]);

  // Any other customer page: a couple of seconds after arriving
  useEffect(() => {
    if (isPanel || isLanding) return;
    const timer = window.setTimeout(showCandidate, SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [pathname, isPanel, isLanding, showCandidate]);

  // Never in the panels
  if (isPanel || !shown) return null;

  const plan = shown.items.map((item) => (item.quantity > 1 ? `${item.name} × ${item.quantity}` : item.name)).join(", ");
  const dueBy = shown.paymentDueBy
    ? new Date(`${shown.paymentDueBy}T12:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : null;

  return (
    <div className={styles["reminder-overlay"]} role="dialog" aria-modal="true" aria-labelledby="pay-later-reminder-heading">
      <button type="button" aria-label="Close" tabIndex={-1} className={styles["reminder-dim"]} onClick={() => setShown(null)} />
      <section className={styles["reminder-card"]}>
        <span className={styles["reminder-icon"]} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5v5.5" />
            <path d="M12 16.5h.01" />
          </svg>
        </span>
        <h2 id="pay-later-reminder-heading" className={styles["reminder-heading"]}>
          Payment reminder
        </h2>
        <p className={styles["reminder-text"]}>
          Your <strong>{plan}</strong> plan payment of <strong>₹{shown.total.toLocaleString("en-IN")}</strong> is still due
          {dueBy ? (
            <>
              {" "}
              — please pay by <strong>{dueBy}</strong>
            </>
          ) : null}
          .
        </p>
        <div className={styles["reminder-buttons"]}>
          <button
            type="button"
            className={styles["reminder-pay"]}
            onClick={() => {
              setShown(null);
              router.push("/account/billing");
            }}
          >
            Pay now
          </button>
          <button type="button" className={styles["reminder-later"]} onClick={() => setShown(null)}>
            Later
          </button>
        </div>
      </section>
    </div>
  );
}
