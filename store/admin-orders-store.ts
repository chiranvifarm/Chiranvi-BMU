import { useMemo, useState, useSyncExternalStore } from "react";
import {
  followSavedOrders,
  getSavedOrders,
  setSavedOrderStatus,
  type Order,
  type OrderStatus,
} from "./orders-store";
import type { MapPin } from "./address-store";
import { customerIdForMobile } from "./admin-customers-store";
import { assignOrderDelivery, removeOrderDelivery } from "./admin-deliveries-store";
import { markPanelPageSeen, usePanelSeenAt } from "./account-state";
import { createPanelRecordStore } from "./panel-records";

/*
  Orders seen in the Chiranvi Panel (Orders page, and "Recent orders" on the dashboard).
  - Orders customers pay for on the website come from the database (the "orders" and "order_items" tables,
    read by store/orders-store.ts), with their Customer ID, items, promised delivery and payment method.
    Moving one along (Packed, Out for delivery, Delivered) changes it in the database, so the customer's
    Orders page tracks it.
  - The panel's own orders, also in the database (panel_records, "orders"; supabase/migrations/0019_…), by the
    staff member's role: the 412 sample orders from the last seven days (copied in the first time, newest
    first, like the design) and orders added in the panel itself.
  Both are shown as one list, newest first.
*/

// The order's steps: Placed -> Packed -> Out for delivery -> Delivered (or Cancelled)
export type AdminOrderStatus = "Placed" | "Packed" | "Out for delivery" | "Delivered" | "Cancelled";
export const ADMIN_ORDER_STATUSES: AdminOrderStatus[] = ["Placed", "Packed", "Out for delivery", "Delivered", "Cancelled"];
// The delivery steps (the status drop-down and the details card's steps)
export const ADMIN_DELIVERY_STEPS: AdminOrderStatus[] = ["Placed", "Packed", "Out for delivery", "Delivered"];
// Still to be delivered
export const OPEN_ORDER_STATUSES: AdminOrderStatus[] = ["Placed", "Packed", "Out for delivery"];

// How customers pay on the website (no cash on delivery); "Cash" is only for orders taken in the panel
export type OrderPaymentMethod = "UPI" | "Net banking" | "Card";

/*
  One product in an order. productId: the pack's Product ID (the product's page address + the pack, e.g.
  "a2-desi-ghee-1-litre"), the same ID the products and the cart use, for the database's order_items.
*/
export type AdminOrderItem = { productId?: string; name: string; packSize: string; quantity: number; price: number; imageSource?: string };

export type AdminOrder = {
  orderNumber: string; // #CF-2041
  placedAt: string; // ISO date and time
  customerName: string;
  area: string;
  items: string; // "Milk 1 L × 2, Paneer 200 g"
  amount: number;
  payment: OrderPaymentMethod | "Cash";
  slot: string; // 6–7 AM
  status: AdminOrderStatus;
  // Orders paid for on the website
  websiteOrderId?: string; // CF-48213, the customer's own order (its status follows this one)
  customerId?: string; // CUS-6384
  customerMobile?: string; // 10 digits, their login number
  itemList?: AdminOrderItem[];
  deliverTo?: string; // "Name · address line"
  deliveryMobile?: string; // 10 digits, the delivery address's number (when it is not the login number)
  promisedAt?: string; // ISO: when Chiranvi promised to deliver it (next day by 7 AM)
  statusChangedAt?: Partial<Record<AdminOrderStatus, string>>; // ISO time each step was reached
  deliveryPin?: MapPin; // the delivery address's map pin (website orders whose address has one)
  bottlesPerDay?: number; // a milk plan's order: what is handed over each day (its items count the whole plan)
};

const TO_CUSTOMER_STATUS: Record<AdminOrderStatus, OrderStatus> = {
  Placed: "placed",
  Packed: "packed",
  "Out for delivery": "out-for-delivery",
  Delivered: "delivered",
  Cancelled: "cancelled",
};

