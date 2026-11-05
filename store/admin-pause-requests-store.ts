import { createClient } from "@/lib/supabase/client";
import { useMemo } from "react";
import { createPanelRecordStore } from "./panel-records";
import { withCurrentMilkPlanName } from "./admin-subscriptions-store";

/*
  Pause requests: customers asking to stop milk for a few days. Kept in the database (panel_records,
  "pause-requests"; supabase/migrations/0019_…):
  - the Chiranvi Panel (Pause requests page, and the count on its sidebar badge) sees all of them and
    approves or rejects, by the staff member's role;
  - a customer pauses from My Subscription ("Pause subscription": from, resume on, reason; 1 to 22 days) and it
    is paused at once, with no approval; Unpause takes it back (0046_instant_pause_and_daily_stops.sql). The panel
    only sees them. A pause moves the plan's end date later by the days really paused.
  Skipping a delivery was removed (0041_no_skipping_deliveries.sql): old skip requests stay in the database, and
  are left out here so nothing shows or counts them.
  The first time the panel opens the page, 56 sample requests are copied in (5 waiting for approval).
*/

export type PauseRequestStatus = "Pending" | "Approved" | "Rejected" | "Unpaused";

export type PauseRequest = {
  id: string;
  customerName: string;
  area: string;
  plan: string; // Jersey Milk 1 L
  frequency: "Daily" | "Alternate days";
  litresPerDay: number;
  pauseFrom: string; // ISO date
  resumeOn: string; // ISO date
  reason: string;
  status: PauseRequestStatus;
  decidedBy?: string; // who approved or rejected it
  // Sent from the website: the plan's order number and the customer's mobile number
  websiteOrderId?: string;
  customerMobile?: string;
  requestedAt?: string; // ISO date and time
  unpausedAt?: string; // the customer unpaused it (a running pause then ends early)
  kind?: "skip"; // an old skip request, left out of every list
};

// Reasons a customer can choose on My Subscription
export const PAUSE_REASONS = ["Travelling", "Out of town", "Guests at home", "Health reasons", "Other"];

const sampleCustomers: [string, string, string, PauseRequest["frequency"], number][] = [
  ["Divya Rao", "Banashankari", "Jersey Milk 1 L", "Daily", 1],
  ["Harish Patil", "JP Nagar", "Jersey Milk 500 ml", "Daily", 0.5],
  ["Lakshmi Devi", "RR Nagar", "A2 (Gir Cow) Milk 1 L", "Daily", 1],
  ["Arjun Shetty", "Jayanagar", "Jersey Milk 2 L", "Daily", 2],
  ["Kavya M", "Basavanagudi", "Skimmed Milk 1 L", "Daily", 1],
  ["Naveen Reddy", "Kengeri", "Jersey Milk 1 L", "Alternate days", 0.5],
  ["Sneha Kulkarni", "Uttarahalli", "Jersey Milk 1 L", "Daily", 1],
  ["Mahesh B", "Vijayanagar", "Jersey Milk 500 ml", "Daily", 0.5],
  ["Deepa S", "Banashankari", "A2 (Gir Cow) Milk 1 L", "Daily", 1],
  ["Rahul Jain", "JP Nagar", "Jersey Milk 2 L", "Daily", 2],
  ["Shalini K", "RR Nagar", "Skimmed Milk 1 L", "Daily", 1],
  ["Vinod Kumar", "Jayanagar", "Jersey Milk 1 L", "Alternate days", 0.5],
  ["Asha N", "Basavanagudi", "Jersey Milk 1 L", "Daily", 1],
  ["Manjunath G", "Kengeri", "Jersey Milk 500 ml", "Daily", 0.5],
];

const sampleReasons = ["Travelling", "Out of town", "Guests leaving", "Festival trip", "Health reasons", "Not needed"];
const sampleDays = [3, 5, 2, 7, 4, 10];

function dayFromToday(days: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function makeSampleRequests(): PauseRequest[] {
  const requests: PauseRequest[] = [];
  for (let index = 0; index < 56; index++) {
    const [customerName, area, plan, frequency, litresPerDay] = sampleCustomers[index % sampleCustomers.length];
    const days = sampleDays[index % sampleDays.length];
    // Pending ones start from tomorrow; older approved ones started up to two weeks ago
    const startsIn = index < 5 ? 1 + (index % 4) : 1 - Math.floor(index / 4);
    requests.push({
      id: `PR-${600 - index}`,
      customerName,
      area,
      plan,
      frequency,
      litresPerDay,
      pauseFrom: dayFromToday(startsIn),
      resumeOn: dayFromToday(startsIn + days),
      reason: sampleReasons[index % sampleReasons.length],
      status: index < 5 ? "Pending" : "Approved",
      decidedBy: index < 5 ? undefined : "Karthik N",
    });
  }
  return requests;
}

const store = createPanelRecordStore<PauseRequest>({
  module: "pause-requests",
  // Saved with the old milk names (Cow, Buffalo): shown with today's
  fromData: (request) => ({ ...request, plan: withCurrentMilkPlanName(request.plan) }),
  seed: {
    seedKey: "pause-requests",
    makeSamples: makeSampleRequests,
    oldStorageKey: "chiranvi-admin-pause-requests",
    ownerMobileOf: (request) => request.customerMobile,
  },
});

/*
  The customer pauses a plan (from tomorrow at the earliest, 1 to 22 days, 9 AM to 9 PM in India) or unpauses it:
  no approval, the database saves it at once (0046_instant_pause_and_daily_stops.sql). Answers a problem to show,
  or null.
*/
export async function pauseMyPlan(details: { planOrder: string; pauseFrom: string; resumeOn: string; reason: string; planLabel: string; litresPerDay: number }) {
  const { error } = await createClient().rpc("pause_my_plan", {
    plan_order: details.planOrder,
    pause_from: details.pauseFrom,
    resume_on: details.resumeOn,
    pause_reason: details.reason,
    plan_label: details.planLabel,
    litres_per_day: details.litresPerDay,
  });
  await store.reload();
  return error ? error.message || "Couldn't pause. Please try again." : null;
}

export async function unpauseMyPlan(requestId: string) {
  const { error } = await createClient().rpc("unpause_my_plan", { request_id: requestId });
  await store.reload();
  return error ? error.message || "Couldn't unpause. Please try again." : null;
}

export function usePauseRequests() {
  const requests = store.useRecords();
  return useMemo(() => requests.filter((request) => request.kind !== "skip"), [requests]);
}

// Without the sample requests (the dashboard)
export function useRealPauseRequests() {
  const requests = store.useRealRecords();
  return useMemo(() => requests.filter((request) => request.kind !== "skip"), [requests]);
}

// An approved pause whose resume day has come is "Resumed"
export function getShownStatus(request: PauseRequest, today: Date): PauseRequestStatus | "Resumed" {
  if (request.status === "Approved" && new Date(request.resumeOn) <= today) return "Resumed";
  return request.status;
}
