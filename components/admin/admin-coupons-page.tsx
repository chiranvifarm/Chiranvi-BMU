"use client";

import { useMemo, useState } from "react";
import {
  COUPON_APPLIES_TO,
  COUPON_CART_TYPES,
  COUPON_KINDS,
  addCoupon,
  addCouponsToCartType,
  getCouponStatus,
  isCouponForCartType,
  removeCoupon,
  removeCouponFromCartType,
  updateCoupon,
  useCoupons,
  useRedemptions,
  type Coupon,
  type CouponCartType,
  type CouponKind,
  type CouponStatus,
} from "@/store/coupons-store";
import { useAdminPayments } from "@/store/admin-payments-store";
import { AdminFeatureGate } from "./admin-panel-layout";
import AdminDateRangePicker from "./admin-date-range-picker";
import {
  AdminDialog,
  AdminDialogField,
  AdminPageTop,
  AdminPagination,
  AdminStatCards,
  adminInputClassName,
  downloadCsv,
  formatDateRange,
  toDateFileName,
  useAdminCan,
  useAdminToast,
} from "./admin-shared";
import dashboardStyles from "./admin-dashboard.module.css";
import sharedStyles from "./admin-shared.module.css";
import styles from "./admin-coupons-page.module.css";

/*
  Coupons & offers (/admin/coupons), from the design 14-coupons-offers: discount codes, referral rewards
  and how they perform. No wallet: WALLET50 in the design is SUB50 here (₹50 off a 3-month milk plan).
    top        search (code, offer or customer), New coupon (pop-up form), Custom range (this month at
               first), Export
    numbers    active coupons (expired this month), times redeemed (against the same number of days
               before), discount given (% of money collected), revenue from offers (× the discount)
    in cart    "Coupons in the cart": three lists (one-time products, subscription, subscription +
               one-time). Only the coupons in a cart's list can be used in that cart. × takes one out;
               + Add picks existing coupons, or Create new coupon makes one straight into that list.
    cards      one ticket per coupon: code, offer, status, uses against the limit, valid till; Delete
               (asks once more) and Edit (changes the offer, limit, dates, pauses or deletes it)
    table      recent redemptions in these dates; View all shows every one, 14 a page
  Coupons come from store/coupons-store.ts, which the customer site can read too.
*/

const PAGE_SIZE = 14;

const STATUS_CLASS_NAMES: Record<CouponStatus, string> = {
  Active: dashboardStyles["admin-status-delivered"],
  Scheduled: dashboardStyles["admin-status-out-for-delivery"],
  Paused: dashboardStyles["admin-status-pending"],
  Expired: sharedStyles["admin-priority-low"],
};

const initialsOf = (fullName: string) =>
  fullName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const rupees = (amount: number) => `₹${Math.round(amount).toLocaleString("en-IN")}`;
