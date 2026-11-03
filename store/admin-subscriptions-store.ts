import { useMemo } from "react";
import { createPanelRecordStore } from "./panel-records";

/*
  Milk subscriptions seen in the Chiranvi Panel (Subscriptions page). Only milk can be subscribed (curd,
  paneer, ghee and butter are one-time orders): A2 (Gir Cow), Jersey and Skimmed milk, the milks the website
  sells. Kept in the database (panel_records, "subscriptions"; supabase/migrations/0018_…), seen by the staff
  member's role. Subscriptions are paid by plan length.
  - A plan bought and paid on the website joins the list by itself (the database adds it, with its website
    order number), and a pause the panel approves (Pause requests) shows it as Paused on those days.
  - Pausing, resuming and cancelling in the panel are saved; a cancelled plan is kept, marked cancelled (it
    counts in "cancelled this week" and no longer shows on the list).
  The first time the panel opens the page, 1,177 sample subscriptions are copied in.
*/

export type MilkType = "A2" | "Jersey" | "Skimmed";
export const MILK_TYPES: MilkType[] = ["A2", "Jersey", "Skimmed"];
// How each milk is named on the panel ("A2 Milk 1 L")
export const MILK_TYPE_NAMES: Record<MilkType, string> = { A2: "A2 (Gir Cow)", Jersey: "Jersey", Skimmed: "Skimmed" };
export type MilkFrequency = "Daily" | "Alternate days";
export type SubscriptionStatus = "Active" | "Paused";
export type PlanLength = "3 months" | "6 months" | "1 year";
export const PLAN_LENGTHS: PlanLength[] = ["3 months", "6 months", "1 year"];

export type AdminSubscription = {
  id: string;
  customerName: string;
  area: string;
  milkType: MilkType;
  quantity: string; // "1 L", "500 ml", "2 L"
  litresPerDelivery: number;
  container: string; // "Pouch", "Glass bottle", "Family · 2 × 1 L pouch"
  frequency: MilkFrequency;
  // How long the customer subscribed for
  planLength?: PlanLength;
  since: string; // ISO date
  isPaused: boolean;
  // Bought on the website: its order number and the customer's mobile number
  websiteOrderId?: string;
  customerMobile?: string;
  // A pause approved in the panel (Pause requests): paused from this day until the resume day
  pauseFrom?: string; // ISO date
  resumeOn?: string; // ISO date
  cancelledAt?: string; // ISO: cancelled in the panel (no longer shown)
};

// Plans saved before the length was added get one from their number
export function getPlanLength(subscription: AdminSubscription): PlanLength {
  return subscription.planLength ?? PLAN_LENGTHS[Number(subscription.id.replace(/\D/g, "")) % 3];
}

// Paused by the panel, or inside an approved pause (from its first day until the resume day)
export function getSubscriptionStatus(subscription: AdminSubscription, today = new Date()): SubscriptionStatus {
  if (subscription.isPaused) return "Paused";
  if (subscription.pauseFrom && subscription.resumeOn) {
    const now = today.getTime();
    if (now >= new Date(subscription.pauseFrom).getTime() && now < new Date(subscription.resumeOn).getTime()) return "Paused";
  }
  return "Active";
}

const sampleCustomers: [string, string][] = [
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
  ["Shalini K", "RR Nagar"],
];

const samplePlans: Omit<AdminSubscription, "id" | "customerName" | "area" | "since" | "isPaused">[] = [
  { milkType: "Jersey", quantity: "1 L", litresPerDelivery: 1, container: "Glass bottle", frequency: "Daily" },
  { milkType: "Jersey", quantity: "500 ml", litresPerDelivery: 0.5, container: "Glass bottle", frequency: "Daily" },
  { milkType: "A2", quantity: "1 L", litresPerDelivery: 1, container: "Glass bottle", frequency: "Daily" },
  { milkType: "Jersey", quantity: "2 L", litresPerDelivery: 2, container: "2 × 1 L glass bottle", frequency: "Daily" },
  { milkType: "Skimmed", quantity: "1 L", litresPerDelivery: 1, container: "Glass bottle", frequency: "Daily" },
  { milkType: "Jersey", quantity: "1 L", litresPerDelivery: 1, container: "Glass bottle", frequency: "Alternate days" },
  { milkType: "A2", quantity: "1 L", litresPerDelivery: 1, container: "Glass bottle", frequency: "Daily" },
];

