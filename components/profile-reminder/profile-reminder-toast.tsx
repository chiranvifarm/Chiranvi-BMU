"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { rememberPageAfterLogin, useIsLoginStatusKnown, useLoggedInMobileNumber } from "@/components/login/login-status";
import {
  BULK_ORDER_POPUP_CLOSED_EVENT,
  POPUP_PAGE,
  POPUP_TURN_GAP_MS,
  PROFILE_REMINDER_DONE_EVENT,
} from "@/components/bulk-order/bulk-order-popup";
import { useCustomerProfile, useIsCustomerProfileKnown } from "@/store/customer-profiles-store";
import { useOrders, useOrderUpdates, type OrderStatus, type OrderUpdate } from "@/store/orders-store";
import styles from "./profile-reminder-toast.module.css";

/*
  A notification on the right side of the landing page (mounted once in app/layout.tsx), taking turns with the
  bulk order pop-up:
  - not logged in: "Log in for a better experience" (Log in opens the login, which comes back to this page);
  - logged in without a saved Profile: "Complete your profile" (opens the Profile page, /account);
  - logged in with a saved Profile: nothing (its turns are skipped).
  Timing: its turn comes 2 minutes after the bulk order pop-up's turn ends (closed, or skipped after a quote).
  It slides out by itself after 8 seconds (× or its button closes it sooner), and its end gives the bulk order
  pop-up its turn 2 minutes later, so the two never show together. Only on the landing page: on any other
  page its turn waits until the visitor is back there.
*/

const SHOWN_FOR_MS = 8_000;
const PROFILE_PAGE = "/account";

type Reminder = "log-in" | "complete-profile";

const REMINDER_WORDS: Record<Reminder, { title: string; text: string; button: string }> = {
  "log-in": {
    title: "Log in for a better experience",
    text: "Log in to save your cart, track your orders and check out faster.",
    button: "Log in",
  },
  "complete-profile": {
    title: "Complete your profile",
    text: "Your profile isn’t finished yet. Add your details for faster checkout and on-time deliveries.",
    button: "Complete profile",
  },
};

/*
  "Your order is out for delivery": the same kind of card, higher up, on any customer page (mounted once in
  app/layout.tsx) when one of the logged-in customer's orders changes status. It shows the newest change once
  per visit and slides out by itself after 8 seconds. Not on My Orders (the tracker is right there) or inside
  the panels.
*/
// The words after the products: one product, or more than one
const ORDER_UPDATE_WORDS: Partial<Record<OrderStatus, { one: string; many: string }>> = {
  packed: { one: "is packed", many: "are packed" },
  "out-for-delivery": { one: "is out for delivery", many: "are out for delivery" },
  delivered: { one: "was delivered", many: "were delivered" },
  cancelled: { one: "was cancelled", many: "were cancelled" },
};

// The order by what is in it, not its number: "Your Jersey Cow Paneer", "Your Jersey Milk and 2 more items"
function orderProductsText(items: { name: string }[] | undefined) {
  const names = [...new Set((items ?? []).map((item) => item.name.trim()).filter(Boolean))];
  if (names.length === 0) return { text: "Your order", isMany: false };
  if (names.length === 1) return { text: `Your ${names[0]}`, isMany: false };
  if (names.length === 2) return { text: `Your ${names[0]} and ${names[1]}`, isMany: true };
  return { text: `Your ${names[0]} and ${names.length - 1} more items`, isMany: true };
}

const shownOrderUpdates = new Set<string>();

