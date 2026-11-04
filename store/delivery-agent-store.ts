import { useEffect, useMemo, useState } from "react";
import { useIsLoginStatusKnown, useLoggedInMobileNumber } from "@/components/login/login-status";
import { useIsStaffAccessKnown, useStaffMembers } from "./staff-access-store";
import {
  reloadTodayDeliveries,
  setDeliveryStatus,
  toDateKey,
  useAreTodayDeliveriesLoaded,
  useTodayDeliveries,
  type Delivery,
  type DeliverySlot,
  type DeliveryStatus,
} from "./admin-deliveries-store";
import { useDeliveryAgents, useDeliveryRoutes, type DeliveryAgent, type DeliveryRoute } from "./admin-routes-store";
import { createPanelRecordStore } from "./panel-records";
import { createClient } from "@/lib/supabase/client";

/*
  The Delivery Panel (/delivery): one delivery agent's day.
  Who it is for: a number the owner gave the "Delivery agent" role on Roles & permissions (checked by the
  database). The same number on Routes & agents decides which agent they are, and so their stops: today's
  deliveries the Chiranvi Panel gives that agent (store/admin-deliveries-store.ts).
  What the agent adds is kept per agent and day in the database (panel_records, "agent-days", one record per
  agent and day; only that agent, and staff with Deliveries → View, can read it): their stop order, the step each stop is at
  (Picked up), how it ended (Delivered / Left at door / Not delivered) with its proof
  (customer's OTP or a photo), bottles and cash collected, requests raised to the manager, on / off duty and
  notifications. Finishing a stop also marks it on the panel's Deliveries page (Delivered, or Missed), and
  starting one marks it Out for delivery.
  A stop shows only what is real: an order's items and cash to collect. A stop with a map pin (the customer's address pin, or the spot the agent saved at
  the gate; 0027_address_pins.sql) uses it: Google Maps goes to that exact spot. Without one, Maps searches
  the address text.
  Stops: Ongoing is the first unfinished one-time order and the first unfinished subscription in the agent's
  order, Up next the other unfinished ones, and Completed the finished ones (including those the panel already
  shows as Delivered or Missed).
*/

export type StopStep = "picked-up";
export const STOP_STEPS: { key: StopStep; label: string }[] = [{ key: "picked-up", label: "Picked up" }];

export type StopOutcome = "delivered" | "left-at-door" | "not-delivered";
export const STOP_OUTCOME_LABELS: Record<StopOutcome, string> = {
  delivered: "Delivered",
  "left-at-door": "Left at door",
  "not-delivered": "Not delivered",
};

// Proof of delivery: the OTP the customer read out, or a photo (small, kept in this browser)
export type StopProof = { kind: "otp"; code: string } | { kind: "photo"; photo: string };

export const NOT_DELIVERED_REASONS = [
  "Customer not available",
  "Customer refused",
  "Wrong address",
  "Couldn't reach the address",
  "Product damaged",
  "Other",
];

export type AgentRequestKind = "Customer unavailable" | "Wrong address" | "Damaged product" | "Missing item" | "Reschedule" | "Other";
export const AGENT_REQUEST_KINDS: AgentRequestKind[] = [
  "Customer unavailable",
  "Wrong address",
  "Damaged product",
  "Missing item",
  "Reschedule",
  "Other",
];

export type AgentRequest = {
  id: string;
  deliveryId: string;
  customerName: string;
  kind: AgentRequestKind;
  note: string;
  raisedAt: string; // ISO
  status: "Pending" | "Resolved";
};

export type AgentNotification = {
  id: string;
  kind: "new-stop" | "route-change" | "status-change" | "request-update" | "manager-message" | "skip" | "pause";
  text: string;
  at: string; // ISO
};

export type StopItem = { name: string; packSize: string; quantity: number; price: number };

export type AgentStop = {
  id: string; // the panel's delivery ID, "D-20261030-0004"
  status: DeliveryStatus; // as on the panel's Deliveries page
  customerName: string;
  phone: string; // 10 digits
  address: string;
  area: string;
  landmark: string;
  gateCode?: string;
  slot: DeliverySlot;
  items: StopItem[];
  bottlesToCollect: number;
  note?: string;
  cashToCollect: number; // rupees; 0 for prepaid orders
  changedByDispatch: boolean; // the panel added this stop today or moved it to this agent
  isSubscription: boolean; // a daily milk delivery (else a one-time order)
  latitude: number;
  longitude: number;
  hasExactPin: boolean; // latitude / longitude are the address's real pin (else made up near the area's centre)
  // The agent's progress
  step?: StopStep;
  outcome?: StopOutcome;
  finishedAt?: string; // ISO
  proof?: StopProof;
  notDeliveredReason?: string;
  bottlesCollected?: number;
  cashCollected?: number;
  requests: AgentRequest[];
};

