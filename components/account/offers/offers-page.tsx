"use client";

import { useState } from "react";
import { useMyOffers, type CouponKind, type OfferCoupon } from "@/store/coupons-store";
import { AccountPageHeading } from "../account-dashboard-layout";
import styles from "./offers-page.module.css";

/*
  "My Offers" dashboard page: filter buttons (All / Available / Used), the coupons the customer can use now as
  tickets (tap the code to copy it, then use it in the cart) and the coupons they already used, faded, with the
  day. The coupons are the admin's (Chiranvi Panel → Coupons & offers): every running one, read from the
  database (useMyOffers, 0055_my_offers.sql).
*/

type CouponFilter = "all" | "available" | "used";

const couponFilters: { id: CouponFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "available", label: "Available" },
  { id: "used", label: "Used" },
];

// Each kind of coupon has its own icon colour
const ICON_COLOURS: Record<CouponKind, "green" | "yellow" | "blue"> = {
  flat: "green",
  percent: "yellow",
  "free-days": "blue",
  referral: "green",
};

const rupees = (amount: number) => `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// "₹50 off", "10% off", "3 days of milk free", "₹100 for each friend"
function couponTitle(coupon: OfferCoupon) {
  switch (coupon.kind) {
    case "flat":
      return `${rupees(coupon.value)} off`;
    case "percent":
      return `${coupon.value}% off`;
    case "free-days":
      return `${coupon.value} day${coupon.value === 1 ? "" : "s"} of milk free`;
    case "referral":
      return `${rupees(coupon.value)} for each friend`;
    default:
      return coupon.code;
  }
}

// "9 Nov"
const shortDay = (dayKey: string) => new Date(`${dayKey}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// "Valid till 30 Nov", "No expiry"
const validityText = (validTill: string | null) => (validTill ? `Valid till ${shortDay(validTill)}` : "No expiry");

function CouponTagIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12V4h8l10 10-8 8L3 12Z" />
      <path d="M7.5 7.5h.01" />
    </svg>
  );
}

// Loading, couldn't load, or an empty list: a centred card (light yellow when it couldn't load)
function OffersMessage({ title, text, isProblem = false }: { title: string; text?: string; isProblem?: boolean }) {
  return (
    <div className={`${styles["offers-message"]} ${isProblem ? styles["offers-message-problem"] : ""}`} role={isProblem ? "alert" : "status"}>
      <span className={styles["offers-message-icon"]}>
        <CouponTagIcon />
      </span>
      <p className={styles["offers-message-title"]}>{title}</p>
      {text && <p className={styles["offers-message-text"]}>{text}</p>}
    </div>
  );
}

