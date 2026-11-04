import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ProductPage } from "@/components/product/product-page-data";

/*
  Delivery charges and the platform fee, set by the owner on Products & pricing → "Set delivery charge" and
  saved in the database (app_settings rows, supabase/migrations/0012_delivery_charges_and_platform_fee.sql):
  - the overall charge (e.g. ₹30), the order amount from which delivery is free (e.g. ₹500), and how a cart
    whose products have different charges pays: the highest one, all of them added up, or a fixed charge;
  - each product's own setting: free delivery, its own charge, or an offer (a lower charge, or free when
    that product's total reaches an amount). No setting: the overall charge;
  - the platform fee: only with a milk plan, once per checkout (one-time items alone pay none).
  quoteDelivery() shows the cart what it charges. The order itself is charged by the database (start_checkout)
  with the same rules, so a charge changed in a browser never reaches an order. A milk plan in the cart
  always means free delivery.
*/

export type DeliveryCombineRule = "highest" | "sum" | "fixed";
export type ProductDeliveryMode = "standard" | "free" | "own" | "offer-lower" | "offer-free-above";

export type ProductDeliverySetting = {
  mode: Exclude<ProductDeliveryMode, "standard">;
  fee?: number; // ₹: own charge, or the offer's lower charge
  freeAbove?: number; // ₹: offer-free-above
};

export type DeliverySettings = {
  fee: number; // ₹ the overall charge
  freeFrom: number; // ₹ orders from this amount (after discounts) are free
  combineRule: DeliveryCombineRule;
  mixedFee: number; // ₹ with the fixed rule, when the products' charges differ
  products: Record<string, ProductDeliverySetting>; // by product id (page slug / product card id)
  platformFee: number; // ₹ once per checkout with a milk plan
};

// Until the database answers: the rules the shop started with
const STARTING_SETTINGS: DeliverySettings = {
  fee: 30,
  freeFrom: 500,
  combineRule: "highest",
  mixedFee: 40,
  products: {},
  platformFee: 750,
};

const SETTING_KEYS = [
  "delivery_fee_paise",
  "free_delivery_from_paise",
  "delivery_combine_rule",
  "delivery_mixed_cart_fee_paise",
  "delivery_product_rules",
  "platform_fee_paise",
];

// A product's setting as the database keeps it (paise)
type ProductRuleRow = { mode: ProductDeliverySetting["mode"]; feePaise?: number; freeAbovePaise?: number };

let settings: DeliverySettings = STARTING_SETTINGS;
let isFollowing = false;
const listeners = new Set<() => void>();

// Everyone may read the settings (the cart shows the charge); a missing row keeps its starting value
async function loadDeliverySettings() {
  const { data, error } = await createClient().from("app_settings").select("key, value").in("key", SETTING_KEYS);
  if (error) {
    console.error("Could not read the delivery charges", error);
    return;
  }
  const saved = new Map((data ?? []).map((row) => [row.key as string, row.value as unknown]));
  const rupeesOf = (key: string, fallback: number) => (Number.isFinite(Number(saved.get(key))) ? Number(saved.get(key)) / 100 : fallback);
  const rule = saved.get("delivery_combine_rule");
  const productRules = (saved.get("delivery_product_rules") ?? {}) as Record<string, ProductRuleRow>;
  const products: Record<string, ProductDeliverySetting> = {};
  for (const [productId, row] of Object.entries(productRules)) {
    products[productId] = {
      mode: row.mode,
      fee: row.feePaise === undefined ? undefined : row.feePaise / 100,
      freeAbove: row.freeAbovePaise === undefined ? undefined : row.freeAbovePaise / 100,
    };
  }
  settings = {
    fee: rupeesOf("delivery_fee_paise", STARTING_SETTINGS.fee),
    freeFrom: rupeesOf("free_delivery_from_paise", STARTING_SETTINGS.freeFrom),
    combineRule: rule === "sum" || rule === "fixed" ? rule : "highest",
    mixedFee: rupeesOf("delivery_mixed_cart_fee_paise", STARTING_SETTINGS.mixedFee),
    products,
    platformFee: rupeesOf("platform_fee_paise", STARTING_SETTINGS.platformFee),
  };
  listeners.forEach((onChange) => onChange());
}

