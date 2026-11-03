import { useMemo } from "react";
import type { CustomerProfileDetails } from "./customer-profiles-store";
import { withCurrentMilkPlanName } from "./admin-subscriptions-store";
import { markPanelPageSeen, usePanelSeenAt } from "./account-state";
import { createPanelRecordStore, forgetBrowserCopy } from "./panel-records";

/*
  Customers seen in the Chiranvi Panel (Customers page). Kept in the database (panel_records, "customers";
  supabase/migrations/0018_…), seen by the staff member's role. (No wallet: Chiranvi does not use one.)
  - Customers who sign up on the website join the list by themselves when they save their Profile (the
    database adds them, with all its details, and updates them when they save again); every paid order counts
    on their record (orders, last order, lifetime value, their plan). Nothing is written from a customer's browser.
  - The sidebar badge counts the ones who joined since this staff member last opened the Customers page.
  The first time the panel opens the page, 1,384 sample customers are copied in.
*/

export type CustomerStatus = "New" | "Active" | "Paused" | "Inactive";

export type AdminCustomer = {
  id: string;
  lastOrderAt?: string; // ISO: the last paid website order (lastOrderDaysAgo is worked out from it)
  name: string;
  area: string;
  pincode?: string; // added in the panel (website sign-ups: in their profile)
  phone: string; // 98450 10 300
  plan: string; // Jersey Milk 1 L, or "One-time orders"
  lifetimeValue: number;
  orderCount: number;
  lastOrderDaysAgo: number;
  isPaused: boolean;
  joinedDaysAgo: number;
  // Signed up on the website: the details from their Profile page, and when they joined
  profile?: CustomerProfileDetails;
  registeredAt?: string; // ISO
};

// No order for more than 30 days: inactive
export const INACTIVE_AFTER_DAYS = 30;

export function getCustomerStatus(customer: AdminCustomer): CustomerStatus {
  if (customer.orderCount === 0) return "New";
  if (customer.lastOrderDaysAgo > INACTIVE_AFTER_DAYS) return "Inactive";
  return customer.isPaused ? "Paused" : "Active";
}

// What the customer buys: milk subscriptions, one-time orders, or nothing yet
export type CustomerPlanKind = "Subscription" | "One-time" | "No orders yet";
export const NO_ORDERS_PLAN = "No orders yet";

export function getCustomerPlanKind(customer: AdminCustomer): CustomerPlanKind {
  if (customer.orderCount === 0 || customer.plan === NO_ORDERS_PLAN) return "No orders yet";
  return customer.plan === "One-time orders" ? "One-time" : "Subscription";
}

/*
  A website customer's Customer ID, worked out from their login number: the same in every browser and
  never shared by two customers (numbering one after another clashed when two browsers each added one).
  "7766554433" -> "CUS-3KJ2Q9T" (the number written in base 36).
*/
export function customerIdForMobile(mobileNumber: string) {
  const digits = mobileNumber.replace(/\D/g, "").slice(-10);
  return digits ? `CUS-${Number(digits).toString(36).toUpperCase()}` : "";
}

// When the Customers page was last opened, as this browser kept it before the database
const OLD_SEEN_STORAGE_KEY = "chiranvi-admin-customers-seen-at";

const sampleNames: [string, string][] = [
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
];
const samplePlans = ["Jersey Milk 1 L", "Jersey Milk 500 ml", "A2 (Gir Cow) Milk 1 L", "Jersey Milk 2 L", "Skimmed Milk 1 L", "A2 (Gir Cow) Milk 500 ml", "One-time orders"];
const sampleValues = [18400, 9260, 32100, 4100, 12750, 7600, 2300];
const sampleLastOrder = [0, 0, 1, 5, 0, 0, 1, 5, 0, 0, 1, 0, 0, 0, 2, 40, 0, 3];

function makeSampleCustomers(): AdminCustomer[] {
  const customers: AdminCustomer[] = [];
  for (let index = 0; index < 1384; index++) {
    const [name, area] = sampleNames[index % sampleNames.length];
    customers.push({
      id: `CUS-${5000 + index}`,
      name,
      area,
      phone: `98450 ${String(10 + ((index * 7) % 90)).padStart(2, "0")} ${String(300 + ((index * 41) % 700)).padStart(3, "0")}`,
      plan: samplePlans[index % samplePlans.length],
      lifetimeValue: sampleValues[index % sampleValues.length],
      orderCount: 6 + ((index * 13) % 180),
      lastOrderDaysAgo: sampleLastOrder[index % sampleLastOrder.length],
      isPaused: index % 29 === 5,
      joinedDaysAgo: index < 64 ? index % 28 : 30 + ((index * 3) % 600),
    });
  }
  return customers;
}

const DAY = 86400000;

// "Days ago" from the dates the database keeps (website customers); samples keep their numbers
function withDaysAgo(customer: AdminCustomer): AdminCustomer {
  const now = Date.now();
  return {
    ...customer,
    plan: withCurrentMilkPlanName(customer.plan),
    lastOrderDaysAgo: customer.lastOrderAt ? Math.max(0, Math.floor((now - new Date(customer.lastOrderAt).getTime()) / DAY)) : customer.lastOrderDaysAgo,
    joinedDaysAgo: customer.registeredAt ? Math.max(0, Math.floor((now - new Date(customer.registeredAt).getTime()) / DAY)) : customer.joinedDaysAgo,
  };
}

const store = createPanelRecordStore<AdminCustomer>({
  module: "customers",
  fromData: withDaysAgo,
  seed: { seedKey: "customers", makeSamples: makeSampleCustomers, oldStorageKey: "chiranvi-admin-customers" },
});

export function addCustomer(customer: Pick<AdminCustomer, "name" | "area" | "pincode" | "phone" | "plan">) {
  const highest = Math.max(0, ...store.getRecords().map((existing) => Number(existing.id.replace(/D/g, "")) || 0));
  const newCustomer: AdminCustomer = {
    ...customer,
    id: `CUS-${highest + 1}`,
    lifetimeValue: 0,
    orderCount: 0,
    lastOrderDaysAgo: 0,
    isPaused: false,
    joinedDaysAgo: 0,
  };
  void store.add(newCustomer);
  return newCustomer;
}

export function setCustomerPaused(id: string, isPaused: boolean) {
  void store.change(id, (customer) => ({ ...customer, isPaused }));
}

export function removeCustomer(id: string) {
  void store.remove(id);
}

// The Customers page was opened: the badge's new customers are now seen (saved with this staff member's login)
export function markCustomersSeen() {
  forgetBrowserCopy(OLD_SEEN_STORAGE_KEY);
  markPanelPageSeen("customers");
}

export function useAdminCustomers() {
  return store.useRecords();
}

// Customers who signed up on the website since the Customers page was last opened (sidebar badge and bell)
export function useNewCustomers() {
  const allCustomers = useAdminCustomers();
  const lastSeen = usePanelSeenAt("customers");
  return useMemo(
    () => allCustomers.filter((customer) => customer.registeredAt && customer.registeredAt > lastSeen),
    [allCustomers, lastSeen],
  );
}

export function useNewCustomerCount() {
  return useNewCustomers().length;
}
