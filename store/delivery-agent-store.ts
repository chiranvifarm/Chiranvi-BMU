import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useIsLoginStatusKnown, useLoggedInMobileNumber } from "@/components/login/login-status";
import { useIsStaffAccessKnown, useStaffMembers } from "./staff-access-store";
import { setDeliveryStatus, toDateKey, useTodayDeliveries, type Delivery, type DeliverySlot } from "./admin-deliveries-store";
import { useDeliveryAgents, useDeliveryRoutes, type DeliveryAgent, type DeliveryRoute } from "./admin-routes-store";

/*
  The Delivery Panel (/delivery): one delivery agent's day, until the database and real routes exist.
  Who it is for: a number the owner gave the "Delivery agent" role on Roles & permissions (checked by the
  database). The same number on Routes & agents decides which agent they are, and so their stops: today's
  deliveries the Chiranvi Panel gives that agent (store/admin-deliveries-store.ts, sample data).
  What the agent adds is kept per agent and day in this browser ("chiranvi-admin-agent-day-<number>", so it
  is shared with the panel the same way as the panel's own data): their stop order, the step each stop is at
  (Picked up → On the way → Reached), how it ended (Delivered / Left at door / Not delivered) with its proof
  (customer's OTP or a photo), bottles and cash collected, requests raised to the manager, on / off duty and
  notifications. Finishing a stop also marks it on the panel's Deliveries page (Delivered, or Missed), and
  starting one marks it Out for delivery.
  The stops' products, bottles to collect, landmark, gate code, notes, cash to collect and map position are
  sample details made from the delivery's ID, so they stay the same every time, until orders and addresses
  come from the database.
  Stops: Ongoing is the first unfinished stop in the agent's order, Up next the other unfinished ones, and
  Completed the finished ones (including those the panel already shows as Delivered or Missed).
*/

export type StopStep = "picked-up" | "on-the-way" | "reached";
export const STOP_STEPS: { key: StopStep; label: string }[] = [
  { key: "picked-up", label: "Picked up" },
  { key: "on-the-way", label: "On the way" },
  { key: "reached", label: "Reached" },
];

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
  kind: "new-stop" | "route-change" | "request-update" | "manager-message";
  text: string;
  at: string; // ISO
};

export type StopItem = { name: string; packSize: string; quantity: number; price: number };

export type AgentStop = {
  id: string; // the panel's delivery ID, "D-20261030-0004"
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
  latitude: number;
  longitude: number;
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
  notifications: AgentNotification[];
  notificationsSeenAt: string; // ISO, when the bell was last opened
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

// ---------- The agent's day, kept in this browser ----------

const DAY_KEY_PREFIX = "chiranvi-admin-agent-day-";
const days = new Map<string, AgentDay>();
const listeners = new Set<() => void>();

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

function getDay(mobileNumber: string): AgentDay {
  const date = toDateKey(new Date());
  const kept = days.get(mobileNumber);
  if (kept && kept.date === date) return kept;
  let day = freshDay(date);
  if (typeof window !== "undefined") {
    try {
      const saved = JSON.parse(window.localStorage.getItem(DAY_KEY_PREFIX + mobileNumber) ?? "null");
      // Yesterday's day starts over (duty off, new stops), as the panel's deliveries do
      if (saved && saved.date === date) day = { ...day, ...saved };
    } catch {
      // Nothing saved, or storage blocked: a fresh day.
    }
  }
  days.set(mobileNumber, day);
  return day;
}

function saveDay(mobileNumber: string, change: (day: AgentDay) => AgentDay) {
  const day = change(getDay(mobileNumber));
  days.set(mobileNumber, day);
  try {
    window.localStorage.setItem(DAY_KEY_PREFIX + mobileNumber, JSON.stringify(day));
  } catch {
    // Storage blocked (or full, e.g. too many photos): changes last until the page is refreshed.
  }
  listeners.forEach((onChange) => onChange());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // The same agent's day changed in another tab (or on another device, through the shared data)
  function followOtherTabs(event: StorageEvent) {
    if (!event.key?.startsWith(DAY_KEY_PREFIX)) return;
    days.delete(event.key.slice(DAY_KEY_PREFIX.length));
    onChange();
  }
  window.addEventListener("storage", followOtherTabs);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", followOtherTabs);
  };
}

const NO_DAY = freshDay("");

function useAgentDay(mobileNumber: string | null) {
  return useSyncExternalStore(
    subscribe,
    () => (mobileNumber ? getDay(mobileNumber) : NO_DAY),
    () => NO_DAY,
  );
}

// ---------- Sample details for each stop (the same every time for the same delivery) ----------

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

