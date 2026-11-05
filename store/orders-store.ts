import { useMemo, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { markPanelPageSeen, useIsAccountStateLoaded, usePanelSeenAt } from "./account-state";
import { useLoggedInMobileNumber } from "@/components/login/login-status";
import type { CartItem } from "./cart-store";
import type { OrderPaymentMethod } from "./admin-orders-store";
import type { MapPin } from "./address-store";
import { getCustomerProfile } from "./customer-profiles-store";

/*
  Customers' orders, saved in the Supabase "orders" and "order_items" tables
  (supabase/migrations/0010_orders.sql).
  "Pay now" on the cart page (checkout) saves the order through the database's start_checkout() (it fills
  in who ordered from the login, the order number CF-60001 … and the promised delivery, the next day by
  7 AM), and Razorpay takes the payment; the order counts only once the payment is confirmed (see
  startPayment() below). Orders from before online payments are marked "not_charged".
  The database's rules decide which orders come back: a customer gets their own (My Orders, My
  Subscription), staff with Orders → View get every order (the Chiranvi Panel's Orders page uses the same
  list). When the panel moves an order along (Packed, Out for delivery, Delivered), it changes the same row,
  so the customer's tracker follows.
  Orders are never kept in the browser: the old browser copy (from before the database, which also held other
  customers' orders) is deleted.

  Order steps, in order: placed -> packed -> out-for-delivery -> delivered (or cancelled).
  A new order starts at "placed".
*/

export type OrderStatus = "placed" | "packed" | "out-for-delivery" | "delivered" | "cancelled";

export type Order = {
  orderId: string;
  placedAt: number; // time in milliseconds
  items: CartItem[];
  total: number; // what the customer pays (after discounts, coupon and delivery fee)
  status: OrderStatus;
  // From the checkout (orders placed before these were added have none)
  couponCode?: string;
  couponDiscount?: number;
  deliveryFee?: number;
  deliverTo?: string; // "Priya Raman · 12, 4th Cross, Jayanagar 4th Block, Bengaluru 560011"
  deliveryMobile?: string; // 10 digits, the delivery address's mobile number (can be someone else's)
  subscription?: OrderSubscription; // only on a milk subscription order
  // Who ordered, how they paid, and when it was promised (orders placed before these were added have none)
  customerMobile?: string; // 10 digits, the login number
  customerId?: string; // CUS-6384 (once their profile is saved)
  paymentMethod?: OrderPaymentMethod;
  promisedAt?: number; // time in milliseconds: the next day by 7 AM
  statusChangedAt?: Partial<Record<OrderStatus, number>>; // when each step was reached
  // Saved in the database (orders placed before that were kept only in the browser)
  isSaved?: boolean;
  customerName?: string; // the name the order was saved with (the panel's Customer)
  area?: string; // the delivery address's area (the panel's Location)
  // Razorpay (orders paid online; older ones are "not_charged")
  paymentStatus?: OrderPaymentStatus;
  paidAt?: number; // time in milliseconds
  razorpayPaymentId?: string; // pay_…
  paymentFailureReason?: string; // Razorpay's reason, on a failed payment's receipt
  platformFee?: number; // ₹ (once per checkout)
  deliveryPin?: MapPin; // the delivery address's map pin (from the customer's saved address, or the agent at the door)
};

export type OrderPaymentStatus = "not_charged" | "paid" | "failed" | "refunded";

// The plan bought with a subscription order (shown on My Subscription)
export type OrderSubscription = {
  planId?: string; // the page's plan ("6-months"); the database prices the plan from it
  planName: string; // "6 Months"
  months: number;
  days: number;
  bottlesPerDay: number;
  pricePerLitre: number;
  bottleCount: number;
  extendsOrderId?: string; // set when this order adds days to an earlier plan instead of starting one
  bottleLabel?: string; // "500 ml" (missing: "1 L")
  unitName?: string; // what the price is per: "500 ml" (missing: "litre")
  pausedDays?: number; // approved pauses: the plan ends this many days later (kept by the database)
  deliveredDays?: string[]; // days the agent marked delivered ("2026-11-06"; kept by the database)
};

// What the checkout adds to an order
export type CheckoutDetails = {
  total: number;
  couponCode?: string;
  couponDiscount?: number;
  deliveryFee: number;
  deliverTo: string;
  deliveryMobile?: string; // 10 digits, the delivery address's mobile number
  area?: string; // the delivery address's area (for the panel's Location)
  paymentMethod?: OrderPaymentMethod;
  subscription?: OrderSubscription;
  planOrderNumber?: string; // the plan placed just before in the same checkout (these items then get free delivery)
  cartType?: "subscription" | "subscription-and-one-time"; // a plan's order: alone, or with one-time items (which coupon list)
  addressId?: string; // the saved address it goes to (linked after payment: its map pin reaches the delivery agent)
};

// The browser's old copy of orders (from before the database): deleted, never read
const OLD_ORDERS_STORAGE_KEY = "chiranvi-orders";
const noOrders: Order[] = [];
const ordersListeners = new Set<() => void>();

function announceOrders() {
  ordersListeners.forEach((onChange) => onChange());
}

// ---------- Orders in the database ----------

type OrderItemRow = {
  position: number;
  product_id: string;
  name: string;
  pack_size: string;
  quantity: number;
  price_paise: number;
  item: Partial<CartItem> | null; // the whole cart line as the website showed it
};

type OrderRow = {
  order_number: string;
  customer_mobile: string;
  customer_code: string | null;
  customer_name: string;
  area: string;
  status: OrderStatus;
  status_changed_at: Partial<Record<OrderStatus, number>> | null;
  total_paise: number;
  delivery_fee_paise: number;
  coupon_code: string | null;
  coupon_discount_paise: number | null;
  payment_method: OrderPaymentMethod;
  deliver_to: string;
  delivery_mobile: string | null;
  subscription: OrderSubscription | null;
  placed_at: string;
  promised_at: string;
  order_items: OrderItemRow[] | null;
  payment_status: OrderPaymentStatus;
  paid_at: string | null;
  razorpay_payment_id: string | null;
  payment_failure_reason: string | null;
  platform_fee_paise: number | null;
  delivery_latitude: number | null;
  delivery_longitude: number | null;
};

// Read again this often while the page is open: new orders reach the panel, and a customer's tracker
// follows the panel's steps
const ORDERS_REFRESH_EVERY_MS = 30_000;

let savedOrders: Order[] = noOrders;
let isLoadingSavedOrders = false;
let isFollowingSavedOrders = false;

// The database keeps money in paise; the website shows rupees
function toOrder(row: OrderRow): Order {
  return {
    orderId: row.order_number,
    placedAt: new Date(row.placed_at).getTime(),
    items: [...(row.order_items ?? [])]
      .sort((first, second) => first.position - second.position)
      .map((line) => ({
        ...(line.item as CartItem),
        productId: line.product_id,
        name: line.name,
        packSize: line.pack_size,
        quantity: line.quantity,
        price: line.price_paise / 100,
      })),
    total: row.total_paise / 100,
    status: row.status,
    couponCode: row.coupon_code ?? undefined,
    couponDiscount: row.coupon_discount_paise === null ? undefined : row.coupon_discount_paise / 100,
    deliveryFee: row.delivery_fee_paise / 100,
    deliverTo: row.deliver_to,
    deliveryMobile: row.delivery_mobile ?? undefined,
    subscription: row.subscription ?? undefined,
    customerMobile: row.customer_mobile,
    customerId: row.customer_code ?? undefined,
    paymentMethod: row.payment_method,
    promisedAt: new Date(row.promised_at).getTime(),
    statusChangedAt: row.status_changed_at ?? undefined,
    isSaved: true,
    customerName: row.customer_name,
    area: row.area,
    paymentStatus: row.payment_status,
    paidAt: row.paid_at ? new Date(row.paid_at).getTime() : undefined,
    razorpayPaymentId: row.razorpay_payment_id ?? undefined,
    paymentFailureReason: row.payment_failure_reason ?? undefined,
    platformFee: row.platform_fee_paise === null ? undefined : row.platform_fee_paise / 100,
    deliveryPin:
      row.delivery_latitude !== null && row.delivery_longitude !== null
        ? { latitude: row.delivery_latitude, longitude: row.delivery_longitude }
        : undefined,
  };
}

/*
  A customer's failed online payments (the database shows them only to that customer): not orders (nothing
  to pack or deliver), kept apart for their "Payment failed" receipts on My Orders.
*/
let failedPayments: Order[] = noOrders;

async function loadSavedOrders() {
  if (isLoadingSavedOrders) return;
  isLoadingSavedOrders = true;
  const supabase = createClient();
  // Logged out: no orders (visitors may not read the table at all, so don't ask)
  const { data: login } = await supabase.auth.getSession();
  if (!login.session) {
    isLoadingSavedOrders = false;
    if (savedOrders !== noOrders || failedPayments !== noOrders) {
      savedOrders = noOrders;
      failedPayments = noOrders;
      announceOrders();
    }
    return;
  }
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .order("placed_at", { ascending: false });
  isLoadingSavedOrders = false;
  if (error) {
    console.error("Could not read the orders", error);
    return;
  }
  const rows = (data ?? []) as OrderRow[];
  savedOrders = rows.filter((row) => row.payment_status !== "failed").map(toOrder);
  failedPayments = rows.filter((row) => row.payment_status === "failed").map(toOrder);
  announceOrders();
}

// Reads the orders once, then again on focus, when someone logs in / out, and every 30 seconds while visible
function startFollowingSavedOrders() {
  if (isFollowingSavedOrders || typeof window === "undefined") return;
  isFollowingSavedOrders = true;
  void loadSavedOrders();
  window.addEventListener("focus", () => void loadSavedOrders());
  window.setInterval(() => {
    if (document.visibilityState === "visible") void loadSavedOrders();
  }, ORDERS_REFRESH_EVERY_MS);
  createClient().auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") window.setTimeout(() => void loadSavedOrders(), 0);
  });
}