export function OrderUpdateToast() {
  const pathname = usePathname();
  const newestUpdate = useOrderUpdates()[0];
  const orders = useOrders();
  const [shownUpdate, setShownUpdate] = useState<OrderUpdate | null>(null);
  const isHiddenPage = pathname === "/account/orders" || pathname.startsWith("/admin") || pathname.startsWith("/delivery");

  useEffect(() => {
    if (!newestUpdate || isHiddenPage) return;
    const updateKey = `${newestUpdate.orderId}-${newestUpdate.status}`;
    if (shownOrderUpdates.has(updateKey)) return;
    shownOrderUpdates.add(updateKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new update arrived from the database
    setShownUpdate(newestUpdate);
  }, [newestUpdate, isHiddenPage]);

  useEffect(() => {
    if (!shownUpdate) return;
    const timer = window.setTimeout(() => setShownUpdate(null), SHOWN_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [shownUpdate]);

  if (!shownUpdate || isHiddenPage) return null;
  const products = orderProductsText(orders.find((order) => order.orderId === shownUpdate.orderId)?.items);
  const statusWords = ORDER_UPDATE_WORDS[shownUpdate.status];

  return (
    <aside className={`${styles["profile-reminder-toast"]} ${styles["order-update-toast"]}`} role="status" aria-labelledby="order-update-title">
      <span className={styles["profile-reminder-icon"]} aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M2.5 6.5h11v9.5h-11z" />
          <path d="M13.5 9.5h4l3.5 3.5v3h-7.5" />
          <circle cx="6.5" cy="17" r="2" />
          <circle cx="17" cy="17" r="2" />
        </svg>
      </span>
      <div className={styles["profile-reminder-words"]}>
        <p id="order-update-title" className={styles["profile-reminder-title"]}>
          {products.text} {products.isMany ? statusWords?.many : statusWords?.one}
        </p>
        <Link href="/account/orders" className={styles["profile-reminder-link"]} onClick={() => setShownUpdate(null)}>
          View order
        </Link>
      </div>
      <button type="button" className={styles["profile-reminder-close-button"]} aria-label="Close" onClick={() => setShownUpdate(null)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </aside>
  );
}

export default function ProfileReminderToast() {
  const pathname = usePathname();
  const mobileNumber = useLoggedInMobileNumber();
  const isLoginStatusKnown = useIsLoginStatusKnown();
  const profile = useCustomerProfile(mobileNumber);
  const isProfileKnown = useIsCustomerProfileKnown(mobileNumber);

  // Which notification this visitor needs (none until the login and the profile have been read)
  let reminder: Reminder | null = null;
  if (isLoginStatusKnown && !mobileNumber) reminder = "log-in";
  else if (mobileNumber && isProfileKnown && !profile) reminder = "complete-profile";
  // Read, and nothing to remind: its turns are skipped
  const isNothingToRemind = isLoginStatusKnown && Boolean(mobileNumber) && isProfileKnown && Boolean(profile);
  const isOnPopupPage = pathname === POPUP_PAGE;

  // Becomes true when it is this notification's turn: 2 minutes after the bulk order pop-up's turn ends
  const [isDue, setIsDue] = useState(false);
  const [isShown, setIsShown] = useState(false);
  useEffect(() => {
    let timer = 0;
    const onBulkPopupClosed = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIsDue(true), POPUP_TURN_GAP_MS);
    };
    window.addEventListener(BULK_ORDER_POPUP_CLOSED_EVENT, onBulkPopupClosed);
    return () => {
      window.removeEventListener(BULK_ORDER_POPUP_CLOSED_EVENT, onBulkPopupClosed);
      window.clearTimeout(timer);
    };
  }, []);

  // Its turn ends (hidden by itself, ×, or its button): the bulk order pop-up's 2 minutes start
  const endTurn = useCallback(() => {
    setIsShown(false);
    window.dispatchEvent(new Event(PROFILE_REMINDER_DONE_EVENT));
  }, []);

  // Its turn: nothing to remind → skipped; otherwise shown on the landing page (it waits on other pages)
  useEffect(() => {
    if (!isDue) return;
    if (isNothingToRemind) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- passing the turn on
      setIsDue(false);
      window.dispatchEvent(new Event(PROFILE_REMINDER_DONE_EVENT));
      return;
    }
    if (!reminder || !isOnPopupPage) return;
    setIsDue(false);
    setIsShown(true);
  }, [isDue, isNothingToRemind, reminder, isOnPopupPage]);

  // Shown: slides out by itself after 8 s
  useEffect(() => {
    if (!isShown) return;
    const timer = window.setTimeout(endTurn, SHOWN_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [isShown, endTurn]);

  if (!isShown || !reminder || !isOnPopupPage) return null;
  const words = REMINDER_WORDS[reminder];

  return (
    <aside className={styles["profile-reminder-toast"]} role="status" aria-labelledby="profile-reminder-title">
      <span className={styles["profile-reminder-icon"]} aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 20c.8-3.6 3.9-6 7.5-6s6.7 2.4 7.5 6" />
        </svg>
      </span>
      <div className={styles["profile-reminder-words"]}>
        <p id="profile-reminder-title" className={styles["profile-reminder-title"]}>
          {words.title}
        </p>
        <p className={styles["profile-reminder-text"]}>{words.text}</p>
        <Link
          href={reminder === "log-in" ? "/login" : PROFILE_PAGE}
          className={styles["profile-reminder-link"]}
          onClick={() => {
            // After logging in, the login comes back to the page the visitor was on
            if (reminder === "log-in") rememberPageAfterLogin(window.location.pathname + window.location.search);
            endTurn();
          }}
        >
          {words.button}
        </Link>
      </div>
      <button type="button" className={styles["profile-reminder-close-button"]} aria-label="Close" onClick={endTurn}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </aside>
  );
}