const MILKS: StopItem[] = [
  { name: "A2 Desi Milk", packSize: "1 L glass bottle", quantity: 1, price: 105 },
  { name: "Jersey Milk", packSize: "1 L glass bottle", quantity: 1, price: 60 },
  { name: "Skimmed Milk", packSize: "1 L glass bottle", quantity: 1, price: 95 },
  { name: "A2 Milk", packSize: "500 ml glass bottle", quantity: 1, price: 52 },
];
const EXTRAS: StopItem[] = [
  { name: "Malai Paneer", packSize: "200 g", quantity: 1, price: 95 },
  { name: "Buttermilk", packSize: "500 ml", quantity: 1, price: 25 },
  { name: "White Butter", packSize: "100 g", quantity: 1, price: 143 },
  { name: "Khoa", packSize: "250 g", quantity: 1, price: 160 },
  { name: "A2 Desi Ghee", packSize: "500 ml", quantity: 1, price: 249 },
];
const LANDMARKS = [
  "Opposite the Ganesha temple",
  "Near the bus stop",
  "Next to the Nandini milk booth",
  "Behind the park",
  "Above the medical shop",
  "Near the water tank",
  "Beside the school gate",
  "Corner house, blue gate",
];
const NOTES = [
  "Ring the bell twice",
  "Leave with the security if no answer",
  "Call before coming, dog at home",
  "Keep the milk in the bag on the door",
  "Don't ring before 6 AM",
];

// The delivery's number (the last four digits of "D-20261030-0004"), a steady seed for its sample details
function seedOf(id: string) {
  return Number(id.slice(-4)) || id.length;
}

function areaOf(delivery: Delivery, route: DeliveryRoute | undefined) {
  const fromAddress = delivery.address.split(",").pop()?.trim() ?? "";
  return fromAddress || route?.area || "";
}

function sampleDetails(delivery: Delivery, route: DeliveryRoute | undefined, isTheirRouteAgent: boolean) {
  const seed = seedOf(delivery.id);
  const area = areaOf(delivery, route);
  const milk = { ...MILKS[seed % MILKS.length], quantity: 1 + (seed % 3 === 0 ? 1 : 0) };
  const items: StopItem[] = [milk];
  if (seed % 3 === 1) items.push(EXTRAS[seed % EXTRAS.length]);
  if (seed % 7 === 2) items.push({ ...EXTRAS[(seed + 2) % EXTRAS.length], quantity: 2 });
  // Yesterday's glass bottles come back on two stops in three
  const bottlesToCollect = seed % 3 === 2 ? 0 : milk.packSize.includes("glass") ? milk.quantity : 0;
  // One stop in nine pays cash (an order taken in the panel); website orders are paid online
  const cashToCollect = seed % 9 === 4 ? items.reduce((sum, item) => sum + item.price * item.quantity, 0) : 0;
  const [baseLatitude, baseLongitude] = AREA_POSITIONS[area] ?? AREA_POSITIONS[route?.area ?? ""] ?? BENGALURU_CENTRE;
  return {
    area,
    items,
    bottlesToCollect,
    cashToCollect,
    landmark: LANDMARKS[seed % LANDMARKS.length],
    gateCode: seed % 4 === 1 ? String(4000 + ((seed * 37) % 6000)) : undefined,
    note: seed % 5 === 3 ? NOTES[seed % NOTES.length] : undefined,
    // Added in the panel today, or moved here from another route's agent
    changedByDispatch: !isTheirRouteAgent || seed > 812,
    // Up to about 1.5 km around the area's centre
    latitude: baseLatitude + (((seed * 7919) % 1000) / 1000 - 0.5) * 0.028,
    longitude: baseLongitude + (((seed * 104729) % 1000) / 1000 - 0.5) * 0.028,
  };
}

// The panel already shows these as finished (the sample day, or changed in the panel)
function outcomeFromPanel(delivery: Delivery): StopProgress | null {
  if (delivery.status === "Delivered") {
    return {
      outcome: "delivered",
      finishedAt: delivery.deliveredAt,
      proof: { kind: "otp", code: String(1000 + ((seedOf(delivery.id) * 7) % 9000)) },
    };
  }
  if (delivery.status === "Missed") return { outcome: "not-delivered", notDeliveredReason: "Customer not available" };
  return null;
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
  ongoing: AgentStop | null;
  upNext: AgentStop[];
  completed: AgentStop[]; // newest first
  isOnDuty: boolean;
  requests: AgentRequest[]; // newest first
  notifications: AgentNotification[]; // newest first
  unseenNotificationCount: number;
};