const TO_ADMIN_STATUS: Record<OrderStatus, AdminOrderStatus> = {
  placed: "Placed",
  packed: "Packed",
  "out-for-delivery": "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

// "Milk 1 L × 2, Paneer 200 g"
function describeItems(itemList: AdminOrderItem[]) {
  return itemList.map((item) => `${item.name} ${item.packSize}${item.quantity > 1 ? ` × ${item.quantity}` : ""}`).join(", ");
}

// A website order saved in the database, as the panel shows it
function toAdminOrder(order: Order): AdminOrder {
  const placedAt = new Date(order.placedAt).toISOString();
  const itemList: AdminOrderItem[] = order.items.map((item) => ({
    productId: item.productId,
    name: item.name,
    packSize: item.packSize,
    quantity: item.quantity,
    price: item.price,
    imageSource: item.imageSource,
  }));
  const statusChangedAt: Partial<Record<AdminOrderStatus, string>> = {};
  for (const [status, time] of Object.entries(order.statusChangedAt ?? {}) as [OrderStatus, number][]) {
    statusChangedAt[TO_ADMIN_STATUS[status]] = new Date(time).toISOString();
  }
  const customerMobile = order.customerMobile ?? "";
  return {
    orderNumber: `#${order.orderId}`,
    placedAt,
    customerName: order.customerName ?? (order.deliverTo ?? "").split(" · ")[0],
    area: order.area ?? "",
    items: describeItems(itemList),
    amount: order.total,
    payment: order.paymentMethod ?? "UPI",
    slot: "By 7 AM",
    status: TO_ADMIN_STATUS[order.status],
    websiteOrderId: order.orderId,
    customerId: customerMobile ? customerIdForMobile(customerMobile) : order.customerId,
    customerMobile,
    itemList,
    deliverTo: order.deliverTo,
    // Only kept when it differs from the login number (an order for someone else)
    deliveryMobile: order.deliveryMobile && order.deliveryMobile !== customerMobile ? order.deliveryMobile : undefined,
    promisedAt: order.promisedAt ? new Date(order.promisedAt).toISOString() : undefined,
    statusChangedAt,
    deliveryPin: order.deliveryPin,
    bottlesPerDay: order.subscription?.bottlesPerDay,
  };
}

const STORAGE_KEY = "chiranvi-admin-orders";
// When the Orders page was last opened (website orders placed after it are "new": sidebar badge and bell)
const OLD_SEEN_STORAGE_KEY = "chiranvi-admin-orders-seen-at";

const sampleCustomers: [string, string][] = [
  ["Priya Sharma", "RR Nagar"],
  ["Ravi Kumar", "Jayanagar"],
  ["Anitha R", "Basavanagudi"],
  ["Suresh Gowda", "Kengeri"],
  ["Meena Iyer", "Uttarahalli"],
  ["Karthik N", "Vijayanagar"],
  ["Divya Rao", "Banashankari"],
  ["Harish Patil", "JP Nagar"],
  ["Lakshmi Devi", "RR Nagar"],
  ["Arjun Shetty", "Jayanagar"],
  ["Kavya M", "Basavanagudi"],
  ["Naveen Reddy", "Kengeri"],
  ["Sneha Kulkarni", "Uttarahalli"],
  ["Mahesh B", "Vijayanagar"],
  ["Deepa S", "Banashankari"],
  ["Rahul Jain", "JP Nagar"],
];

const sampleItems: [string, number][] = [
  ["Milk 1 L × 2", 136],
  ["Milk 1 L", 113],
  ["Ghee 500 ml", 420],
  ["Paneer 200 g", 95],
  ["Milk 500 ml × 2", 72],
  ["Butter 100 g", 143],
  ["A2 Milk 1 L", 96],
  ["Buttermilk × 3", 75],
  ["Milk 1 L, Paneer 200 g", 163],
];

const samplePayments: AdminOrder["payment"][] = ["UPI", "UPI", "Cash", "Card", "UPI", "Cash"];
const sampleSlots = ["6–7 AM", "7–8 AM", "5–6 AM"];

function makeSampleOrders(): AdminOrder[] {
  const now = new Date();
  const orders: AdminOrder[] = [];
  for (let index = 0; index < 412; index++) {
    // About 59 orders a day, newest first, between 6:00 and 8:30 in the morning
    const daysAgo = Math.floor(index / 59);
    const placedAt = new Date(now);
    placedAt.setDate(now.getDate() - daysAgo);
    placedAt.setHours(8, 30 - ((index % 59) * 150) / 59, 0, 0);
    const [customerName, area] = sampleCustomers[index % sampleCustomers.length];
    const [items, amount] = sampleItems[(index * 7) % sampleItems.length];
    let status: AdminOrderStatus = "Delivered";
    if (index % 59 === 33) status = "Cancelled";
    else if (index < 37) status = index % 3 === 0 ? "Out for delivery" : "Placed";
    orders.push({
      orderNumber: `#CF-${2041 - index}`,
      placedAt: placedAt.toISOString(),
      customerName,
      area,
      items,
      amount,
      payment: samplePayments[index % samplePayments.length],
      slot: sampleSlots[index % sampleSlots.length],
      status,
    });
  }
  return orders;
}

const EMPTY: AdminOrder[] = [];

// A panel order in the database: its id is its order number
type PanelOrderRecord = AdminOrder & { id: string };

// Orders saved before the wallet was removed show UPI instead; a website order's Customer ID comes from the
// customer's mobile number (older ones were numbered); the old step "Pending" (and its time) is "Placed"
function asShown(order: PanelOrderRecord): PanelOrderRecord {
  const oldTimes = order.statusChangedAt as Record<string, string> | undefined;
  const { Pending: oldPlacedAt, ...times } = oldTimes ?? {};
  return {
    ...order,
    status: (order.status as string) === "Pending" ? "Placed" : order.status,
    statusChangedAt: oldTimes ? { ...(oldPlacedAt ? { Placed: oldPlacedAt } : {}), ...times } : undefined,
    payment: ((order.payment as string) === "Wallet" ? "UPI" : order.payment) as AdminOrder["payment"],
    customerId: order.customerMobile ? customerIdForMobile(order.customerMobile) : order.customerId,
  };
}

const store = createPanelRecordStore<PanelOrderRecord>({
  module: "orders",
  fromData: asShown,
  seed: {
    seedKey: "orders",
    makeSamples: () => makeSampleOrders().map((order) => ({ ...order, id: order.orderNumber })),
    oldStorageKey: STORAGE_KEY,
    fromOldCopy: (saved) => (Array.isArray(saved) ? (saved as AdminOrder[]).map((order) => ({ ...order, id: order.orderNumber })) : null),
  },
});

// Website orders from the database and the panel's own orders, newest first
function mergeOrders(savedOrders: Order[], panelOrders: AdminOrder[]) {
  const savedNumbers = new Set(savedOrders.map((order) => "#" + order.orderId));
  return [...savedOrders.map(toAdminOrder), ...panelOrders.filter((order) => !savedNumbers.has(order.orderNumber))].sort(
    (first, second) => (first.placedAt < second.placedAt ? 1 : first.placedAt > second.placedAt ? -1 : 0),
  );
}

// Moving an order along; a website order's customer sees the same step on their Orders page
export function changeAdminOrderStatus(orderNumber: string, status: AdminOrderStatus) {
  // A cancelled order isn't delivered: its stop goes from the agent's list
  if (status === "Cancelled") removeOrderDelivery(orderNumber);
  // A website order in the database: changed there (the customer's order is the same row)
  const savedOrder = getSavedOrders().find((order) => `#${order.orderId}` === orderNumber);
  if (savedOrder) {
    void setSavedOrderStatus(savedOrder.orderId, TO_CUSTOMER_STATUS[status]);
    return;
  }
  // The panel's own (sample or panel-made) orders: no customer on the website to tell
  const now = new Date().toISOString();
  void store.change(orderNumber, (order) => ({ ...order, status, statusChangedAt: { ...order.statusChangedAt, [status]: now } }));
}

/*
  Gives the order to a delivery agent: today's stop for it (on routeId) goes to that agent. A Placed order
  becomes Packed (a website order's customer sees Packed too).
*/
export function assignAdminOrderAgent(order: AdminOrder, agent: string, routeId: string) {
  // "Name · #12, 4th Cross, Kengeri": the address part, and who receives it (someone else, if the customer said so)
  const address = order.deliverTo?.split(" · ").slice(1).join(" · ").trim() || order.area;
  const receiverName = order.deliverTo?.split(" · ")[0].trim();
  assignOrderDelivery({
    orderNumber: order.orderNumber,
    customerName: receiverName || order.customerName,
    address,
    phone: order.deliveryMobile || order.customerMobile || "",
    area: order.area,
    routeId,
    agent,
    isSubscription: order.bottlesPerDay !== undefined,
    // What to hand over: the order's items (an order made in the panel only has its items as one line); a milk
    // plan's stop is one day's bottles, not the whole plan
    items: order.itemList?.length
      ? order.itemList.map((item) => ({ name: item.name, packSize: item.packSize, quantity: order.bottlesPerDay ?? item.quantity, price: item.price }))
      : [{ name: order.items, packSize: "", quantity: 1, price: order.amount }],
    // Website orders are paid online; only a cash order taken in the panel is collected at the door
    cashToCollect: order.payment === "Cash" ? order.amount : 0,
    // The exact spot for the agent's Google Maps (none: the address text is used)
    pin: order.deliveryPin,
  });
  if (order.status === "Placed") changeAdminOrderStatus(order.orderNumber, "Packed");
}

// A new order goes to the top, numbered after the newest one (website orders keep their own IDs)
export function addAdminOrder(order: Omit<AdminOrder, "orderNumber" | "placedAt" | "status">) {
  const highestNumber = Math.max(
    0,
    ...store
      .getRecords()
      .filter((existing) => !existing.websiteOrderId)
      .map((existing) => Number(existing.orderNumber.replace(/[^0-9]/g, "")) || 0),
  );
  const orderNumber = "#CF-" + (highestNumber + 1);
  const newOrder: PanelOrderRecord = { ...order, id: orderNumber, orderNumber, placedAt: new Date().toISOString(), status: "Placed" };
  void store.add(newOrder);
  return newOrder as AdminOrder;
}

// The Orders page was opened: the new orders are now seen (the badge and the bell's list clear). Saved with
// this staff member's login (store/account-state.ts); the browser's old marker is deleted.
export function markOrdersSeen() {
  try {
    window.localStorage.removeItem(OLD_SEEN_STORAGE_KEY);
  } catch {
    // Storage blocked: nothing kept to delete.
  }
  markPanelPageSeen("orders");
  markPanelPageSeen("order-steps");
}

// Orders that moved to a new step since the Orders page was last opened, for the bell (the last 24 hours at
// most, so the first look isn't a long list). Placed isn't one: new orders have their own line in the bell.
export function useOrderStepNews() {
  const allOrders = useAdminOrders();
  const lastSeen = usePanelSeenAt("order-steps");
  const [dayAgo] = useState(() => new Date(Date.now() - 86400000).toISOString());
  return useMemo(() => {
    const since = lastSeen > dayAgo ? lastSeen : dayAgo;
    return allOrders.flatMap((order) =>
      Object.entries(order.statusChangedAt ?? {})
        .filter(([status, at]) => status !== "Placed" && at > since)
        .map(([status, at]) => ({ order, status, at })),
    );
  }, [allOrders, lastSeen, dayAgo]);
}

export function useAdminOrders() {
  const panelOrders = store.useRecords();
  const savedOrders = useSyncExternalStore(followSavedOrders, getSavedOrders, () => EMPTY_SAVED);
  return useMemo(() => (panelOrders.length === 0 && savedOrders.length === 0 ? EMPTY : mergeOrders(savedOrders, panelOrders)), [savedOrders, panelOrders]);
}

const EMPTY_SAVED: Order[] = [];

// The same list without the sample orders (the dashboard)
export function useRealAdminOrders() {
  const panelOrders = store.useRealRecords();
  const savedOrders = useSyncExternalStore(followSavedOrders, getSavedOrders, () => EMPTY_SAVED);
  return useMemo(() => mergeOrders(savedOrders, panelOrders), [savedOrders, panelOrders]);
}

export function useAreAdminOrdersLoaded() {
  return store.useIsLoaded();
}

// Website orders placed since the Orders page was last opened, newest first (sidebar badge and bell);
// orders added in the panel itself are not counted
export function useNewOrders() {
  const allOrders = useAdminOrders();
  const lastSeen = usePanelSeenAt("orders");
  return useMemo(
    () => allOrders.filter((order) => order.websiteOrderId && order.placedAt > lastSeen),
    [allOrders, lastSeen],
  );
}