type StopProgress = {
  step?: StopStep;
  outcome?: StopOutcome;
  finishedAt?: string;
  proof?: StopProof;
  notDeliveredReason?: string;
  bottlesCollected?: number;
  cashCollected?: number;
};

type AgentDay = {
  date: string; // YYYY-MM-DD
  isOnDuty: boolean;
  order: string[]; // stop IDs in the agent's order (stops not in it go at the end, by slot)
  progress: Record<string, StopProgress>;
  requests: AgentRequest[];
  knownStopIds: string[]; // the stops seen so far today (new ones and removed ones become notifications)
  knownStopStatuses?: Record<string, DeliveryStatus>; // each stop's status when last seen (a change becomes a notification)
  notifications: AgentNotification[];
  notificationsSeenAt: string; // ISO, when the bell was last opened
  readNotificationIds?: string[]; // pressed OK or Mark all as read
  knownPlanEvents?: string[]; // approved skips and pauses seen so far today (new ones become notifications)
};

// ---------- Who is logged in ----------

export type DeliveryAgentLogin =
  | { state: "loading" }
  | { state: "logged-out" }
  | { state: "not-an-agent" }
  | { state: "agent"; mobileNumber: string; name: string; agent: DeliveryAgent | null; route: DeliveryRoute | null };

// The logged-in person as a delivery agent: their role (database) and their agent on Routes & agents (same number)
export function useDeliveryAgentLogin(): DeliveryAgentLogin {
  const isLoginStatusKnown = useIsLoginStatusKnown();
  const mobileNumber = useLoggedInMobileNumber();
  const isStaffAccessKnown = useIsStaffAccessKnown();
  const team = useStaffMembers();
  const agents = useDeliveryAgents();
  const routes = useDeliveryRoutes();
  return useMemo(() => {
    if (!isLoginStatusKnown) return { state: "loading" };
    if (!mobileNumber) return { state: "logged-out" };
    if (!isStaffAccessKnown) return { state: "loading" };
    const member = team.find((existing) => existing.mobileNumber === mobileNumber && existing.roleId === "delivery-agent");
    if (!member) return { state: "not-an-agent" };
    const agent = agents.find((existing) => existing.phone === mobileNumber) ?? null;
    const route = agent ? (routes.find((existing) => existing.agent === agent.name) ?? null) : null;
    return { state: "agent", mobileNumber, name: agent?.name ?? member.name, agent, route };
  }, [isLoginStatusKnown, mobileNumber, isStaffAccessKnown, team, agents, routes]);
}

// For the account page's "Delivery Panel" button
export function useIsDeliveryAgent() {
  return useDeliveryAgentLogin().state === "agent";
}

// ---------- The agent's day, kept in the database ----------

// One record per agent and day: "<number>:<YYYY-MM-DD>"
type AgentDayRecord = AgentDay & { id: string };

const dayStore = createPanelRecordStore<AgentDayRecord>({ module: "agent-days" });

// The days as earlier versions kept them in this browser: deleted (the database keeps them now)
const OLD_DAY_KEY_PREFIX = "chiranvi-admin-agent-day-";
let hasForgottenOldDays = false;

function forgetOldBrowserDays() {
  if (hasForgottenOldDays || typeof window === "undefined") return;
  hasForgottenOldDays = true;
  try {
    const oldKeys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index) ?? "");
    oldKeys.filter((key) => key.startsWith(OLD_DAY_KEY_PREFIX)).forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Storage blocked: nothing kept to delete.
  }
}

function freshDay(date: string): AgentDay {
  return {
    date,
    isOnDuty: false,
    order: [],
    progress: {},
    requests: [],
    knownStopIds: [],
    notifications: [],
    notificationsSeenAt: "",
  };
}

function dayIdOf(mobileNumber: string, date = toDateKey(new Date())) {
  return `${mobileNumber}:${date}`;
}

