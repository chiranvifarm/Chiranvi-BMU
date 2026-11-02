import { useEffect, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";

/*
  Coupons and offers, saved in the Supabase "coupons" and "coupon_redemptions" tables
  (supabase/migrations/0011_server_prices_and_coupons.sql). No wallet: rewards are discounts on orders or plans.
  - The Chiranvi Panel (Coupons & offers page) reads and changes them, by the staff member's role
    (Coupons → View / Create / Edit / Delete). Customers can't read the list, so codes stay private.
  - Checkout asks the database whether a code works on the cart and how much it takes off (check_coupon);
    the order itself works the discount out again in the database (place_order), which also counts the use
    and records the redemption. So a discount can't be made up in a browser.
  - Status comes from the dates, the use limit and the pause switch: Active, Scheduled (starts later),
    Paused, Expired (ended or fully used).
  The list is read when the panel needs it and again when the window comes back into focus. A change shows
  at once and is then saved; if the database refuses it, the list is read again.
*/

export type CouponKind = "flat" | "percent" | "free-days" | "referral";
export type CouponStatus = "Active" | "Scheduled" | "Paused" | "Expired";

export type Coupon = {
  code: string; // FIRST50 (unique, capitals)
  description: string; // "₹50 off the first order"
  kind: CouponKind;
  value: number; // ₹ off, % off, free days, or ₹ reward
  minOrder?: number; // ₹
  appliesTo: string; // "All products", "Milk", "Ghee & butter", ...
  usageLimit: number | null; // null: no limit
  used: number;
  validFrom: string; // YYYY-MM-DD
  validTill: string | null; // YYYY-MM-DD, null: no expiry
  isPaused: boolean;
  cartTypes?: CouponCartType[]; // the carts it can be used in (coupons.cart_types; empty: none)
};

/*
  Which carts a coupon can be used in, chosen on Coupons & offers → "Coupons in the cart":
  only one-time products, only a milk plan, or a milk plan with one-time products.
*/
export type CouponCartType = "one-time" | "subscription" | "subscription-and-one-time";

export const COUPON_CART_TYPES: { key: CouponCartType; label: string; note: string }[] = [
  { key: "one-time", label: "One-time products", note: "Carts with only one-time products" },
  { key: "subscription", label: "Subscription", note: "Carts with only a milk plan" },
  { key: "subscription-and-one-time", label: "Subscription + one-time", note: "A milk plan with one-time products" },
];

export type Redemption = {
  id: string;
  code: string;
  customerName: string;
  area: string;
  orderNumber: string; // #CF-60004
  redeemedAt: string; // ISO date and time
  discount: number; // ₹
  orderValue: number; // ₹ before the discount
};

export const COUPON_KINDS: { key: CouponKind; label: string }[] = [
  { key: "flat", label: "₹ off" },
  { key: "percent", label: "% off" },
  { key: "free-days", label: "Free days of milk" },
  { key: "referral", label: "Referral reward (₹ each)" },
];

export const COUPON_APPLIES_TO = ["All products", "Milk", "Milk plans", "Paneer", "Ghee & butter", "Others"];

// The rows as the database keeps them
type CouponRow = {
  code: string;
  description: string;
  kind: CouponKind;
  value: number | string;
  min_order: number | string | null;
  applies_to: string;
  usage_limit: number | null;
  used: number;
  valid_from: string;
  valid_till: string | null;
  is_paused: boolean;
  cart_types: CouponCartType[];
};

type RedemptionRow = {
  id: string;
  code: string;
  order_number: string;
  customer_name: string;
  area: string;
  discount_paise: number;
  order_value_paise: number;
  redeemed_at: string;
};

function toCoupon(row: CouponRow): Coupon {
  return {
    code: row.code,
    description: row.description,
    kind: row.kind,
    value: Number(row.value),
    minOrder: row.min_order === null ? undefined : Number(row.min_order),
    appliesTo: row.applies_to,
    usageLimit: row.usage_limit,
    used: row.used,
    validFrom: row.valid_from,
    validTill: row.valid_till,
    isPaused: row.is_paused,
    cartTypes: row.cart_types ?? [],
  };
}

function toRow(coupon: Partial<Coupon>) {
  const row: Partial<CouponRow> = {};
  if (coupon.description !== undefined) row.description = coupon.description;
  if (coupon.kind !== undefined) row.kind = coupon.kind;
  if (coupon.value !== undefined) row.value = coupon.value;
  if ("minOrder" in coupon) row.min_order = coupon.minOrder ?? null;
  if (coupon.appliesTo !== undefined) row.applies_to = coupon.appliesTo;
  if ("usageLimit" in coupon) row.usage_limit = coupon.usageLimit ?? null;
  if (coupon.validFrom !== undefined) row.valid_from = coupon.validFrom;
  if ("validTill" in coupon) row.valid_till = coupon.validTill ?? null;
  if (coupon.isPaused !== undefined) row.is_paused = coupon.isPaused;
  if (coupon.cartTypes !== undefined) row.cart_types = coupon.cartTypes;
  return row;
}

function toRedemption(row: RedemptionRow): Redemption {
  return {
    id: row.id,
    code: row.code,
    customerName: row.customer_name,
    area: row.area,
    orderNumber: `#${row.order_number}`,
    redeemedAt: row.redeemed_at,
    discount: row.discount_paise / 100,
    orderValue: row.order_value_paise / 100,
  };
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const EMPTY_COUPONS: Coupon[] = [];
const EMPTY_REDEMPTIONS: Redemption[] = [];
let coupons: Coupon[] = EMPTY_COUPONS;
let redemptions: Redemption[] = EMPTY_REDEMPTIONS;
let isLoading = false;
let isFollowing = false;
const listeners = new Set<() => void>();

function announce() {
  listeners.forEach((onChange) => onChange());
}

// The database's rules decide what comes back: everything for staff with Coupons → View, nothing for others
async function loadCoupons() {
  if (isLoading) return;
  isLoading = true;
  const supabase = createClient();
  const [couponAnswer, redemptionAnswer] = await Promise.all([
    supabase.from("coupons").select("*").order("created_at", { ascending: false }),
    supabase.from("coupon_redemptions").select("*").order("redeemed_at", { ascending: false }).limit(1000),
  ]);
  isLoading = false;
  if (couponAnswer.error || redemptionAnswer.error) {
    console.error("Could not read the coupons", couponAnswer.error ?? redemptionAnswer.error);
    return;
  }
  coupons = ((couponAnswer.data ?? []) as CouponRow[]).map(toCoupon);
  redemptions = ((redemptionAnswer.data ?? []) as RedemptionRow[]).map(toRedemption);
  announce();
}

// Reads the list once, then again when the window comes back into focus or someone logs in / out
function startFollowingCoupons() {
  if (isFollowing || typeof window === "undefined") return;
  isFollowing = true;
  void loadCoupons();
  window.addEventListener("focus", () => void loadCoupons());
  createClient().auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") window.setTimeout(() => void loadCoupons(), 0);
  });
}