// For the Chiranvi Panel: every saved order the logged-in staff member may see, newest first
export function getSavedOrders() {
  return savedOrders;
}

export function followSavedOrders(onChange: () => void) {
  ordersListeners.add(onChange);
  startFollowingSavedOrders();
  return () => {
    ordersListeners.delete(onChange);
  };
}

/*
  The panel moved a saved order along: shown at once, then saved (only the step and its time; the database
  refuses anything else). If the database refuses it (no Orders → Edit), the orders are read again.
*/
export async function setSavedOrderStatus(orderId: string, status: OrderStatus) {
  const order = savedOrders.find((saved) => saved.orderId === orderId);
  if (!order) return;
  const statusChangedAt = { ...order.statusChangedAt, [status]: Date.now() };
  savedOrders = savedOrders.map((saved) => (saved.orderId === orderId ? { ...saved, status, statusChangedAt } : saved));
  announceOrders();
  const { error, count } = await createClient()
    .from("orders")
    .update({ status, status_changed_at: statusChangedAt }, { count: "exact" })
    .eq("order_number", orderId);
  if (error || count === 0) {
    console.error("Could not change the order", error);
    void loadSavedOrders();
  }
}

function getAllOrders() {
  return savedOrders;
}

function subscribeToOrders(onChange: () => void) {
  ordersListeners.add(onChange);
  startFollowingSavedOrders();
  try {
    window.localStorage.removeItem(OLD_ORDERS_STORAGE_KEY);
  } catch {
    // Storage blocked: nothing kept to delete.
  }
  return () => {
    ordersListeners.delete(onChange);
  };
}

