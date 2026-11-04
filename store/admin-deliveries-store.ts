import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MapPin } from "./address-store";
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
  - An order given to an agent on the Orders page is a delivery too (with its order number). One not finished
    by the end of the day moves on to the next day. Asking another agent to take a stop (a transfer) and
    each change of agent are kept on the delivery itself (its history).
  Routes and agents themselves are in store/admin-routes-store.ts.
*/

export type DeliveryStatus = "Delivered" | "Out for delivery" | "Pending" | "Missed";
export type DeliverySlot = "5–6 AM" | "6–7 AM" | "7–8 AM";

// One agent asking another to take a stop, waiting for an answer
// (fromMobile / toMobile: set when agents ask each other in the Delivery Panel, 0026_agent_stop_exchange.sql)
export type DeliveryTransferRequest = { fromAgent: string; toAgent: string; reason: string; requestedAt: string; fromMobile?: string; toMobile?: string };

export type DeliveryEventKind =
  | "assigned"
  | "reassigned"
  | "transfer-requested"
  | "transfer-accepted"
  | "transfer-declined"
  | "transfer-cancelled";

// A change of agent on a stop (the order's "Agent history")
export type DeliveryEvent = { kind: DeliveryEventKind; at: string; fromAgent?: string; toAgent: string; reason?: string };

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
  orderNumber?: string; // "#CF-60084": the order this stop delivers (given to the agent on the Orders page)
  area?: string; // the order's area ("Kengeri")
  // An order's stop: what to hand over and the cash to collect (only for a cash order), copied from the order
  // (the agent can't read the orders themselves)
  items?: { name: string; packSize: string; quantity: number; price: number }[];
  cashToCollect?: number; // rupees
  // The address's map pin (0027_address_pins.sql): copied from the order, kept up to date by the database when
  // the customer moves it or the agent saves the spot at the door. None: the agent's Maps uses the address text.
  latitude?: number;
  longitude?: number;
  transferRequest?: DeliveryTransferRequest;
  history?: DeliveryEvent[];
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
  // Agents and the panel follow each other's stops within half a minute
  refreshEveryMs: 30_000,
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
  const orderNumber = store.getRecords().find((delivery) => delivery.id === id)?.orderNumber;
  void store
    .change(id, (delivery) => ({ ...delivery, status, deliveredAt: status === "Delivered" ? new Date().toISOString() : undefined }))
    .then(async (isSaved) => {
      // An order's stop: the order follows it (Out for delivery, Delivered) for the customer and the panel,
      // done by the database from the stop it saved (supabase/migrations/0025_order_follows_its_stop.sql)
      if (!isSaved || !orderNumber) return;
      const { error } = await createClient().rpc("order_follows_its_stop", { stop_id: id });
      if (error) console.error("The order did not follow its delivery stop", error);
    });
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

// The stop's area: the order's area, else the last part of the address ("#12, Basavanagudi")
export function areaOfDelivery(delivery: Pick<Delivery, "area" | "address">) {
  return delivery.area?.trim() || delivery.address.split(",").pop()?.trim() || "";
}

// Not finished yet (it can still change agent)
export function isDeliveryOpen(delivery: Delivery) {
  return delivery.status === "Pending" || delivery.status === "Out for delivery";
}

function withEvent(delivery: Delivery, event: Omit<DeliveryEvent, "at">): Delivery {
  return { ...delivery, history: [...(delivery.history ?? []), { ...event, at: new Date().toISOString() }] };
}