// A day not saved yet: the same object every time (so pages don't redraw for nothing)
const freshDays = new Map<string, AgentDay>();

// Today's day for this agent (a new day starts over: duty off, new stops), as the panel's deliveries do
function findDay(records: AgentDayRecord[], mobileNumber: string): AgentDay {
  const id = dayIdOf(mobileNumber);
  const saved = records.find((record) => record.id === id);
  if (saved) return saved;
  if (!freshDays.has(id)) freshDays.set(id, freshDay(toDateKey(new Date())));
  return freshDays.get(id) as AgentDay;
}

function saveDay(mobileNumber: string, change: (day: AgentDay) => AgentDay) {
  forgetOldBrowserDays();
  const id = dayIdOf(mobileNumber);
  const existing = dayStore.getRecords().find((record) => record.id === id);
  if (existing) {
    void dayStore.change(id, () => ({ ...change(existing), id }));
    return;
  }
  void saveDayNotReadYet(mobileNumber, id, change);
}

// Today's day isn't in this browser's list (e.g. the list was read before midnight): the database may already
// have it, so it is changed there instead of added a second time
async function saveDayNotReadYet(mobileNumber: string, id: string, change: (day: AgentDay) => AgentDay) {
  const supabase = createClient();
  const { data: saved } = await supabase.from("panel_records").select("data").eq("module", "agent-days").eq("id", id).maybeSingle();
  if (!saved) {
    void dayStore.add({ ...change(findDay(dayStore.getRecords(), mobileNumber)), id }, mobileNumber);
    return;
  }
  const { error } = await supabase
    .from("panel_records")
    .update({ data: { ...change(saved.data as AgentDay), id } })
    .eq("module", "agent-days")
    .eq("id", id);
  if (error) console.error("The database did not accept the change to the agent's day", error);
  await dayStore.reload();
}

const NO_DAY = freshDay("");

function useAgentDay(mobileNumber: string | null) {
  const records = dayStore.useRecords();
  useEffect(forgetOldBrowserDays, []);
  return useMemo(() => (mobileNumber ? findDay(records, mobileNumber) : NO_DAY), [records, mobileNumber]);
}

// ---------- What each stop shows ----------

// Where each area is (centre), for the route map and distances
const AREA_POSITIONS: Record<string, [number, number]> = {
  "RR Nagar": [12.9274, 77.5155],
  Kengeri: [12.9081, 77.4826],
  Banashankari: [12.9255, 77.5468],
  Jayanagar: [12.925, 77.5938],
  Uttarahalli: [12.9066, 77.5449],
  "JP Nagar": [12.9063, 77.5857],
  Basavanagudi: [12.9421, 77.5737],
  Vijayanagar: [12.9719, 77.5376],
};
const BENGALURU_CENTRE: [number, number] = [12.9352, 77.5615];

// The delivery's number (the last four digits of "D-20261030-0004"), a steady spread for stops without a pin
function seedOf(id: string) {
  return Number(id.slice(-4)) || id.length;
}

function areaOf(delivery: Delivery, route: DeliveryRoute | undefined) {
  const fromAddress = delivery.address.split(",").pop()?.trim() ?? "";
  return fromAddress || route?.area || "";
}

function stopDetails(delivery: Delivery, route: DeliveryRoute | undefined) {
  const seed = seedOf(delivery.id);
  const area = areaOf(delivery, route);
  const [baseLatitude, baseLongitude] = AREA_POSITIONS[area] ?? AREA_POSITIONS[route?.area ?? ""] ?? BENGALURU_CENTRE;
  // The stop's real map pin, when its address has one
  const exactPin =
    typeof delivery.latitude === "number" && typeof delivery.longitude === "number"
      ? { latitude: delivery.latitude, longitude: delivery.longitude, hasExactPin: true }
      : null;
  return {
    area: delivery.area || area,
    items: delivery.items ?? [],
    bottlesToCollect: 0,
    cashToCollect: delivery.cashToCollect ?? 0,
    landmark: "",
    gateCode: undefined,
    note: undefined,
    changedByDispatch: false,
    // On the map: the address's pin, else around the area's centre
    latitude: baseLatitude + (((seed * 7919) % 1000) / 1000 - 0.5) * 0.028,
    longitude: baseLongitude + (((seed * 104729) % 1000) / 1000 - 0.5) * 0.028,
    hasExactPin: false,
    ...exactPin,
  };
}