// The logged-in customer's orders, newest first. Logged out, and on the server, there are none.
export function useOrders() {
  const allOrders = useSyncExternalStore(subscribeToOrders, getAllOrders, () => noOrders);
  const mobileNumber = useLoggedInMobileNumber();
  return useMemo(
    () => (mobileNumber ? allOrders.filter((order) => order.customerMobile === mobileNumber) : noOrders),
    [allOrders, mobileNumber],
  );
}

// The logged-in customer's failed online payments, newest first (for their receipts on My Orders)
export function useFailedPayments() {
  return useSyncExternalStore(followSavedOrders, () => failedPayments, () => noOrders);
}

// My Orders: the customer's orders and their failed payments together, newest first
export function useOrdersAndFailedPayments() {
  const orders = useOrders();
  const failed = useFailedPayments();
  return useMemo(() => (failed.length === 0 ? orders : [...orders, ...failed].sort((first, second) => second.placedAt - first.placedAt)), [orders, failed]);
}

// A payment that did not go through: no order was placed (only its receipt is kept)
export function isFailedPayment(order: Order) {
  return order.paymentStatus === "failed";
}

/*
  What's new on the customer's orders: each step reached (Packed, Out for delivery, Delivered, Cancelled) since
  they last opened My Orders, newest first, for the pop-up message and the badge next to Orders. Worked out
  from the orders' own step times; "last opened" is kept with their login. Never opened: the last 24 hours.
*/
export type OrderUpdate = { orderId: string; status: OrderStatus; at: number };