// "30 Sep" (some browsers write "Sept")
const shortDay = (dayKey: string) =>
  new Date(`${dayKey}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).replace("Sept", "Sep");
const toDayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function validityText(coupon: Coupon, status: CouponStatus) {
  if (!coupon.validTill) return "No expiry";
  if (status === "Expired" && coupon.usageLimit !== null && coupon.used >= coupon.usageLimit && coupon.validTill >= toDayKey(new Date()))
    return "All uses taken";
  if (status === "Expired") return `Ended ${shortDay(coupon.validTill)}`;
  if (status === "Scheduled") return `Starts ${shortDay(coupon.validFrom)} · till ${shortDay(coupon.validTill)}`;
  return `Valid till ${shortDay(coupon.validTill)}`;
}

// A short offer line from the kind and value, used when the description is left empty
function describe(kind: CouponKind, value: number, appliesTo: string) {
  const on = appliesTo === "All products" ? "" : ` on ${appliesTo.toLowerCase()}`;
  if (kind === "percent") return `${value}% off${on}`;
  if (kind === "free-days") return `First ${value} days of milk free`;
  if (kind === "referral") return `₹${value} for you and your friend`;
  return `₹${value} off${on}`;
}

type CouponForm = {
  code: string;
  description: string;
  kind: CouponKind;
  value: string;
  appliesTo: string;
  minOrder: string;
  usageLimit: string;
  validFrom: Date;
  validTill: Date;
  hasNoExpiry: boolean;
  isPaused: boolean;
};

export default function AdminCouponsPage() {
  return (
    <AdminFeatureGate feature="coupons">
      <CouponsPage />
    </AdminFeatureGate>
  );
}

function CouponsPage() {
  const coupons = useCoupons();
  const redemptions = useRedemptions();
  const payments = useAdminPayments();
  const [today] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [rangeTo, setRangeTo] = useState(today);
  const [searchText, setSearchText] = useState("");
  const [isShowingAll, setIsShowingAll] = useState(false);
  const [page, setPage] = useState(1);
  // null: no form; "new": New coupon; otherwise the code being edited
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<CouponForm | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isRemoveAsked, setIsRemoveAsked] = useState(false);
  // Delete straight from a ticket (asks once more)
  const [couponToDelete, setCouponToDelete] = useState<Coupon | null>(null);
  // Coupons in the cart: the list + Add was pressed on, the coupons ticked in its pop-up, and the list a
  // coupon made with "Create new coupon" goes into
  const [addingToCartType, setAddingToCartType] = useState<CouponCartType | null>(null);
  const [tickedCodes, setTickedCodes] = useState<string[]>([]);
  const [newCouponCartType, setNewCouponCartType] = useState<CouponCartType | null>(null);
  const { showToast, toast } = useAdminToast();
  // What the role may do (Roles & permissions)
  const canEdit = useAdminCan("edit");
  const canDelete = useAdminCan("delete");

  // The chosen dates, and the same number of days just before them (to compare)
  const { inRange, before, collected } = useMemo(() => {
    const start = new Date(rangeFrom);
    start.setHours(0, 0, 0, 0);
    const end = new Date(rangeTo);
    end.setHours(23, 59, 59, 999);
    const length = end.getTime() - start.getTime();
    const earlierStart = new Date(start.getTime() - length - 1);
    const isWithin = (iso: string, from: Date, to: Date) => {
      const date = new Date(iso);
      return date >= from && date <= to;
    };
    return {
      inRange: redemptions.filter((redemption) => isWithin(redemption.redeemedAt, start, end)),
      before: redemptions.filter((redemption) => isWithin(redemption.redeemedAt, earlierStart, start)),
      collected: payments
        .filter((payment) => payment.status === "Success" && payment.amount > 0 && isWithin(payment.paidAt, start, end))
        .reduce((sum, payment) => sum + payment.amount, 0),
    };
  }, [redemptions, payments, rangeFrom, rangeTo]);

  const words = searchText.trim().toLowerCase();
  const shownCoupons = coupons.filter((coupon) => !words || `${coupon.code} ${coupon.description}`.toLowerCase().includes(words));
  const shownRedemptions = inRange.filter(
    (redemption) => !words || `${redemption.code} ${redemption.customerName} ${redemption.orderNumber}`.toLowerCase().includes(words),
  );
  const tableRows = isShowingAll ? shownRedemptions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : shownRedemptions.slice(0, 5);

  const thisMonth = toDayKey(today).slice(0, 7);
  const active = coupons.filter((coupon) => getCouponStatus(coupon, today) === "Active").length;
  const expiredThisMonth = coupons.filter(
    (coupon) => getCouponStatus(coupon, today) === "Expired" && (coupon.validTill ?? "").slice(0, 7) >= toDayKey(new Date(today.getFullYear(), today.getMonth() - 1, 1)).slice(0, 7),
  ).length;
  const discountGiven = inRange.reduce((sum, redemption) => sum + redemption.discount, 0);
  const revenueFromOffers = inRange.reduce((sum, redemption) => sum + redemption.orderValue - redemption.discount, 0);
  const change = inRange.length - before.length;

  function openForm(coupon: Coupon | "new") {
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    setEditing(coupon === "new" ? "new" : coupon.code);
    setIsCalendarOpen(false);
    setIsRemoveAsked(false);
    setForm(
      coupon === "new"
        ? {
            code: "",
            description: "",
            kind: "flat",
            value: "",
            appliesTo: COUPON_APPLIES_TO[0],
            minOrder: "",
            usageLimit: "",
            validFrom: today,
            validTill: monthEnd,
            hasNoExpiry: false,
            isPaused: false,
          }
        : {
            code: coupon.code,
            description: coupon.description,
            kind: coupon.kind,
            value: String(coupon.value),
            appliesTo: coupon.appliesTo,
            minOrder: coupon.minOrder ? String(coupon.minOrder) : "",
            usageLimit: coupon.usageLimit === null ? "" : String(coupon.usageLimit),
            validFrom: new Date(`${coupon.validFrom}T12:00:00`),
            validTill: coupon.validTill ? new Date(`${coupon.validTill}T12:00:00`) : monthEnd,
            hasNoExpiry: coupon.validTill === null,
            isPaused: coupon.isPaused,
          },
    );
  }

  function saveForm() {
    if (!form) return;
    const code = form.code.trim().toUpperCase();
    const value = Number(form.value);
    if (editing === "new" && !/^[A-Z0-9]{3,15}$/.test(code)) {
      showToast("Code: 3 to 15 letters or numbers, e.g. FIRST50");
      return;
    }
    if (editing === "new" && coupons.some((coupon) => coupon.code === code)) {
      showToast(`${code} already exists`);
      return;
    }
    if (!value || (form.kind === "percent" && value > 90)) {
      showToast(form.kind === "percent" ? "Enter a discount between 1 and 90%" : "Enter the value");
      return;
    }
    const details = {
      description: form.description.trim() || describe(form.kind, value, form.appliesTo),
      kind: form.kind,
      value,
      appliesTo: form.appliesTo,
      minOrder: Number(form.minOrder) || undefined,
      usageLimit: Number(form.usageLimit) || null,
      validFrom: toDayKey(form.validFrom),
      validTill: form.hasNoExpiry ? null : toDayKey(form.validTill),
    };
    if (editing === "new") {
      addCoupon({ code, ...details, cartTypes: newCouponCartType ? [newCouponCartType] : undefined });
      const cartTypeLabel = COUPON_CART_TYPES.find((cartType) => cartType.key === newCouponCartType)?.label;
      showToast(cartTypeLabel ? `${code} created and added to ${cartTypeLabel}` : `${code} created`);
      setNewCouponCartType(null);
    } else if (editing) {
      updateCoupon(editing, { ...details, isPaused: form.isPaused });
      showToast(`${editing} saved`);
    }
    setEditing(null);
  }

  function exportCoupons() {
    downloadCsv(`chiranvi-coupons-${toDateFileName(rangeFrom)}-to-${toDateFileName(rangeTo)}.csv`, [
      ["Code", "Offer", "Status", "Used", "Limit", "Valid from", "Valid till"],
      ...coupons.map((coupon) => [
        coupon.code,
        coupon.description,
        getCouponStatus(coupon, today),
        coupon.used,
        coupon.usageLimit ?? "No limit",
        coupon.validFrom,
        coupon.validTill ?? "No expiry",
      ]),
      [],
      [`Redemptions · ${formatDateRange(rangeFrom, rangeTo)}`],
      ["Customer", "Area", "Code", "Order", "Date", "Discount (₹)", "Order value (₹)"],
      ...shownRedemptions.map((redemption) => [
        redemption.customerName,
        redemption.area,
        redemption.code,
        redemption.orderNumber,
        new Date(redemption.redeemedAt).toLocaleDateString("en-GB"),
        redemption.discount,
        redemption.orderValue,
      ]),
    ]);
  }

  const editingCoupon = editing && editing !== "new" ? coupons.find((coupon) => coupon.code === editing) : undefined;

  return (
    <div className={dashboardStyles["admin-dashboard"]}>
      <AdminPageTop
        title="Coupons & offers"
        description="Discount codes, referral rewards and how they perform"
        searchText={searchText}
        onSearchTextChange={(text) => {
          setSearchText(text);
          setPage(1);
        }}
        searchPlaceholder="Search code or customer..."
        actionLabel="New coupon"
        onAction={() => openForm("new")}
        today={today}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        onRangeChange={(from, to) => {
          setRangeFrom(from);
          setRangeTo(to);
          setPage(1);
        }}
        onExport={exportCoupons}
      />

      <AdminStatCards
        stats={[
          {
            label: "Active coupons",
            value: String(active),
            note: expiredThisMonth ? `${expiredThisMonth} expired recently` : "None expired recently",
            trend: "plain",
            icon: ["M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4V7Z", "M10 7v2", "M10 11v2", "M10 15v2"],
          },
          {
            label: "Times redeemed",
            value: inRange.length.toLocaleString("en-IN"),
            note: `${change >= 0 ? "↑" : "↓"} ${Math.abs(change)} vs the days before`,
            trend: change >= 0 ? "up" : "plain",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M8.5 12.2l2.4 2.4 4.8-4.8"],
          },
          {
            label: "Discount given",
            value: rupees(discountGiven),
            note: `${collected ? ((discountGiven / collected) * 100).toFixed(1) : "0"}% of money collected`,
            trend: "plain",
            icon: ["M19 5 5 19", "M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z", "M16.5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"],
          },
          {
            label: "Revenue from offers",
            value: rupees(revenueFromOffers),
            note: `${discountGiven ? (revenueFromOffers / discountGiven).toFixed(1) : "0"}× the discount`,
            trend: "up",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M9 8h6M9 11h6M13 8c2 0 2 6-4 6l5 3"],
          },
        ]}
      />

      <ul className={styles["admin-coupon-grid"]}>
        {shownCoupons.map((coupon) => {
          const status = getCouponStatus(coupon, today);
          const usedShare = coupon.usageLimit ? Math.min(1, coupon.used / coupon.usageLimit) : Math.min(1, coupon.used / 50);
          return (
            <li key={coupon.code} className={`${styles["admin-coupon-ticket"]} ${styles[`admin-coupon-ticket-${status.toLowerCase()}`]}`}>
              <div className={styles["admin-coupon-top"]}>
                <div>
                  <p className={styles["admin-coupon-code"]}>{coupon.code}</p>
                  <p className={styles["admin-coupon-description"]}>
                    {coupon.description}
                    {coupon.minOrder ? ` · above ₹${coupon.minOrder}` : ""}
                  </p>
                </div>
                <span className={`${dashboardStyles["admin-status"]} ${STATUS_CLASS_NAMES[status]}`}>{status}</span>
              </div>

              {/* The torn line of the ticket, with a notch on each side */}
              <div className={styles["admin-coupon-tear"]} aria-hidden="true" />

              <div className={styles["admin-coupon-used-row"]}>
                <span>Used</span>
                <span className={styles["admin-coupon-used-count"]}>
                  {coupon.used.toLocaleString("en-IN")} {coupon.usageLimit === null ? "· no limit" : `/ ${coupon.usageLimit.toLocaleString("en-IN")}`}
                </span>
              </div>
              <div className={styles["admin-coupon-used-bar"]} aria-hidden="true">
                <span style={{ width: `${usedShare * 100}%` }} />
              </div>

              <div className={styles["admin-coupon-bottom"]}>
                <span className={styles["admin-coupon-validity"]}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 6h16v14H4z" />
                    <path d="M4 10h16M8 3.5v4M16 3.5v4" />
                  </svg>
                  {validityText(coupon, status)}
                </span>
                <span className={styles["admin-coupon-ticket-buttons"]}>
                  {canDelete && (
                  <button
                    type="button"
                    className={styles["admin-coupon-delete"]}
                    aria-label={`Delete ${coupon.code}`}
                    onClick={() => setCouponToDelete(coupon)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.5h9L17.5 7M9.5 7V4.5h5V7" />
                    </svg>
                    Delete
                  </button>
                  )}
                  {canEdit && (
                    <button type="button" className={styles["admin-coupon-edit"]} onClick={() => openForm(coupon)}>
                      Edit
                    </button>
                  )}
                </span>
              </div>
            </li>
          );
        })}
        {shownCoupons.length === 0 && <li className={styles["admin-coupon-empty"]}>No coupons match this search.</li>}
      </ul>

      {/* Coupons in the cart: which coupons each kind of cart accepts */}
      <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-cart-coupons-heading">
        <div className={dashboardStyles["admin-card-heading-row"]}>
          <div>
            <h2 id="admin-cart-coupons-heading" className={dashboardStyles["admin-card-title"]}>
              Coupons in the cart
            </h2>
            <p className={dashboardStyles["admin-card-subtitle"]}>
              Customers can use only the coupons in their cart&rsquo;s list. An empty list hides the coupon box in that cart.
            </p>
          </div>
        </div>
        <div className={styles["admin-cart-coupon-columns"]}>
          {COUPON_CART_TYPES.map((cartType) => {
            const listCoupons = coupons.filter((coupon) => isCouponForCartType(coupon, cartType.key));
            return (
              <div key={cartType.key} className={styles["admin-cart-coupon-column"]}>
                <p className={styles["admin-cart-coupon-column-title"]}>{cartType.label}</p>
                <p className={styles["admin-cart-coupon-column-note"]}>{cartType.note}</p>
                <ul className={styles["admin-cart-coupon-list"]}>
                  {listCoupons.map((coupon) => (
                    <li key={coupon.code} className={styles["admin-cart-coupon-item"]}>
                      <span className={styles["admin-cart-coupon-item-words"]}>
                        <span className={styles["admin-cart-coupon-item-code"]}>{coupon.code}</span>
                        <span className={styles["admin-cart-coupon-item-description"]}>{coupon.description}</span>
                      </span>
                      {canEdit && (
                        <button
                          type="button"
                          className={styles["admin-cart-coupon-remove"]}
                          aria-label={`Remove ${coupon.code} from ${cartType.label}`}
                          onClick={() => {
                            removeCouponFromCartType(coupon.code, cartType.key);
                            showToast(`${coupon.code} removed from ${cartType.label}`);
                          }}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      )}
                    </li>
                  ))}
                  {listCoupons.length === 0 && <li className={styles["admin-cart-coupon-empty"]}>No coupons: the cart shows no coupon box</li>}
                </ul>
                {canEdit && (
                  <button
                    type="button"
                    className={styles["admin-cart-coupon-add"]}
                    onClick={() => {
                      setAddingToCartType(cartType.key);
                      setTickedCodes([]);
                    }}
                  >
                    + Add
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-redemptions-heading">
        <div className={dashboardStyles["admin-card-heading-row"]}>
          <div>
            <h2 id="admin-redemptions-heading" className={dashboardStyles["admin-card-title"]}>
              {isShowingAll ? "All redemptions" : "Recent redemptions"}
            </h2>
            <p className={dashboardStyles["admin-card-subtitle"]}>
              {shownRedemptions.length.toLocaleString("en-IN")} in {formatDateRange(rangeFrom, rangeTo)}
            </p>
          </div>
          <button
            type="button"
            className={styles["admin-coupon-text-button"]}
            onClick={() => {
              setIsShowingAll(!isShowingAll);
              setPage(1);
            }}
          >
            {isShowingAll ? "Show recent ↑" : "View all →"}
          </button>
        </div>
        <div className={dashboardStyles["admin-table-scroll"]}>
          <table className={dashboardStyles["admin-orders-table"]}>
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Code</th>
                <th scope="col">Order</th>
                <th scope="col">Date</th>
                <th scope="col">Discount</th>
                <th scope="col">Order value</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((redemption, index) => (
                <tr key={redemption.id}>
                  <td>
                    <span className={sharedStyles["admin-person-cell"]}>
                      <span className={`${sharedStyles["admin-initials"]} ${index % 2 ? sharedStyles["admin-initials-yellow"] : ""}`} aria-hidden="true">
                        {initialsOf(redemption.customerName)}
                      </span>
                      <span>
                        <span className={dashboardStyles["admin-orders-customer"]}>{redemption.customerName}</span>
                        <span className={dashboardStyles["admin-orders-area"]}>{redemption.area}</span>
                      </span>
                    </span>
                  </td>
                  <td className={styles["admin-coupon-code-cell"]}>{redemption.code}</td>
                  <td className={dashboardStyles["admin-orders-muted"]}>{redemption.orderNumber}</td>
                  <td className={dashboardStyles["admin-orders-muted"]}>
                    {new Date(redemption.redeemedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </td>
                  <td className={styles["admin-coupon-discount-cell"]}>−{rupees(redemption.discount)}</td>
                  <td className={dashboardStyles["admin-orders-amount"]}>{rupees(redemption.orderValue)}</td>
                </tr>
              ))}
              {tableRows.length === 0 && (
                <tr>
                  <td colSpan={6} className={dashboardStyles["admin-orders-empty"]}>
                    No coupons were used in these dates.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {isShowingAll && (
          <AdminPagination page={page} pageSize={PAGE_SIZE} total={shownRedemptions.length} onPageChange={setPage} itemName="redemptions" />
        )}
      </section>

      {editing && form && (
        <AdminDialog
          title={editing === "new" ? "New coupon" : `Edit ${editing}`}
          submitLabel={editing === "new" ? "Create coupon" : "Save"}
          onClose={() => {
            setEditing(null);
            setNewCouponCartType(null);
          }}
          onSubmit={saveForm}
        >
          {editing === "new" && (
            <AdminDialogField label="Code">
              <input
                className={`${adminInputClassName} ${styles["admin-coupon-code-input"]}`}
                placeholder="FIRST50"
                value={form.code}
                onChange={(changeEvent) => setForm({ ...form, code: changeEvent.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15) })}
                autoFocus
              />
            </AdminDialogField>
          )}
          <AdminDialogField label="Type">
            <select className={adminInputClassName} value={form.kind} onChange={(changeEvent) => setForm({ ...form, kind: changeEvent.target.value as CouponKind })}>
              {COUPON_KINDS.map((kind) => (
                <option key={kind.key} value={kind.key}>
                  {kind.label}
                </option>
              ))}
            </select>
          </AdminDialogField>
          <AdminDialogField label={form.kind === "percent" ? "Discount (%)" : form.kind === "free-days" ? "Free days" : "Amount (₹)"}>
            <input
              className={adminInputClassName}
              inputMode="numeric"
              value={form.value}
              onChange={(changeEvent) => setForm({ ...form, value: changeEvent.target.value.replace(/\D/g, "").slice(0, 5) })}
            />
          </AdminDialogField>
          <AdminDialogField label="Applies to">
            <select className={adminInputClassName} value={form.appliesTo} onChange={(changeEvent) => setForm({ ...form, appliesTo: changeEvent.target.value })}>
              {COUPON_APPLIES_TO.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </AdminDialogField>
          <AdminDialogField label="Offer line (customers see this)" isWide>
            <input
              className={adminInputClassName}
              placeholder={Number(form.value) ? describe(form.kind, Number(form.value), form.appliesTo) : "e.g. ₹50 off the first order"}
              value={form.description}
              onChange={(changeEvent) => setForm({ ...form, description: changeEvent.target.value })}
            />
          </AdminDialogField>
          <AdminDialogField label="Minimum order (₹, optional)">
            <input
              className={adminInputClassName}
              inputMode="numeric"
              value={form.minOrder}
              onChange={(changeEvent) => setForm({ ...form, minOrder: changeEvent.target.value.replace(/\D/g, "") })}
            />
          </AdminDialogField>
          <AdminDialogField label="Use limit (empty: no limit)">
            <input
              className={adminInputClassName}
              inputMode="numeric"
              value={form.usageLimit}
              onChange={(changeEvent) => setForm({ ...form, usageLimit: changeEvent.target.value.replace(/\D/g, "") })}
            />
          </AdminDialogField>

          <div className={styles["admin-coupon-dates"]}>
            <span className={sharedStyles["admin-dialog-label"]}>Valid</span>
            <div className={styles["admin-coupon-dates-row"]}>
              <button
                type="button"
                className={`${adminInputClassName} ${styles["admin-coupon-dates-button"]}`}
                aria-expanded={isCalendarOpen}
                onClick={() => setIsCalendarOpen(!isCalendarOpen)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 6h16v14H4z" />
                  <path d="M4 10h16M8 3.5v4M16 3.5v4" />
                </svg>
                {form.hasNoExpiry
                  ? `From ${form.validFrom.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · no expiry`
                  : formatDateRange(form.validFrom, form.validTill)}
              </button>
              <label className={styles["admin-coupon-check"]}>
                <input type="checkbox" checked={form.hasNoExpiry} onChange={(changeEvent) => setForm({ ...form, hasNoExpiry: changeEvent.target.checked })} />
                No expiry
              </label>
            </div>
            {isCalendarOpen && (
              <div className={styles["admin-coupon-calendar-slot"]}>
                <AdminDateRangePicker
                  rangeFrom={form.validFrom}
                  rangeTo={form.hasNoExpiry ? form.validFrom : form.validTill}
                  today={today}
                  allowFutureDays
                  onChooseRange={(from, to) => {
                    setForm({ ...form, validFrom: from, validTill: to, hasNoExpiry: false });
                    setIsCalendarOpen(false);
                  }}
                />
              </div>
            )}
          </div>

          {editingCoupon && (
            <div className={styles["admin-coupon-edit-extras"]}>
              <label className={styles["admin-coupon-check"]}>
                <input type="checkbox" checked={form.isPaused} onChange={(changeEvent) => setForm({ ...form, isPaused: changeEvent.target.checked })} />
                Pause this coupon (customers can&rsquo;t use it until you switch it back on)
              </label>
              <p className={styles["admin-coupon-used-note"]}>
                Used {editingCoupon.used} {editingCoupon.used === 1 ? "time" : "times"} so far. The code can&rsquo;t be changed, as customers may already have it.
              </p>
              {isRemoveAsked ? (
                <div className={styles["admin-coupon-remove-confirm"]}>
                  <span>Delete {editingCoupon.code}? Customers will no longer be able to use it.</span>
                  <button type="button" className={styles["admin-coupon-remove-keep"]} onClick={() => setIsRemoveAsked(false)}>
                    Keep it
                  </button>
                  <button
                    type="button"
                    className={styles["admin-coupon-remove-yes"]}
                    onClick={() => {
                      removeCoupon(editingCoupon.code);
                      showToast(`${editingCoupon.code} deleted`);
                      setEditing(null);
                    }}
                  >
                    Yes, delete
                  </button>
                </div>
              ) : (
                canDelete && (
                  <button type="button" className={styles["admin-coupon-remove"]} onClick={() => setIsRemoveAsked(true)}>
                    Delete coupon
                  </button>
                )
              )}
            </div>
          )}
        </AdminDialog>
      )}

      {/* + Add on Coupons in the cart: tick existing coupons, or create a new one straight into the list */}
      {addingToCartType &&
        (() => {
          const cartTypeLabel = COUPON_CART_TYPES.find((cartType) => cartType.key === addingToCartType)?.label ?? "";
          const choices = coupons.filter((coupon) => !isCouponForCartType(coupon, addingToCartType));
          return (
            <AdminDialog
              title={`Add coupons to ${cartTypeLabel}`}
              submitLabel={tickedCodes.length ? `Add ${tickedCodes.length} selected` : "Add selected"}
              onClose={() => setAddingToCartType(null)}
              onSubmit={() => {
                if (tickedCodes.length === 0) {
                  showToast("Tick a coupon to add, or create a new one");
                  return;
                }
                addCouponsToCartType(tickedCodes, addingToCartType);
                showToast(`${tickedCodes.join(", ")} added to ${cartTypeLabel}`);
                setAddingToCartType(null);
              }}
            >
              <div className={styles["admin-cart-coupon-picker"]}>
                {choices.map((coupon) => {
                  const status = getCouponStatus(coupon, today);
                  return (
                    <label key={coupon.code} className={styles["admin-cart-coupon-choice"]}>
                      <input
                        type="checkbox"
                        checked={tickedCodes.includes(coupon.code)}
                        onChange={(changeEvent) =>
                          setTickedCodes(
                            changeEvent.target.checked
                              ? [...tickedCodes, coupon.code]
                              : tickedCodes.filter((code) => code !== coupon.code),
                          )
                        }
                      />
                      <span className={styles["admin-cart-coupon-item-words"]}>
                        <span className={styles["admin-cart-coupon-item-code"]}>{coupon.code}</span>
                        <span className={styles["admin-cart-coupon-item-description"]}>{coupon.description}</span>
                      </span>
                      <span className={`${dashboardStyles["admin-status"]} ${STATUS_CLASS_NAMES[status]}`}>{status}</span>
                    </label>
                  );
                })}
                {choices.length === 0 && <p className={styles["admin-cart-coupon-empty"]}>Every coupon is already in this list.</p>}
                <button
                  type="button"
                  className={styles["admin-cart-coupon-create"]}
                  onClick={() => {
                    setNewCouponCartType(addingToCartType);
                    setAddingToCartType(null);
                    openForm("new");
                  }}
                >
                  + Create new coupon
                </button>
              </div>
            </AdminDialog>
          );
        })()}

      {couponToDelete && (
        <AdminDialog
          title={`Delete ${couponToDelete.code}?`}
          submitLabel="Delete coupon"
          isDanger
          onClose={() => setCouponToDelete(null)}
          onSubmit={() => {
            removeCoupon(couponToDelete.code);
            showToast(`${couponToDelete.code} deleted`);
            setCouponToDelete(null);
          }}
        >
          <p className={styles["admin-coupon-delete-note"]}>
            {couponToDelete.description}. Customers will no longer be able to use it
            {couponToDelete.used ? `; the ${couponToDelete.used} times it was already used stay in the redemptions` : ""}. This
            cannot be undone. To stop it for a while instead, use Edit → Pause.
          </p>
        </AdminDialog>
      )}

      {toast}
    </div>
  );
}