/*
  An order given to an agent (Orders page): its stop today changes agent (any waiting transfer is dropped),
  or a new stop is added for it, waiting to go out.
*/
export function assignOrderDelivery(details: {
  orderNumber: string;
  customerName: string;
  address: string;
  phone: string;
  area: string;
  routeId: string;
  agent: string;
  items: NonNullable<Delivery["items"]>;
  cashToCollect: number;
  pin?: MapPin; // the order's map pin
}) {
  const { pin, ...stopDetails } = details;
  // The order's pin, else the one already on the stop (the agent may have saved it at the door)
  const pinOf = (delivery?: Delivery) =>
    pin ? { latitude: pin.latitude, longitude: pin.longitude } : { latitude: delivery?.latitude, longitude: delivery?.longitude };
  const existing = store.getRecords().find((delivery) => delivery.orderNumber === details.orderNumber);
  changed();
  if (existing) {
    // The same agent again: their number and the order's items are put on it again
    if (existing.agent === details.agent && existing.routeId === details.routeId) {
      void store.change(
        existing.id,
        (delivery) => ({ ...delivery, items: details.items, cashToCollect: details.cashToCollect, ...pinOf(delivery) }),
        agentPhoneOf(details.agent) ?? null,
      );
      return existing;
    }
    void store.change(
      existing.id,
      (delivery) =>
        withEvent({ ...delivery, agent: details.agent, routeId: details.routeId, transferRequest: undefined, items: details.items, cashToCollect: details.cashToCollect, ...pinOf(delivery) }, {
          kind: "reassigned",
          fromAgent: delivery.agent,
          toAgent: details.agent,
        }),
      agentPhoneOf(details.agent) ?? null,
    );
    return existing;
  }
  const date = toDateKey(new Date());
  const highest = Math.max(0, ...store.getRecords().map((delivery) => Number(delivery.id.slice(-4)) || 0));
  const newDelivery = withEvent(
    {
      ...stopDetails,
      ...(pin ? { latitude: pin.latitude, longitude: pin.longitude } : {}),
      id: `D-${date.replace(/-/g, "")}-${String(highest + 1).padStart(4, "0")}`,
      date,
      slot: "6–7 AM",
      status: "Pending",
    },
    { kind: "assigned", toAgent: details.agent },
  );
  void store.add(newDelivery, agentPhoneOf(details.agent));
  return newDelivery;
}

// The order was cancelled: its stop goes
export function removeOrderDelivery(orderNumber: string) {
  const delivery = store.getRecords().find((existing) => existing.orderNumber === orderNumber);
  if (!delivery) return;
  changed();
  void store.remove(delivery.id);
}

// An agent asks another to take one of their open stops (only one transfer waits at a time)
export function requestDeliveryTransfer(id: string, toAgent: string, reason: string) {
  const delivery = store.getRecords().find((existing) => existing.id === id);
  if (!delivery || !isDeliveryOpen(delivery) || delivery.transferRequest || delivery.agent === toAgent) return false;
  changed();
  void store.change(id, (existing) =>
    withEvent(
      { ...existing, transferRequest: { fromAgent: existing.agent, toAgent, reason, requestedAt: new Date().toISOString() } },
      { kind: "transfer-requested", fromAgent: existing.agent, toAgent, reason },
    ),
  );
  return true;
}

// The other agent's answer: accepted, the stop (and its number) goes to them; declined, it stays
export function answerDeliveryTransfer(id: string, isAccepted: boolean) {
  const request = store.getRecords().find((existing) => existing.id === id)?.transferRequest;
  if (!request) return;
  changed();
  void store.change(
    id,
    (existing) =>
      withEvent(
        { ...existing, agent: isAccepted ? request.toAgent : existing.agent, transferRequest: undefined },
        { kind: isAccepted ? "transfer-accepted" : "transfer-declined", fromAgent: request.fromAgent, toAgent: request.toAgent },
      ),
    isAccepted ? (agentPhoneOf(request.toAgent) ?? null) : undefined,
  );
}

// Taken back by the panel
export function cancelDeliveryTransfer(id: string) {
  const request = store.getRecords().find((existing) => existing.id === id)?.transferRequest;
  if (!request) return;
  changed();
  void store.change(id, (existing) =>
    withEvent({ ...existing, transferRequest: undefined }, { kind: "transfer-cancelled", fromAgent: request.fromAgent, toAgent: request.toAgent }),
  );
}

// "Somu N asked Shivu M to take it"
export function describeDeliveryEvent(event: DeliveryEvent) {
  switch (event.kind) {
    case "assigned":
      return `Given to ${event.toAgent}`;
    case "reassigned":
      return event.fromAgent ? `Moved from ${event.fromAgent} to ${event.toAgent}` : `Given to ${event.toAgent}`;
    case "transfer-requested":
      return `${event.fromAgent} asked ${event.toAgent} to take it${event.reason ? ` (${event.reason})` : ""}`;
    case "transfer-accepted":
      return `${event.toAgent} took it from ${event.fromAgent}`;
    case "transfer-declined":
      return `${event.toAgent} said no to ${event.fromAgent}`;
    case "transfer-cancelled":
      return `Transfer from ${event.fromAgent} to ${event.toAgent} taken back`;
  }
}

