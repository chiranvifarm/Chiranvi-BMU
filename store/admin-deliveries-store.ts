import { useState } from "react";
import { STARTING_ROUTES, agentPhoneOf, type DeliveryRoute } from "./admin-routes-store";
import { createPanelRecordStore } from "./panel-records";

/*
  Deliveries seen in the Chiranvi Panel (Deliveries page, and the red count of missed deliveries on its
  sidebar badge) and in the Delivery Panel (each agent's own stops). Kept in the database (panel_records,
  "deliveries"; supabase/migrations/0019_… and 0020_…):
  - Today's deliveries can be changed in the panel by the staff member's role (marked delivered / missed,
    reassigned, added). Each carries its agent's number, so an agent sees only their own stops and may only
    mark them along (Out for delivery, Delivered, Missed).
    The first time each day, 812 sample deliveries are copied in to match the design: 6 routes, 768 delivered,
    41 still to go (12 out for delivery) and 3 missed on Route 2 (the earlier days' samples are removed then).
  - Earlier days (Custom range) are made up from the date and are read-only: almost all delivered.
  Routes and agents themselves are in store/admin-routes-store.ts.
*/

export type DeliveryStatus = "Delivered" | "Out for delivery" | "Pending" | "Missed";
export type DeliverySlot = "5–6 AM" | "6–7 AM" | "7–8 AM";

export type Delivery = {
  id: string;
  date: string; // YYYY-MM-DD
  customerName: string;
  address: string; // "#12, Basavanagudi"
  phone: string; // 10 digits
  routeId: string;
  agent: string;
  slot: DeliverySlot;
  status: DeliveryStatus;
  deliveredAt?: string; // ISO date and time
};

export const DELIVERY_SLOTS: DeliverySlot[] = ["5–6 AM", "6–7 AM", "7–8 AM"];

const STORAGE_KEY = "chiranvi-admin-deliveries";

export function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// The 14 deliveries at the top of the design
const designRows: [string, string, string, DeliverySlot, DeliveryStatus][] = [
  ["Anitha R", "#12, Basavanagudi", "R1", "5–6 AM", "Delivered"],
  ["Suresh Gowda", "#48, Kengeri", "R2", "6–7 AM", "Delivered"],
  ["Meena Iyer", "#221, Uttarahalli", "R3", "6–7 AM", "Delivered"],
  ["Karthik N", "#7, Vijayanagar", "R4", "7–8 AM", "Delivered"],
  ["Divya Rao", "#56, Banashankari", "R5", "5–6 AM", "Delivered"],
  ["Harish Patil", "#12, JP Nagar", "R6", "6–7 AM", "Delivered"],
  ["Lakshmi Devi", "#48, RR Nagar", "R1", "6–7 AM", "Delivered"],
  ["Arjun Shetty", "#221, Jayanagar", "R2", "7–8 AM", "Delivered"],
  ["Kavya M", "#7, Basavanagudi", "R3", "5–6 AM", "Delivered"],
  ["Naveen Reddy", "#56, Kengeri", "R4", "6–7 AM", "Out for delivery"],
  ["Sneha Kulkarni", "#12, Uttarahalli", "R5", "6–7 AM", "Out for delivery"],
  ["Mahesh B", "#48, Vijayanagar", "R6", "7–8 AM", "Out for delivery"],
  ["Deepa S", "#221, Banashankari", "R5", "6–7 AM", "Pending"],
  ["Rahul Jain", "#7, JP Nagar", "R2", "6–7 AM", "Missed"],
];

// How today ends up per route: [delivered, out for delivery, pending, missed]
const todayCounts: Record<string, [number, number, number, number]> = {
  R1: [146, 0, 0, 0],
  R2: [138, 0, 0, 3],
  R3: [120, 3, 5, 0],
  R4: [131, 3, 8, 0],
  R5: [118, 3, 9, 0],
  R6: [115, 3, 7, 0],
};

const firstNames = [
  "Anitha", "Suresh", "Meena", "Karthik", "Divya", "Harish", "Lakshmi", "Arjun", "Kavya", "Naveen", "Sneha",
  "Mahesh", "Deepa", "Rahul", "Pooja", "Vinod", "Shalini", "Ravi", "Asha", "Girish", "Nandini", "Prasad",
  "Rekha", "Sanjay", "Usha", "Kiran", "Bhavya", "Manoj", "Geetha", "Sunil",
];
const lastNames = ["R", "Gowda", "Iyer", "N", "Rao", "Patil", "Devi", "Shetty", "M", "Reddy", "Kulkarni", "B", "S", "Jain", "Hegde", "K"];

// minutes after the slot starts (60 or more: late, after the slot)
function slotTime(date: string, slot: DeliverySlot, minutes: number) {
  const startHour = 5 + DELIVERY_SLOTS.indexOf(slot);
  const time = new Date(`${date}T00:00:00`);
  time.setHours(startHour, minutes, 0, 0);
  return time.toISOString();
}

function makeRow(date: string, index: number, routeId: string, status: DeliveryStatus, design?: (typeof designRows)[number]): Delivery {
  const route = STARTING_ROUTES.find((existing) => existing.id === routeId) as DeliveryRoute;
  const slot = design ? design[3] : DELIVERY_SLOTS[(index * 7) % 3];
  return {
    id: `D-${date.replace(/-/g, "")}-${String(index + 1).padStart(4, "0")}`,
    date,
    customerName: design ? design[0] : `${firstNames[(index * 7) % firstNames.length]} ${lastNames[(index * 5) % lastNames.length]}`,
    address: design ? design[1] : `#${(index * 37) % 400 + 1}, ${route.area}`,
    phone: `${9 - (index % 3)}${String(800000000 + ((index * 7919) % 199999999)).padStart(9, "0")}`,
    routeId,
    agent: route.agent,
    slot,
    status,
    // A few deliveries (1 in 36, in the 7–8 AM slot) arrive after 8 AM: about 97% on time overall
    deliveredAt:
      status === "Delivered"
        ? slotTime(date, slot, slot === "7–8 AM" && index % 36 === 5 ? 62 + (index % 20) : 5 + ((index * 13) % 50))
        : undefined,
  };
}