// Read once, then again when the window comes back into focus (the owner may have changed them)
function startFollowingDeliverySettings() {
  if (isFollowing || typeof window === "undefined") return;
  isFollowing = true;
  void loadDeliverySettings();
  window.addEventListener("focus", () => void loadDeliverySettings());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  startFollowingDeliverySettings();
  return () => {
    listeners.delete(onChange);
  };
}

export function useDeliverySettings() {
  return useSyncExternalStore(subscribe, () => settings, () => STARTING_SETTINGS);
}

/*
  The product a cart line belongs to (its delivery setting is kept by product):
    milk '<slug>' or '<slug>-half-litre', a pack '<slug>-<packId>', otherwise the product card's own id.
*/
export function productIdOfCartItem(cartProductId: string, pages: ProductPage[]) {
  const page = pages.find(
    (candidate) =>
      candidate.slug === cartProductId ||
      cartProductId === `${candidate.slug}-half-litre` ||
      ("packs" in candidate && candidate.packs.some((pack) => `${candidate.slug}-${pack.packId}` === cartProductId)),
  );
  return page?.slug ?? cartProductId;
}

function combine(fees: number[], rule: DeliveryCombineRule, mixedFee: number) {
  if (fees.length === 0) return 0;
  if (rule === "sum") return fees.reduce((sum, fee) => sum + fee, 0);
  if (rule === "fixed") return new Set(fees).size === 1 ? fees[0] : mixedFee;
  return Math.max(...fees);
}

/*
  The delivery charge for the cart's one-time lines (the same rules as the database's delivery_fee()): free
  with a milk plan or from the free-delivery amount, otherwise each product's charge combined by the owner's
  rule. crossedOutFee: the charge before free delivery or an offer, shown struck through.
*/
export function quoteDelivery(
  lines: { productId: string; total: number }[],
  afterDiscounts: number,
  hasPlan: boolean,
  deliverySettings: DeliverySettings,
) {
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.total);
  const fees: number[] = [];
  const feesBeforeOffers: number[] = [];
  for (const [productId, total] of totals) {
    const setting = deliverySettings.products[productId];
    let fee = deliverySettings.fee;
    let feeBeforeOffer = deliverySettings.fee;
    if (setting?.mode === "free") {
      fee = 0;
      feeBeforeOffer = 0;
    } else if (setting?.mode === "own") {
      fee = setting.fee ?? deliverySettings.fee;
      feeBeforeOffer = fee;
    } else if (setting?.mode === "offer-lower") {
      fee = setting.fee ?? deliverySettings.fee;
    } else if (setting?.mode === "offer-free-above" && total >= (setting.freeAbove ?? Infinity)) {
      fee = 0;
    }
    fees.push(fee);
    feesBeforeOffers.push(feeBeforeOffer);
  }
  const feeBeforeOffers = combine(feesBeforeOffers, deliverySettings.combineRule, deliverySettings.mixedFee);
  const isFreeForOrder = hasPlan || lines.length === 0 || afterDiscounts >= deliverySettings.freeFrom;
  const fee = isFreeForOrder ? 0 : combine(fees, deliverySettings.combineRule, deliverySettings.mixedFee);
  const crossedOutFee = Math.max(feeBeforeOffers, fee) > fee ? Math.max(feeBeforeOffers, fee) : null;
  return {
    fee,
    crossedOutFee,
    // "Add ₹… more" for free delivery (only while a charge is being paid)
    amountToFreeDelivery: !isFreeForOrder && fee > 0 ? Math.max(0, deliverySettings.freeFrom - afterDiscounts) : 0,
  };
}

/*
  The owner saves the pop-up: the overall settings and every product's setting together ("standard" = pays
  the overall charge, so it isn't kept). The database's save_delivery_settings() checks that it is the
  owner and the amounts, and saves all of it or nothing. Answers an error message, or null.
*/
export async function saveDeliverySettings(details: {
  fee: number;
  freeFrom: number;
  combineRule: DeliveryCombineRule;
  mixedFee: number;
  products: { productId: string; mode: ProductDeliveryMode; fee?: number; freeAbove?: number }[];
}) {
  const { error } = await createClient().rpc("save_delivery_settings", {
    details: { ...details, products: details.products.filter((product) => product.mode !== "standard") },
  });
  if (error) {
    console.error("The database did not accept the delivery charges", error);
    return error.code === "P0001" && error.message ? error.message : "Couldn't save the delivery charges. Please try again.";
  }
  await loadDeliverySettings();
  return null;
}