const NO_UPDATES: OrderUpdate[] = [];

export function useOrderUpdates() {
  const orders = useOrders();
  const lastSeen = usePanelSeenAt("my-orders");
  const isAccountStateLoaded = useIsAccountStateLoaded();
  const [dayAgo] = useState(() => Date.now() - DAY_IN_MILLISECONDS);
  return useMemo(() => {
    if (!isAccountStateLoaded) return NO_UPDATES;
    const since = lastSeen ? new Date(lastSeen).getTime() : dayAgo;
    return orders
      .flatMap((order) =>
        (Object.entries(order.statusChangedAt ?? {}) as [OrderStatus, number][])
          .filter(([status, at]) => status !== "placed" && at > since)
          .map(([status, at]) => ({ orderId: order.orderId, status, at })),
      )
      .sort((first, second) => second.at - first.at);
  }, [orders, lastSeen, isAccountStateLoaded, dayAgo]);
}

// My Orders was opened: the updates are seen
export function markOrderUpdatesSeen() {
  markPanelPageSeen("my-orders");
}

// Paid (or placed before payments) and not yet delivered or cancelled
export function isOnItsWay(order: Order) {
  return !isFailedPayment(order) && order.status !== "delivered" && order.status !== "cancelled";
}

// The logged-in number, read from the login saved in this browser
function readLoggedInMobileNumber(): string | null {
  try {
    const savedLogin = JSON.parse(window.localStorage.getItem("chiranvi-login") ?? "null");
    return typeof savedLogin?.mobileNumber === "string" ? savedLogin.mobileNumber : null;
  } catch {
    return null;
  }
}

// Orders still on their way (shown as the badge next to "Orders" in the dashboard sidebar).
export function countActiveOrders(orderList: Order[]) {
  return orderList.filter((order) => order.status !== "delivered" && order.status !== "cancelled").length;
}

// Today's price of a cart line, as the database works it out (the same as an order will be charged)
export type CartLinePrice = { productId: string; isFound: boolean; isAvailable: boolean; price: number; originalPrice: number };

// Today's prices for these products (the cart page keeps itself up to date with it); null if it couldn't ask
export async function priceCartOnServer(productIds: string[]): Promise<CartLinePrice[] | null> {
  if (productIds.length === 0) return [];
  const { data, error } = await createClient().rpc("price_cart", { items: productIds.map((productId) => ({ productId })) });
  if (error || !Array.isArray(data)) {
    console.error("Could not check the cart's prices", error);
    return null;
  }
  return (data as CartLinePrice[]).map((line) => ({ ...line, price: Number(line.price), originalPrice: Number(line.originalPrice) }));
}

// A saved order as the database answers it (mark_checkout_paid), with its own prices and amounts (₹)
type PlacedOrderAnswer = {
  kind?: "plan" | "items";
  paymentStatus?: OrderPaymentStatus;
  paidAt?: number | null;
  razorpayPaymentId?: string | null;
  platformFee?: number | null;
  orderNumber: string;
  placedAt: number;
  promisedAt: number;
  customerName: string;
  customerCode: string | null;
  area: string;
  total: number;
  deliveryFee: number;
  couponCode: string | null;
  couponDiscount: number | null;
  items: CartItem[];
  subscription: OrderSubscription | null;
};

// Why an order wasn't taken: prices changed since the cart was filled, a product can't be ordered, the coupon
export type PlaceOrderProblem = { error: string; reason?: "prices" | "unavailable" | "coupon" };

/*
  "Pay now" with Razorpay (app/api/payments/*). The cart sends the milk plan's order and / or the one-time
  items' order (products and quantities, the coupon code, the address) and the total the customer saw:
    startPayment()         the database prices and saves them awaiting payment (one payment for both), and
                           Razorpay gets an order for exactly that amount; the cart then opens the pop-up.
                           Prices changed, a product sold out or a coupon gone: nothing is saved, the reason
                           comes back ("prices" / "unavailable" / "coupon").
    confirmPayment()       after the pop-up: our server checks Razorpay's signature and marks them paid; then
                           they count here (rememberPlacedOrder).
    reportFailedPayment()  a failed attempt: our server asks Razorpay and keeps a "Payment failed" receipt.
*/
export type CheckoutPart = { cartItems: CartItem[]; checkout: CheckoutDetails };
export type StartedPayment = { razorpayOrderId: string; amount: number; currency: string; keyId: string };
type RazorpaySuccess = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };

function detailsOf(part: CheckoutPart | null) {
  return part ? { ...part.checkout, paymentMethod: part.checkout.paymentMethod ?? "UPI", items: part.cartItems } : null;
}

export async function startPayment(plan: CheckoutPart | null, items: CheckoutPart | null, shownTotal: number): Promise<StartedPayment | PlaceOrderProblem> {
  const reply = (await fetch("/api/payments/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planOrder: detailsOf(plan), itemsOrder: detailsOf(items), shownTotal }),
  })
    .then((response) => response.json())
    .catch(() => null)) as (Partial<StartedPayment> & { error?: string; reason?: string }) | null;
  if (!reply) return { error: "Couldn't start the payment. Check your internet and try again." };
  if (reply.razorpayOrderId && reply.amount && reply.currency && reply.keyId) {
    return { razorpayOrderId: reply.razorpayOrderId, amount: reply.amount, currency: reply.currency, keyId: reply.keyId };
  }
  if (reply.reason === "login") return { error: "Please log in again to pay." };
  const reason = reply.reason === "prices" || reply.reason === "unavailable" || reply.reason === "coupon" ? reply.reason : undefined;
  return { error: reply.error ?? "Couldn't start the payment. Please try again.", reason };
}

export async function confirmPayment(
  success: RazorpaySuccess,
  plan: CheckoutPart | null,
  items: CheckoutPart | null,
): Promise<{ planOrder: Order | null; itemsOrder: Order | null } | PlaceOrderProblem> {
  const reply = (await fetch("/api/payments/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(success),
  })
    .then((response) => response.json())
    .catch(() => null)) as { verified?: boolean; orders?: PlacedOrderAnswer[] } | null;
  if (!reply?.verified || !reply.orders) {
    return {
      error: `We couldn't confirm your payment yet. If money left your account, your order will appear in My Orders shortly. Payment ID: ${success.razorpay_payment_id}.`,
    };
  }
  const planAnswer = reply.orders.find((answer) => answer.kind === "plan");
  const itemsAnswer = reply.orders.find((answer) => answer.kind === "items");
  // Each paid order is linked to its saved address (the database copies the address's map pin itself)
  if (plan && planAnswer) void linkOrderToAddress(planAnswer.orderNumber, plan.checkout.addressId);
  if (items && itemsAnswer) void linkOrderToAddress(itemsAnswer.orderNumber, items.checkout.addressId);
  return {
    planOrder: plan && planAnswer ? rememberPlacedOrder(planAnswer, plan.cartItems, plan.checkout) : null,
    itemsOrder: items && itemsAnswer ? rememberPlacedOrder(itemsAnswer, items.cartItems, items.checkout) : null,
  };
}

/*
  The order and the saved address it goes to (0027_address_pins.sql): only the customer's own order and
  address, once, before it goes out. The address's pin, now or added later, then reaches the delivery agent's
  stop. Not linked (the page was closed, an extended plan): the agent gets the address text.
*/
async function linkOrderToAddress(orderNumber: string, addressId: string | undefined) {
  if (!addressId) return;
  const { error } = await createClient().rpc("link_order_address", { p_order_number: orderNumber, p_address_id: addressId });
  if (error) console.error("Could not link the order to its address", error);
}

export function reportFailedPayment(razorpayOrderId: string, razorpayPaymentId: string) {
  void fetch("/api/payments/failed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ razorpay_order_id: razorpayOrderId, razorpay_payment_id: razorpayPaymentId }),
  })
    .then(() => loadSavedOrders())
    .catch(() => {});
}