// Today: the design's 14 first, then the rest, routes taking turns
function makeToday(date: string): Delivery[] {
  const left: Record<string, DeliveryStatus[]> = {};
  for (const [routeId, [delivered, out, pending, missed]] of Object.entries(todayCounts)) {
    left[routeId] = [
      ...Array<DeliveryStatus>(delivered).fill("Delivered"),
      ...Array<DeliveryStatus>(out).fill("Out for delivery"),
      ...Array<DeliveryStatus>(pending).fill("Pending"),
      ...Array<DeliveryStatus>(missed).fill("Missed"),
    ];
  }
  const rows: Delivery[] = designRows.map((design, index) => {
    const statuses = left[design[2]];
    statuses.splice(statuses.lastIndexOf(design[4]), 1);
    return makeRow(date, index, design[2], design[4], design);
  });
  for (let turn = 0; rows.length < 812; turn++) {
    const routeId = STARTING_ROUTES[turn % STARTING_ROUTES.length].id;
    const status = left[routeId].shift();
    if (status) rows.push(makeRow(date, rows.length, routeId, status));
  }
  return rows;
}

// An earlier day: the same routes, all delivered except a few missed
function makePastDay(date: string): Delivery[] {
  const seed = Number(date.replace(/-/g, "")) % 7;
  const rows: Delivery[] = [];
  for (let index = 0; index < 812; index++) {
    const routeId = STARTING_ROUTES[index % STARTING_ROUTES.length].id;
    rows.push(makeRow(date, index, routeId, index % 271 === seed ? "Missed" : "Delivered"));
  }
  return rows;
}

const store = createPanelRecordStore<Delivery>({
  module: "deliveries",
  // Only today's (earlier days are made up from the date)
  filters: () => [["data->>date", toDateKey(new Date())]],
  seed: {
    seedKey: () => `deliveries:${toDateKey(new Date())}`,
    makeSamples: () => makeToday(toDateKey(new Date())),
    oldStorageKey: STORAGE_KEY,
    // The browser's list from before the database, if it is today's
    fromOldCopy: (saved) => {
      const old = saved as { date?: string; deliveries?: Delivery[] };
      return old.date === toDateKey(new Date()) && Array.isArray(old.deliveries) ? old.deliveries : null;
    },
    ownerMobileOf: (delivery) => agentPhoneOf(delivery.agent),
  },
});

// When this browser last changed today's list (the "Updated 2 minutes ago" line)
let lastChangedAt = "";

function changed() {
  lastChangedAt = new Date().toISOString();
}

export function setDeliveryStatus(id: string, status: DeliveryStatus) {
  changed();
  void store.change(id, (delivery) => ({ ...delivery, status, deliveredAt: status === "Delivered" ? new Date().toISOString() : undefined }));
}

// Missed deliveries given to another agent: out for delivery again (with that agent's number)
export function reassignMissed(agent: string) {
  const missed = store.getRecords().filter((delivery) => delivery.status === "Missed");
  changed();
  for (const delivery of missed) {
    void store.change(delivery.id, (existing) => ({ ...existing, agent, status: "Out for delivery" }), agentPhoneOf(agent) ?? null);
  }
  return missed.length;
}

// A route given to another agent: the stops not yet delivered go with it
export function moveRouteToAgent(routeId: string, agent: string) {
  changed();
  for (const delivery of store.getRecords()) {
    if (delivery.routeId !== routeId || (delivery.status !== "Pending" && delivery.status !== "Out for delivery")) continue;
    void store.change(delivery.id, (existing) => ({ ...existing, agent }), agentPhoneOf(agent) ?? null);
  }
}

export function addDelivery(delivery: Pick<Delivery, "customerName" | "address" | "phone" | "routeId" | "slot" | "agent">) {
  const date = toDateKey(new Date());
  const highest = Math.max(0, ...store.getRecords().map((existing) => Number(existing.id.slice(-4)) || 0));
  const newDelivery: Delivery = {
    ...delivery,
    id: `D-${date.replace(/-/g, "")}-${String(highest + 1).padStart(4, "0")}`,
    date,
    status: "Pending",
  };
  changed();
  void store.add(newDelivery, agentPhoneOf(delivery.agent));
  return newDelivery;
}

export function useTodayDeliveries() {
  return store.useRecords();
}

// When today's list last changed (the "Updated 2 minutes ago" line): this browser's last change, or when the page opened
export function useDeliveriesUpdatedAt() {
  store.useRecords(); // asked again whenever the list changes
  const [openedAt] = useState(() => new Date(Date.now() - 2 * 60000).toISOString());
  return lastChangedAt > openedAt ? lastChangedAt : openedAt;
}

// Deliveries for the chosen dates: today's live list, earlier days made up, nothing for days ahead
export function getDeliveriesForRange(from: Date, to: Date, todaysDeliveries: Delivery[]) {
  const todayKey = toDateKey(new Date());
  const rows: Delivery[] = [];
  const day = new Date(to);
  day.setHours(12, 0, 0, 0);
  const first = new Date(from);
  first.setHours(0, 0, 0, 0);
  // Newest day first
  while (day >= first) {
    const key = toDateKey(day);
    if (key === todayKey) rows.push(...todaysDeliveries);
    else if (key < todayKey) rows.push(...makePastDay(key));
    day.setDate(day.getDate() - 1);
  }
  return rows;
}