// The panel already shows these as finished (changed in the panel)
function outcomeFromPanel(delivery: Delivery): StopProgress | null {
  if (delivery.status === "Delivered") {
    return {
      outcome: "delivered",
      finishedAt: delivery.deliveredAt,
    };
  }
  if (delivery.status === "Missed") return { outcome: "not-delivered", notDeliveredReason: "Customer not available" };
  return null;
}

/*
  Where a stop stands. Its status on the Deliveries list decides, the same for the agent and the panel: finished
  there (Delivered, Missed) is finished here, and reopened there is reopened here. What the agent saved adds the
  details (proof, bottles, cash) when it agrees.
*/
function progressOf(delivery: Delivery, saved: StopProgress | undefined): StopProgress {
  const fromPanel = outcomeFromPanel(delivery);
  if (!fromPanel) {
    return {
      ...saved,
      step: saved?.step ?? (delivery.status === "Out for delivery" ? "picked-up" : undefined),
      outcome: undefined,
      finishedAt: undefined,
    };
  }
  if (saved?.outcome && (saved.outcome === "not-delivered") === (delivery.status === "Missed")) return saved;
  return { ...saved, ...fromPanel };
}

// ---------- Distances ----------

// Road distance between two stops: straight line × 1.3 (Bengaluru roads), in km
export function distanceBetween(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latitudeChange = radians(to.latitude - from.latitude);
  const longitudeChange = radians(to.longitude - from.longitude);
  const a =
    Math.sin(latitudeChange / 2) ** 2 +
    Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeChange / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a)) * 1.3;
}

// About 20 km/h on a two-wheeler in the morning, plus 4 minutes at each stop
const RIDING_KM_PER_HOUR = 20;
const MINUTES_AT_EACH_STOP = 4;

export function minutesFor(distanceKm: number, stops: number) {
  return Math.round((distanceKm / RIDING_KM_PER_HOUR) * 60 + stops * MINUTES_AT_EACH_STOP);
}

// ---------- The agent's stops ----------

export type AgentStops = {
  ongoing: AgentStop[]; // at most two, in the agent's order: one one-time order, one subscription
  upNext: AgentStop[];
  completed: AgentStop[]; // newest first
  isOnDuty: boolean;
  isLoaded: boolean; // the stops and the agent's day have been read (the sidebar's counts wait for it)
  requests: AgentRequest[]; // newest first
  notifications: AgentNotification[]; // newest first
  unseenNotificationCount: number;
  unreadNotifications: AgentNotification[]; // on the dashboard until OK or Mark all as read
  knownPlanEvents?: string[];
};

const SLOT_ORDER: DeliverySlot[] = ["5–6 AM", "6–7 AM", "7–8 AM"];