export default function OffersPage() {
  const offers = useMyOffers();
  const [selectedFilter, setSelectedFilter] = useState<CouponFilter>("all");
  // The code just copied, for the short "Copied" note on it
  const [copiedCouponCode, setCopiedCouponCode] = useState<string | null>(null);

  const isAvailableShown = selectedFilter === "all" || selectedFilter === "available";
  const isUsedShown = selectedFilter === "all" || selectedFilter === "used";
  const availableCoupons = offers && offers !== "problem" ? offers.available : [];
  const usedCoupons = offers && offers !== "problem" ? offers.used : [];

  async function copyCouponCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCouponCode(code);
      window.setTimeout(() => setCopiedCouponCode((shownCode) => (shownCode === code ? null : shownCode)), 1500);
    } catch {
      // Copying blocked by the browser: the code is still visible to copy by hand.
    }
  }

  return (
    <>
      <AccountPageHeading
        title="My Offers"
        description="Coupons and savings on your Chiranvi orders."
        action={
          <div className={styles["offers-filter-buttons"]} role="group" aria-label="Show coupons">
            {couponFilters.map((couponFilter) => (
              <button
                key={couponFilter.id}
                type="button"
                aria-pressed={selectedFilter === couponFilter.id}
                className={`${styles["offers-filter-button"]} ${
                  selectedFilter === couponFilter.id ? styles["offers-filter-button-selected"] : ""
                }`}
                onClick={() => setSelectedFilter(couponFilter.id)}
              >
                {couponFilter.label}
              </button>
            ))}
          </div>
        }
      />

      {offers === null && <OffersMessage title="Loading your offers…" />}
      {offers === "problem" && (
        <OffersMessage isProblem title="Couldn't load your offers" text="Check your internet connection and try again." />
      )}

      {offers && offers !== "problem" && isAvailableShown && (
        <section aria-labelledby="available-coupons-heading">
          <h2 id="available-coupons-heading" className={styles["offers-section-heading"]}>
            Available coupons
          </h2>
          {availableCoupons.length === 0 ? (
            <OffersMessage title="No offers right now" text="New coupons will show up here. Check back soon." />
          ) : (
            <ul className={styles["offers-coupon-grid"]}>
              {availableCoupons.map((coupon) => (
                <li key={coupon.code} className={styles["offers-coupon-ticket"]}>
                  <span
                    className={`${styles["offers-coupon-icon-box"]} ${styles[`offers-coupon-icon-box-${coupon.kind ? ICON_COLOURS[coupon.kind] : "green"}`]}`}
                  >
                    <CouponTagIcon />
                  </span>

                  <div className={styles["offers-coupon-details"]}>
                    <div className={styles["offers-coupon-title-row"]}>
                      <h3 className={styles["offers-coupon-title"]}>{couponTitle(coupon)}</h3>
                      <p className={styles["offers-coupon-validity"]}>{validityText(coupon.validTill)}</p>
                    </div>
                    <p className={styles["offers-coupon-description"]}>
                      {coupon.description}
                      {coupon.minOrder ? ` · On orders above ${rupees(coupon.minOrder)}` : ""}
                    </p>

                    <div className={styles["offers-coupon-bottom-row"]}>
                      <button
                        type="button"
                        aria-label={`Copy code ${coupon.code}`}
                        className={styles["offers-coupon-code"]}
                        onClick={() => copyCouponCode(coupon.code)}
                      >
                        {copiedCouponCode === coupon.code ? "Copied" : coupon.code}
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <rect x="8" y="8" width="12" height="12" rx="2" />
                          <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
                        </svg>
                      </button>
                      <p className={styles["offers-coupon-validity"]}>Use this code in your cart.</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {offers && offers !== "problem" && isUsedShown && (usedCoupons.length > 0 || selectedFilter === "used") && (
        <section aria-labelledby="used-coupons-heading">
          <h2 id="used-coupons-heading" className={styles["offers-section-heading"]}>
            Used coupons
          </h2>
          {usedCoupons.length === 0 ? (
            <OffersMessage title="No coupons used yet" text="Coupons you use on your orders will show up here." />
          ) : (
            <ul className={styles["offers-coupon-grid"]}>
              {usedCoupons.map((coupon) => (
                <li key={`${coupon.code}-${coupon.orderNumber}`} className={`${styles["offers-coupon-ticket"]} ${styles["offers-coupon-ticket-faded"]}`}>
                  <span className={`${styles["offers-coupon-icon-box"]} ${styles["offers-coupon-icon-box-grey"]}`}>
                    <CouponTagIcon />
                  </span>
                  <div className={styles["offers-coupon-details"]}>
                    <div className={styles["offers-coupon-title-row"]}>
                      <h3 className={styles["offers-faded-coupon-title"]}>
                        {couponTitle(coupon)} · {coupon.code}
                      </h3>
                      <span className={styles["offers-coupon-status-badge"]}>Used on {shortDay(coupon.usedOn)}</span>
                    </div>
                    <p className={styles["offers-coupon-description"]}>
                      You saved {rupees(coupon.saving)} on order {coupon.orderNumber}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