/*
  A plan name saved with an old milk name, as today's milks are named (Customers and Pause requests):
  "Cow Milk 1 L" → "Jersey Milk 1 L", "Buffalo Milk 1 L" → "Skimmed Milk 1 L", "A2 Milk 1 L" → "A2 (Gir Cow) Milk 1 L"
*/
export function withCurrentMilkPlanName(plan: string) {
  return plan.replace(/^Cow Milk/, "Jersey Milk").replace(/^Buffalo Milk/, "Skimmed Milk").replace(/^A2 Milk/, "A2 (Gir Cow) Milk");
}

// Plans saved with the old milk names: Cow is now Jersey, Buffalo is now Skimmed
const OLD_MILK_TYPES: Record<string, MilkType> = { Cow: "Jersey", Buffalo: "Skimmed" };
function withCurrentMilkType(subscription: AdminSubscription): AdminSubscription {
  const renamed = OLD_MILK_TYPES[subscription.milkType as string];
  return renamed ? { ...subscription, milkType: renamed } : subscription;
}

function makeSampleSubscriptions(): AdminSubscription[] {
  const subscriptions: AdminSubscription[] = [];
  const now = new Date();
  for (let index = 0; index < 1177; index++) {
    const [customerName, area] = sampleCustomers[index % sampleCustomers.length];
    const since = new Date(now.getFullYear(), now.getMonth() - (index % 20), 1);
    subscriptions.push({
      id: `SUB-${10000 + index}`,
      customerName,
      area,
      ...samplePlans[index % samplePlans.length],
      planLength: PLAN_LENGTHS[index % 3],
      since: since.toISOString(),
      // 48 paused plans spread through the list
      isPaused: index % 24 === 3 && index < 24 * 48,
    });
  }
  return subscriptions;
}

const store = createPanelRecordStore<AdminSubscription>({
  module: "subscriptions",
  fromData: withCurrentMilkType,
  seed: { seedKey: "subscriptions", makeSamples: makeSampleSubscriptions, oldStorageKey: "chiranvi-admin-subscriptions" },
});

// The browser's old "cancelled this week" counter (deleted with the old list)
const OLD_CANCELLED_KEY = "chiranvi-admin-subscriptions-cancelled";
// The sample week's cancellations (the design shows 3), plus the plans cancelled in the last 7 days
const SAMPLE_CANCELLED_THIS_WEEK = 3;

export function setSubscriptionPaused(id: string, isPaused: boolean) {
  void store.change(id, (subscription) => ({ ...subscription, isPaused }));
}

export function cancelSubscription(id: string) {
  void store.change(id, (subscription) => ({ ...subscription, cancelledAt: new Date().toISOString() }));
}

// A plan bought on the website: its pause dates (the database also sets them when a pause is approved)
export function setWebsitePlanPause(websiteOrderId: string, pause: { pauseFrom: string; resumeOn: string } | null) {
  const subscription = store.getRecords().find((existing) => existing.websiteOrderId === websiteOrderId);
  if (!subscription) return;
  void store.change(subscription.id, (existing) => ({ ...existing, pauseFrom: pause?.pauseFrom, resumeOn: pause?.resumeOn }));
}

// The panel's copy of a plan bought on the website (only staff can read the list)
export function findWebsiteSubscription(websiteOrderId: string) {
  return store.getRecords().find((subscription) => subscription.websiteOrderId === websiteOrderId) ?? null;
}

// A plan added in the panel (website plans join by themselves)
export function addSubscription(subscription: Omit<AdminSubscription, "id" | "since" | "isPaused">) {
  const highest = Math.max(0, ...store.getRecords().map((existing) => Number(existing.id.replace(/\D/g, "")) || 0));
  const newSubscription: AdminSubscription = {
    ...subscription,
    id: `SUB-${highest + 1}`,
    since: new Date().toISOString(),
    isPaused: false,
  };
  void store.add(newSubscription);
  return newSubscription;
}

export function getCancelledThisWeek() {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(OLD_CANCELLED_KEY);
    } catch {
      // Storage blocked: nothing to delete.
    }
  }
  const weekAgo = Date.now() - 7 * 86400000;
  return SAMPLE_CANCELLED_THIS_WEEK + store.getRecords().filter((subscription) => subscription.cancelledAt && new Date(subscription.cancelledAt).getTime() > weekAgo).length;
}

// The plans still running or paused (cancelled ones are left out)
export function useAdminSubscriptions() {
  const all = store.useRecords();
  return useMemo(() => all.filter((subscription) => !subscription.cancelledAt), [all]);
}