export type DeliveryTransferNews = { key: string; deliveryId: string; orderNumber?: string; customerName: string; event: DeliveryEvent };

// Transfers asked, accepted or declined today, newest first (the panel's bell)
export function useDeliveryTransferNews(): DeliveryTransferNews[] {
  const deliveries = store.useRecords();
  return useMemo(
    () =>
      deliveries
        .flatMap((delivery) =>
          (delivery.history ?? [])
            .filter((event) => event.kind === "transfer-requested" || event.kind === "transfer-accepted" || event.kind === "transfer-declined")
            .map((event) => ({
              key: `${delivery.id}-${event.kind}-${event.at}`,
              deliveryId: delivery.id,
              orderNumber: delivery.orderNumber,
              customerName: delivery.customerName,
              event,
            })),
        )
        .sort((first, second) => second.event.at.localeCompare(first.event.at)),
    [deliveries],
  );
}

/*
  A new day: order stops not finished on an earlier day move on to today (their date changes; staff who
  may change deliveries do it, once a day in this browser). Then today's list is read again.
*/
let carryOverStartedOn = "";
// The day the move finished in this browser (an order is only given to an agent after it, so no stop is doubled)
let carriedOverOn = "";
const carryOverListeners = new Set<() => void>();

async function carryOverOpenOrderDeliveries() {
  const today = toDateKey(new Date());
  if (carryOverStartedOn === today) return;
  carryOverStartedOn = today;
  const supabase = createClient();
  const { data: login } = await supabase.auth.getSession();
  if (login.session) {
    const { data, error } = await supabase
      .from("panel_records")
      .select("id, data")
      .eq("module", "deliveries")
      .lte("data->>date", today)
      .in("data->>status", ["Pending", "Out for delivery"])
      .not("data->>orderNumber", "is", null);
    if (!error && data) {
      const rows = data as { id: string; data: Delivery }[];
      // An order that already has a stop today keeps that one
      const ordersToday = new Set(rows.filter((row) => row.data.date === today).map((row) => row.data.orderNumber));
      let movedAny = false;
      for (const row of rows) {
        if (row.data.date === today || ordersToday.has(row.data.orderNumber)) continue;
        ordersToday.add(row.data.orderNumber);
        const { error: moveError } = await supabase
          .from("panel_records")
          .update({ data: { ...row.data, date: today } })
          .eq("module", "deliveries")
          .eq("id", row.id);
        if (!moveError) movedAny = true;
      }
      if (movedAny) await store.reload();
    }
  }
  carriedOverOn = today;
  carryOverListeners.forEach((onChange) => onChange());
}

// The panel's Orders and Deliveries pages: unfinished order stops from earlier days come along to today
export function useCarryOverOrderDeliveries() {
  useEffect(() => {
    void carryOverOpenOrderDeliveries();
  }, []);
}

// Earlier days' unfinished order stops are in today's list (or there were none)
export function useAreOrderStopsCarriedOver() {
  return useSyncExternalStore(
    (onChange) => {
      carryOverListeners.add(onChange);
      return () => carryOverListeners.delete(onChange);
    },
    () => carriedOverOn === toDateKey(new Date()),
    () => false,
  );
}

// Each agent's day as the Delivery Panel saves it (on / off duty), read only
type AgentDutyRecord = { id: string; date: string; isOnDuty: boolean };

const agentDayStore = createPanelRecordStore<AgentDutyRecord>({
  module: "agent-days",
  filters: () => [["data->>date", toDateKey(new Date())]],
});

// Whether the agent with this number switched On duty today (false: off duty, or not opened today)
export function useAgentOnDutyReader() {
  const days = agentDayStore.useRecords();
  return useMemo(() => {
    const today = toDateKey(new Date());
    const onDuty = new Set(days.filter((day) => day.date === today && day.isOnDuty).map((day) => day.id.split(":")[0]));
    return (phone: string) => onDuty.has(phone);
  }, [days]);
}

export function useTodayDeliveries() {
  return store.useRecords();
}

// Read today's list again now (a stop another agent handed over)
export function reloadTodayDeliveries() {
  return store.reload();
}

// Today's list has been read (a new stop is numbered after the ones already there)
export function useAreTodayDeliveriesLoaded() {
  return store.useIsLoaded();
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