export function useAgentStops(login: DeliveryAgentLogin): AgentStops {
  const mobileNumber = login.state === "agent" ? login.mobileNumber : null;
  const agentName = login.state === "agent" && login.agent ? login.agent.name : null;
  const deliveries = useTodayDeliveries();
  const routes = useDeliveryRoutes();
  const day = useAgentDay(mobileNumber);
  const areDeliveriesLoaded = useAreTodayDeliveriesLoaded();
  const isDayLoaded = dayStore.useIsLoaded();
  const isLoaded = areDeliveriesLoaded && isDayLoaded;

  const stops = useMemo(() => {
    if (!agentName) return [];
    const mine = deliveries.filter((delivery) => delivery.agent === agentName);
    return mine.map((delivery): AgentStop => {
      const route = routes.find((existing) => existing.id === delivery.routeId);
      const details = stopDetails(delivery, route);
      const progress = progressOf(delivery, day.progress[delivery.id]);
      return {
        id: delivery.id,
        status: delivery.status,
        customerName: delivery.customerName,
        phone: delivery.phone,
        address: delivery.address,
        slot: delivery.slot,
        // The route's own stops, with no order behind them, are the daily milk round
        isSubscription: delivery.orderNumber ? Boolean(delivery.isSubscription) : true,
        ...details,
        ...progress,
        requests: day.requests.filter((request) => request.deliveryId === delivery.id),
      };
    });
  }, [agentName, deliveries, routes, day]);

  // New stops and stops moved away since the agent last looked: notifications
  useEffect(() => {
    if (!mobileNumber || !agentName || !isLoaded || deliveries.length === 0) return;
    const currentIds = stops.map((stop) => stop.id);
    const known = new Set(day.knownStopIds);
    const current = new Set(currentIds);
    const added = stops.filter((stop) => !known.has(stop.id));
    const removed = day.knownStopIds.filter((id) => !current.has(id));
    const knownStatuses = day.knownStopStatuses;
    const areStatusesKnown = knownStatuses !== undefined && stops.every((stop) => knownStatuses[stop.id] === stop.status);
    if (added.length === 0 && removed.length === 0 && areStatusesKnown) return;
    const changedStops = stops.filter((stop) => knownStatuses?.[stop.id] && knownStatuses[stop.id] !== stop.status);
    // The first look of the day only learns the stops (they are not "new")
    const isFirstLook = day.knownStopIds.length === 0;
    const now = new Date().toISOString();
    const notifications: AgentNotification[] = isFirstLook
      ? []
      : [
          ...added.map((stop) => ({
            id: `new-${stop.id}`,
            kind: "new-stop" as const,
            text: `New stop: ${stop.customerName}, ${stop.address} (${stop.slot})`,
            at: now,
          })),
          ...(removed.length > 0
            ? [
                {
                  id: `moved-${now}`,
                  kind: "route-change" as const,
                  text: `Route change: ${removed.length} stop${removed.length === 1 ? "" : "s"} moved to another agent or cancelled`,
                  at: now,
                },
              ]
            : []),
          ...changedStops.map((stop) => ({
            id: `status-${stop.id}-${stop.status}-${now}`,
            kind: "status-change" as const,
            text: `${stop.customerName}: now ${stop.status.toLowerCase()}`,
            at: now,
          })),
        ];
    saveDay(mobileNumber, (saved) => ({
      ...saved,
      knownStopIds: currentIds,
      knownStopStatuses: Object.fromEntries(stops.map((stop) => [stop.id, stop.status])),
      notifications: [...notifications, ...saved.notifications].slice(0, 50),
    }));
  }, [mobileNumber, agentName, isLoaded, deliveries.length, stops, day.knownStopIds, day.knownStopStatuses]);

  return useMemo(() => {
    const finished = stops.filter((stop) => stop.outcome);
    const unfinished = stops.filter((stop) => !stop.outcome);
    // The agent's order first, then the rest by slot (then as the panel lists them)
    const position = new Map(day.order.map((id, index) => [id, index]));
    unfinished.sort((first, second) => {
      const firstPosition = position.get(first.id) ?? Number.MAX_SAFE_INTEGER;
      const secondPosition = position.get(second.id) ?? Number.MAX_SAFE_INTEGER;
      if (firstPosition !== secondPosition) return firstPosition - secondPosition;
      return SLOT_ORDER.indexOf(first.slot) - SLOT_ORDER.indexOf(second.slot) || first.id.localeCompare(second.id);
    });
    finished.sort((first, second) => (second.finishedAt ?? "").localeCompare(first.finishedAt ?? ""));
    const firstOfEachKind = [unfinished.find((stop) => !stop.isSubscription), unfinished.find((stop) => stop.isSubscription)];
    return {
      ongoing: unfinished.filter((stop) => firstOfEachKind.includes(stop)),
      upNext: unfinished.filter((stop) => !firstOfEachKind.includes(stop)),
      completed: finished,
      isOnDuty: day.isOnDuty,
      isLoaded,
      requests: [...day.requests].sort((first, second) => second.raisedAt.localeCompare(first.raisedAt)),
      notifications: day.notifications,
      unseenNotificationCount: day.notifications.filter((notification) => !day.readNotificationIds?.includes(notification.id)).length,
      unreadNotifications: day.notifications.filter((notification) => !day.readNotificationIds?.includes(notification.id)),
      knownPlanEvents: day.knownPlanEvents,
    };
  }, [stops, day, isLoaded]);
}

// ---------- The milk plans given to this agent (0035_… and 0036_…sql) ----------

export type AssignedPlan = {
  orderNumber: string;
  customerName: string;
  area: string;
  milk: string;
  bottles: string; // "1 × 1 L"
  firstDay: string; // YYYY-MM-DD
  lastDay: string;
  skips: string[]; // approved
  pauses: { from: string; to: string }[]; // approved; "to" is the day it resumes
  stops: Record<string, string>; // day → "Delivered", "Missed", ...
  slot: string; // "6–7 AM"
};