// After a change: show it at once, save it, and read the list again if the database refused it
async function saveThenCheck(change: () => void, write: () => PromiseLike<{ error: unknown }>) {
  change();
  announce();
  const { error } = await write();
  if (error) {
    console.error("The database did not accept the coupon change", error);
    void loadCoupons();
  }
}

export function getCouponStatus(coupon: Coupon, today = new Date()): CouponStatus {
  const todayKey = dayKey(today);
  if ((coupon.validTill && coupon.validTill < todayKey) || (coupon.usageLimit !== null && coupon.used >= coupon.usageLimit)) return "Expired";
  if (coupon.isPaused) return "Paused";
  if (coupon.validFrom > todayKey) return "Scheduled";
  return "Active";
}

export function addCoupon(coupon: Omit<Coupon, "used" | "isPaused">) {
  const newCoupon: Coupon = { ...coupon, used: 0, isPaused: false };
  void saveThenCheck(
    () => (coupons = [newCoupon, ...coupons]),
    () => createClient().from("coupons").insert({ code: newCoupon.code, ...toRow(newCoupon) }),
  );
  return newCoupon;
}

// Edit: the code itself does not change (customers may already have it)
export function updateCoupon(code: string, changes: Partial<Omit<Coupon, "code" | "used">>) {
  void saveThenCheck(
    () => (coupons = coupons.map((coupon) => (coupon.code === code ? { ...coupon, ...changes } : coupon))),
    () => createClient().from("coupons").update(toRow(changes)).eq("code", code),
  );
}

export function removeCoupon(code: string) {
  void saveThenCheck(
    () => (coupons = coupons.filter((coupon) => coupon.code !== code)),
    () => createClient().from("coupons").delete().eq("code", code),
  );
}