/*
  A paid order (as the database saved it, with its own prices and amounts) joins My Orders. The database
  itself counts it on the customer's record on the panel's Customers page, adds a new milk plan to
  Subscriptions, and lists the payment on Payments. Answers the order as the website shows it.
*/
function rememberPlacedOrder(answer: PlacedOrderAnswer, cartItems: CartItem[], checkout: CheckoutDetails): Order {
  const customerMobile = readLoggedInMobileNumber() ?? "";
  const profile = customerMobile ? getCustomerProfile(customerMobile) : null;
  const paymentMethod = checkout.paymentMethod ?? "UPI";
  const newOrder: Order = {
    orderId: answer.orderNumber,
    placedAt: answer.placedAt,
    items: answer.items ?? cartItems,
    total: answer.total,
    status: "placed",
    couponCode: answer.couponCode ?? undefined,
    couponDiscount: answer.couponDiscount ?? undefined,
    deliveryFee: answer.deliveryFee,
    deliverTo: checkout.deliverTo,
    deliveryMobile: checkout.deliveryMobile,
    subscription: answer.subscription ?? undefined,
    paymentMethod,
    customerMobile,
    customerId: answer.customerCode ?? profile?.customerId,
    promisedAt: answer.promisedAt,
    statusChangedAt: { placed: answer.placedAt },
    isSaved: true,
    customerName: answer.customerName,
    area: answer.area,
    paymentStatus: answer.paymentStatus ?? "paid",
    paidAt: answer.paidAt ?? undefined,
    razorpayPaymentId: answer.razorpayPaymentId ?? undefined,
    platformFee: answer.platformFee ?? undefined,
  };
  savedOrders = [newOrder, ...savedOrders.filter((order) => order.orderId !== newOrder.orderId)];
  announceOrders();
  return newOrder;
}

/*
  A milk plan that is still running: the order that started it, plus every extension added to it.
  It starts the day after it was paid and runs for all its days (the extensions' days added on).
*/
export type RunningPlan = {
  orderId: string; // the order that started the plan (extensions point to it)
  planName: string;
  months: number; // the plan's own length ("Extend Plan" adds the same again)
  days: number;
  bottlesPerDay: number;
  pricePerLitre: number;
  bottleLabel: string; // "1 L" or "500 ml"
  unitName: string; // what the price is per: "litre" or "500 ml"
  deliverTo: string;
  product: CartItem; // the milk as bought (price = the plan's price per litre, originalPrice = one-time price)
  endsOn: Date; // the last delivery day
  deliveredDays: string[]; // days the agent marked delivered ("2026-11-06")
};

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

// Plans whose last delivery day is today or later; the first one bought comes first
export function findRunningPlans(orderList: Order[], today = new Date()) {
  const plansByOrderId = new Map<string, RunningPlan>();
  // Oldest first, so an extension always comes after the plan it extends
  for (const order of [...orderList].reverse()) {
    const subscription = order.subscription;
    if (!subscription || order.status === "cancelled") continue;
    const extendedPlan = subscription.extendsOrderId ? plansByOrderId.get(subscription.extendsOrderId) : undefined;
    if (extendedPlan) {
      extendedPlan.endsOn = new Date(extendedPlan.endsOn.getTime() + subscription.days * DAY_IN_MILLISECONDS);
      continue;
    }
    const firstDay = new Date(order.placedAt);
    firstDay.setHours(0, 0, 0, 0);
    firstDay.setDate(firstDay.getDate() + 1);
    plansByOrderId.set(order.orderId, {
      orderId: order.orderId,
      planName: subscription.planName,
      months: subscription.months,
      days: subscription.days,
      bottlesPerDay: subscription.bottlesPerDay,
      pricePerLitre: subscription.pricePerLitre,
      bottleLabel: subscription.bottleLabel ?? "1 L",
      unitName: subscription.unitName ?? "litre",
      deliverTo: order.deliverTo ?? "",
      product: order.items[0],
      endsOn: new Date(firstDay.getTime() + (subscription.days - 1 + (subscription.pausedDays ?? 0)) * DAY_IN_MILLISECONDS),
      deliveredDays: subscription.deliveredDays ?? [],
    });
  }
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);
  return [...plansByOrderId.values()].filter((plan) => plan.endsOn >= startOfToday);
}

// "21 Jan 2027"
export function formatPlanDate(date: Date) {
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/*
  Logout: nothing to clear any more. Orders belong to the customer who placed them (their login number),
  so the next visitor sees none of them, and the customer finds them again after logging back in.
  (Kept so the account dashboard's Logout keeps working unchanged.)
*/
export function forgetAllOrders() {}