const SLOT_ORDER: DeliverySlot[] = ["5–6 AM", "6–7 AM", "7–8 AM"];

export function useAgentStops(login: DeliveryAgentLogin): AgentStops {
  const mobileNumber = login.state === "agent" ? login.mobileNumber : null;
  const agentName = login.state === "agent" && login.agent ? login.agent.name : null;
  const deliveries = useTodayDeliveries();
  const routes = useDeliveryRoutes();
  const day = useAgentDay(mobileNumber);

  const stops = useMemo(() => {
    if (!agentName) return [];
    const mine = deliveries.filter((delivery) => delivery.agent === agentName);
    return mine.map((delivery): AgentStop => {
      const route = routes.find((existing) => existing.id === delivery.routeId);
      const details = sampleDetails(delivery, route, route?.agent === agentName);
      // What the agent did wins; otherwise what the panel shows
      const progress = day.progress[delivery.id] ?? outcomeFromPanel(delivery) ?? {};
      return {
        id: delivery.id,
        customerName: delivery.customerName,
        phone: delivery.phone,
        address: delivery.address,
        slot: delivery.slot,
        ...details,
        ...progress,
        requests: day.requests.filter((request) => request.deliveryId === delivery.id),
      };
    });
  }, [agentName, deliveries, routes, day]);

  // New stops and stops moved away since the agent last looked: notifications
  useEffect(() => {
    if (!mobileNumber || !agentName || deliveries.length === 0) return;
    const currentIds = stops.map((stop) => stop.id);
    const known = new Set(day.knownStopIds);
    const current = new Set(currentIds);
    const added = stops.filter((stop) => !known.has(stop.id));
    const removed = day.knownStopIds.filter((id) => !current.has(id));
    if (added.length === 0 && removed.length === 0) return;
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
                  text: `Route change: ${removed.length} stop${removed.length === 1 ? "" : "s"} moved to another agent`,
                  at: now,
                },
              ]
            : []),
        ];
    saveDay(mobileNumber, (saved) => ({
      ...saved,
      knownStopIds: currentIds,
      notifications: [...notifications, ...saved.notifications].slice(0, 50),
    }));
  }, [mobileNumber, agentName, deliveries.length, stops, day.knownStopIds]);

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
    return {
      ongoing: unfinished[0] ?? null,
      upNext: unfinished.slice(1),
      completed: finished,
      isOnDuty: day.isOnDuty,
      requests: [...day.requests].sort((first, second) => second.raisedAt.localeCompare(first.raisedAt)),
      notifications: day.notifications,
      unseenNotificationCount: day.notifications.filter((notification) => notification.at > day.notificationsSeenAt).length,
    };
  }, [stops, day]);
}

// ---------- What the agent does ----------

export function setOnDuty(mobileNumber: string, isOnDuty: boolean) {
  saveDay(mobileNumber, (day) => ({ ...day, isOnDuty }));
}

export function markNotificationsSeen(mobileNumber: string) {
  saveDay(mobileNumber, (day) => ({ ...day, notificationsSeenAt: new Date().toISOString() }));
}

// The next step on the current stop; the panel shows it Out for delivery
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

// Moves a stop one place up or down among the stops still to go (the ongoing one stays first)
export function moveStop(mobileNumber: string, unfinishedIds: string[], stopId: string, direction: -1 | 1) {
  const index = unfinishedIds.indexOf(stopId);
  const target = index + direction;
  // Index 0 is the ongoing stop
  if (index < 1 || target < 1 || target >= unfinishedIds.length) return;
  const newOrder = [...unfinishedIds];
  [newOrder[index], newOrder[target]] = [newOrder[target], newOrder[index]];
  setStopOrder(mobileNumber, newOrder);
}

/*
  Optimise route: from the ongoing stop, always ride to the nearest stop left (keeps each time slot
  together, so earlier slots are still served first).
*/
export function optimiseRoute(mobileNumber: string, ongoing: AgentStop | null, upNext: AgentStop[]) {
  const ordered: AgentStop[] = [];
  let current: AgentStop | null = ongoing;
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
  setStopOrder(mobileNumber, [...(ongoing ? [ongoing.id] : []), ...ordered.map((stop) => stop.id), ...rest.map((stop) => stop.id)]);
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

// Indian mobile links: call, WhatsApp, text message
export function callLink(phone: string) {
  return `tel:+91${phone}`;
}

export function whatsAppLink(phone: string) {
  return `https://wa.me/91${phone}`;
}

export function messageLink(phone: string) {
  return `sms:+91${phone}`;
}

function placeQuery(stop: AgentStop) {
  return `${stop.address}, ${stop.landmark}, Bengaluru`;
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