// Coupons in the cart: puts coupons in a cart type's list, or takes one out (saved in coupons.cart_types)
export function addCouponsToCartType(codes: string[], cartType: CouponCartType) {
  for (const coupon of coupons) {
    if (!codes.includes(coupon.code) || coupon.cartTypes?.includes(cartType)) continue;
    updateCoupon(coupon.code, { cartTypes: [...(coupon.cartTypes ?? []), cartType] });
  }
}

export function removeCouponFromCartType(code: string, cartType: CouponCartType) {
  const coupon = coupons.find((existing) => existing.code === code);
  if (coupon) updateCoupon(code, { cartTypes: (coupon.cartTypes ?? []).filter((existing) => existing !== cartType) });
}

export function isCouponForCartType(coupon: Coupon, cartType: CouponCartType) {
  return Boolean(coupon.cartTypes?.includes(cartType));
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  startFollowingCoupons();
  return () => {
    listeners.delete(onChange);
  };
}

export function useCoupons() {
  return useSyncExternalStore(subscribe, () => coupons, () => EMPTY_COUPONS);
}

export function useRedemptions() {
  return useSyncExternalStore(subscribe, () => redemptions, () => EMPTY_REDEMPTIONS);
}

// ---------- Checkout: the database checks the code ----------

// The cart as check_coupon needs it: the one-time items, and the milk plan if there is one
export type CouponCart = {
  items: { productId: string; quantity: number }[];
  plan: { productId: string; planId: string; months: number; days: number; bottlesPerDay: number } | null;
};

export type CouponCheck = { code: string; description: string; discount: number; isForPlan: boolean } | { error: string };

/*
  Whether a code works on this cart and what it takes off (₹), worked out by the database with today's
  prices. With a plan in the cart it is tried on the plan first, then on the items.
*/
export async function checkCouponOnServer(code: string, cart: CouponCart): Promise<CouponCheck> {
  const { data, error } = await createClient().rpc("check_coupon", { code: code.trim().toUpperCase(), cart });
  if (error || !data) {
    console.error("Could not check the coupon", error);
    return { error: "Couldn't check the code. Check your internet and try again." };
  }
  const answer = data as { code?: string; description?: string; discount?: number; isForPlan?: boolean; error?: string };
  if (answer.error || !answer.code) return { error: answer.error ?? "This code doesn't exist" };
  return { code: answer.code, description: answer.description ?? "", discount: Number(answer.discount ?? 0), isForPlan: Boolean(answer.isForPlan) };
}

/*
  The applied code, checked again whenever the cart changes (null while the database is answering, or with
  no code). The answer is kept for this exact cart, so an old answer never shows for a changed cart.
*/
export function useCouponCheck(code: string | null, cart: CouponCart): CouponCheck | null {
  const cartKey = code ? JSON.stringify([code, cart]) : "";
  const [checked, setChecked] = useState<{ key: string; result: CouponCheck } | null>(null);
  useEffect(() => {
    if (!code || !cartKey) return;
    let isCurrent = true;
    void checkCouponOnServer(code, cart).then((result) => {
      if (isCurrent) setChecked({ key: cartKey, result });
    });
    return () => {
      isCurrent = false;
    };
    // cartKey holds the code and the cart
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey]);
  return checked && checked.key === cartKey ? checked.result : null;
}

// A coupon in the cart's drop-down, with why it can't be used on this cart (no problem: it works)
export type CartCouponChoice = { code: string; description: string; problem: string | null };

/*
  The cart's coupon drop-down: the running coupons the owner put in this cart's list (Coupons & offers →
  Coupons in the cart), each checked by the database on this cart. Only for logged-in customers; other codes
  stay private. Read again whenever the cart changes; empty until the database answers.
*/
export function useCartCoupons(cart: CouponCart): CartCouponChoice[] {
  const cartKey = JSON.stringify(cart);
  const [listed, setListed] = useState<{ key: string; choices: CartCouponChoice[] } | null>(null);
  useEffect(() => {
    let isCurrent = true;
    void createClient()
      .rpc("cart_coupons", { cart })
      .then(({ data, error }) => {
        if (error) console.error("Could not read the cart's coupons", error);
        const rows = Array.isArray(data) ? (data as { code: string; description: string; error: string | null }[]) : [];
        if (isCurrent) setListed({ key: cartKey, choices: rows.map((row) => ({ code: row.code, description: row.description, problem: row.error })) });
      });
    return () => {
      isCurrent = false;
    };
    // cartKey holds the cart
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey]);
  return listed?.choices ?? EMPTY_CART_COUPONS;
}

const EMPTY_CART_COUPONS: CartCouponChoice[] = [];