// Read now, when the window comes back into focus, and every minute (staff approve skips while the agent is out)
export function useAssignedPlans() {
  const [plans, setPlans] = useState<AssignedPlan[] | null>(null);
  const [hasProblem, setHasProblem] = useState(false);

  async function loadPlans() {
    const { data, error } = await createClient().rpc("my_assigned_plans");
    setHasProblem(Boolean(error));
    if (!error) setPlans((data ?? []) as AssignedPlan[]);
  }

  useEffect(() => {
    const reload = () => void loadPlans();
    const firstRead = window.setTimeout(reload, 0);
    window.addEventListener("focus", reload);
    const timer = window.setInterval(reload, 60_000);
    return () => {
      window.clearTimeout(firstRead);
      window.removeEventListener("focus", reload);
      window.clearInterval(timer);
    };
  }, []);

  return { plans, hasProblem, loadPlans };
}

const shortDay = (dayKey: string) => new Date(`${dayKey}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// New approved skips and pauses become notifications; the first look of the day only learns them
export function learnPlanEvents(mobileNumber: string, plans: AssignedPlan[], known: string[] | undefined) {
  const events = plans.flatMap((plan) => [
    ...plan.skips.map((day) => ({
      key: `skip-${plan.orderNumber}-${day}`,
      kind: "skip" as const,
      text: `Skip approved: ${plan.customerName}, no delivery on ${shortDay(day)}`,
    })),
    ...plan.pauses.map((pause) => ({
      key: `pause-${plan.orderNumber}-${pause.from}`,
      kind: "pause" as const,
      text: `Pause approved: ${plan.customerName}, no delivery from ${shortDay(pause.from)}, back on ${shortDay(pause.to)}`,
    })),
  ]);
  const added = events.filter((event) => !known?.includes(event.key));
  if (known !== undefined && added.length === 0) return;
  const now = new Date().toISOString();
  saveDay(mobileNumber, (day) => ({
    ...day,
    knownPlanEvents: events.map((event) => event.key),
    notifications: [
      ...(known === undefined ? [] : added.map((event) => ({ id: event.key, kind: event.kind, text: event.text, at: now }))),
      ...day.notifications,
    ].slice(0, 50),
  }));
}

// OK or Mark all as read: they leave the dashboard and stay in the bell's list
export function markNotificationsRead(mobileNumber: string, ids: string[]) {
  saveDay(mobileNumber, (day) => ({ ...day, readNotificationIds: [...new Set([...(day.readNotificationIds ?? []), ...ids])] }));
}

// ---------- What the agent does ----------

/*
  "Save this spot as the customer's location" at the gate (0027_address_pins.sql): the database checks it is
  the agent's own stop today and changes only the pin: on the stop, its order and the customer's saved
  address (so every later delivery there is exact). Answers a problem to show, or null when saved.
*/
export async function saveStopLocation(stopId: string, pin: { latitude: number; longitude: number }) {
  const { error } = await createClient().rpc("save_stop_location", {
    stop_id: stopId,
    pin_latitude: pin.latitude,
    pin_longitude: pin.longitude,
  });
  await reloadTodayDeliveries();
  if (error) return error.message || "Couldn't save the location. Try again.";
  return null;
}

export function setOnDuty(mobileNumber: string, isOnDuty: boolean) {
  saveDay(mobileNumber, (day) => ({ ...day, isOnDuty }));
}

// The stop is picked up; the panel shows it Out for delivery
export function setStopStep(mobileNumber: string, stopId: string, step: StopStep) {
  saveDay(mobileNumber, (day) => ({
    ...day,
    progress: { ...day.progress, [stopId]: { ...day.progress[stopId], step } },
  }));
  setDeliveryStatus(stopId, "Out for delivery");
}

/*
  The stop is done: Delivered or Left at door (the panel shows Delivered), or Not delivered (the panel shows
  Missed). It moves to Completed and the next stop becomes Ongoing.
*/
export function finishStop(
  mobileNumber: string,
  stopId: string,
  outcome: StopOutcome,
  details: { proof?: StopProof; notDeliveredReason?: string; bottlesCollected?: number; cashCollected?: number },
) {
  saveDay(mobileNumber, (day) => ({
    ...day,
    progress: {
      ...day.progress,
      [stopId]: { ...day.progress[stopId], ...details, outcome, finishedAt: new Date().toISOString() },
    },
  }));
  setDeliveryStatus(stopId, outcome === "not-delivered" ? "Missed" : "Delivered");
}

// A new order for the stops still to go (Up next: moving a stop, or Optimise route)
export function setStopOrder(mobileNumber: string, stopIds: string[]) {
  saveDay(mobileNumber, (day) => ({ ...day, order: stopIds }));
}

// Moves a stop one place up or down among the stops still to go (the ongoing ones stay first)
export function moveStop(mobileNumber: string, unfinishedIds: string[], ongoingCount: number, stopId: string, direction: -1 | 1) {
  const index = unfinishedIds.indexOf(stopId);
  const target = index + direction;
  if (index < ongoingCount || target < ongoingCount || target >= unfinishedIds.length) return;
  const newOrder = [...unfinishedIds];
  [newOrder[index], newOrder[target]] = [newOrder[target], newOrder[index]];
  setStopOrder(mobileNumber, newOrder);
}

/*
  Optimise route: from the last ongoing stop, always ride to the nearest stop left (keeps each time slot
  together, so earlier slots are still served first).
*/
export function optimiseRoute(mobileNumber: string, ongoing: AgentStop[], upNext: AgentStop[]) {
  const ordered: AgentStop[] = [];
  let current: AgentStop | null = ongoing[ongoing.length - 1] ?? null;
  for (const slot of SLOT_ORDER) {
    const left = upNext.filter((stop) => stop.slot === slot);
    while (left.length > 0) {
      const from = current ?? left[0];
      let nearestIndex = 0;
      left.forEach((stop, index) => {
        if (distanceBetween(from, stop) < distanceBetween(from, left[nearestIndex])) nearestIndex = index;
      });
      current = left.splice(nearestIndex, 1)[0];
      ordered.push(current);
    }
  }
  // Stops in a slot not listed above keep their place at the end
  const rest = upNext.filter((stop) => !SLOT_ORDER.includes(stop.slot));
  setStopOrder(mobileNumber, [...ongoing, ...ordered, ...rest].map((stop) => stop.id));
}

export function raiseRequest(mobileNumber: string, stop: AgentStop, kind: AgentRequestKind, note: string) {
  const request: AgentRequest = {
    id: `REQ-${Date.now().toString(36).toUpperCase()}`,
    deliveryId: stop.id,
    customerName: stop.customerName,
    kind,
    note: note.trim(),
    raisedAt: new Date().toISOString(),
    status: "Pending",
  };
  saveDay(mobileNumber, (day) => ({ ...day, requests: [request, ...day.requests] }));
  return request;
}

// ---------- Helpers for the pages ----------

// Indian mobile links: call, text message
export function callLink(phone: string) {
  return `tel:+91${phone}`;
}

export function messageLink(phone: string) {
  return `sms:+91${phone}`;
}

// Where Google Maps goes: the exact pin ("12.9081,77.4826"), else the address text for Maps to search
function placeQuery(stop: AgentStop) {
  if (stop.hasExactPin) return `${stop.latitude},${stop.longitude}`;
  return [stop.address, stop.landmark, "Bengaluru"].filter(Boolean).join(", ");
}

// Google Maps directions to one stop
export function navigationLink(stop: AgentStop) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(placeQuery(stop))}&travelmode=two-wheeler`;
}

// Google Maps directions through the stops in order (Google takes the first 9 stops in between)
export function routeLink(stops: AgentStop[]) {
  if (stops.length === 0) return "";
  const destination = stops[stops.length - 1];
  const waypoints = stops.slice(0, -1).slice(0, 9).map(placeQuery).join("|");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(placeQuery(destination))}${
    waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ""
  }&travelmode=two-wheeler`;
}

// "6:42 AM"
export function formatTime(iso: string | Date) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
}

export function rupees(amount: number) {
  return `₹${amount.toLocaleString("en-IN")}`;
}

// The live camera's picture right now, made as small as shrinkPhoto's
export function photoFromVideo(video: HTMLVideoElement) {
  const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

// A photo taken for proof, made small (longest side 480) so it fits in the browser's storage
export function shrinkPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const image = new window.Image();
      image.onerror = () => reject(new Error("Not a picture"));
      image.onload = () => {
        const scale = Math.min(1, 480 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
