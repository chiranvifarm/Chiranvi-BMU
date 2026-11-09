import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { createPanelRecordStore } from "./panel-records";

/*
  Delivery routes and agents for the Chiranvi Panel (Routes & agents page, and the Deliveries page's
  route names, colours and agent lists). Kept in the database (panel_records, "routes" and "agents";
  supabase/migrations/0019_… and 0020_…), seen and changed by the staff member's role (Routes & agents).
  - Routes are added on Routes & agents; route colours are Chiranvi greens and yellows.
  - Agents: everyone with the Delivery agent role gets a card (supabase/migrations/0024_…).
  Each route and agent card carries its agent's number, so a delivery agent (Delivery Panel) reads only their
  own card and route.
  - Where Chiranvi delivers (app_settings "delivery_service", 0039_service_areas_and_hub.sql): the service areas,
    the farm hub's exact spot and the distance limit from it. The cart uses it to tell a customer why an address
    can't be used; the database checks the same at Pay now, so it can't be got round from a browser.
*/

export type DeliveryRoute = {
  id: string; // "R1"
  name: string; // "Route 1"
  area: string;
  agent: string; // full name of the agent on this route ("": no agent yet)
  colour: string;
  // The area's centre (0054_one_time_orders_anywhere_in_bengaluru.sql): how near the route runs to a one-time
  // order outside the 8 areas. Dropped when the area changes (its stops' pins still count).
  latitude?: number;
  longitude?: number;
};

export type DeliveryHub = { name: string; latitude: number; longitude: number };

export type DeliveryService = {
  areas: string[];
  hub: DeliveryHub | null; // null: its exact spot hasn't been saved yet
  limitKm: number | null; // how far from the hub Chiranvi delivers (null: not set yet)
  contactPhone: string; // 10 digits
};

// Why an address can't take a new order: not a service area (milk plan), not in Bengaluru (one-time products),
// no map pin, or too far from the hub (milk plan)
export type ServiceProblem = "area" | "city" | "pin" | "far";

export type DeliveryAgent = {
  name: string;
  phone: string; // 10 digits
  bike: string; // "KA-05-4120"
  isOnLeave?: boolean;
};

// An agent card in the database: its id is the agent's name (what routes and deliveries point to)
type AgentRecord = DeliveryAgent & { id: string };

// Route colours (greens and yellows)
const MORE_ROUTE_COLOURS = ["#3d7a3a", "#e0a91f", "#6f8f2e", "#b3872a", "#2f6b52", "#d9b54a"];

const routeStore = createPanelRecordStore<DeliveryRoute>({ module: "routes" });

const agentStore = createPanelRecordStore<AgentRecord>({ module: "agents" });

// The agent's login number (their route and stops carry it, so the Delivery Panel shows them only their own)
export function agentPhoneOf(agentName: string): string | undefined {
  const phone = agentStore.getRecords().find((agent) => agent.name === agentName)?.phone;
  return phone && /^\d{10}$/.test(phone) ? phone : undefined;
}

// Edit routes: new area or agent for each route (a route given to another agent goes with that agent's number)
export function updateRoutes(changes: { id: string; area: string; agent: string }[]) {
  for (const change of changes) {
    const route = routeStore.getRecords().find((existing) => existing.id === change.id);
    if (!route || (route.area === change.area && route.agent === change.agent)) continue;
    void routeStore.change(
      change.id,
      (existing) =>
        existing.area === change.area
          ? { ...existing, agent: change.agent }
          : { ...existing, area: change.area, agent: change.agent, latitude: undefined, longitude: undefined },
      route.agent === change.agent ? undefined : (agentPhoneOf(change.agent) ?? null));
  }
}

export function addRoute(area: string, agent: string) {
  const current = routeStore.getRecords();
  const number = Math.max(0, ...current.map((route) => Number(route.id.slice(1)) || 0)) + 1;
  const newRoute: DeliveryRoute = {
    id: `R${number}`,
    name: `Route ${number}`,
    area,
    agent,
    colour: MORE_ROUTE_COLOURS[(number - 1) % MORE_ROUTE_COLOURS.length],
  };
  void routeStore.add(newRoute, agentPhoneOf(agent));
  return newRoute;
}

// Set from the Staff page: an agent on leave is not on duty here either
export function setAgentOnLeave(name: string, isOnLeave: boolean) {
  if (!agentStore.getRecords().some((agent) => agent.name === name)) return;
  void agentStore.change(name, (agent) => ({ ...agent, isOnLeave }));
}

// Read the agents again (a new agent's card is added by the database)
export function reloadDeliveryAgents() {
  return agentStore.reload();
}

export function useDeliveryRoutes() {
  return routeStore.useRecords();
}

// The agent cards (each also carries its id, the agent's name)
export function useDeliveryAgents(): DeliveryAgent[] {
  return agentStore.useRecords();
}

// ---------- Where Chiranvi delivers ----------

let deliveryService: DeliveryService | null = null;
let isFollowingService = false;
const serviceListeners = new Set<() => void>();

// Everyone may read it. Not in the database yet: null, and the cart shows nothing
async function loadDeliveryService() {
  const { data, error } = await createClient().from("app_settings").select("value").eq("key", "delivery_service").maybeSingle();
  if (error) {
    console.error("Could not read where Chiranvi delivers", error);
    return;
  }
  deliveryService = (data?.value as DeliveryService | undefined) ?? null;
  serviceListeners.forEach((onChange) => onChange());
}

function subscribeToService(onChange: () => void) {
  serviceListeners.add(onChange);
  if (!isFollowingService && typeof window !== "undefined") {
    isFollowingService = true;
    void loadDeliveryService();
    window.addEventListener("focus", () => void loadDeliveryService());
  }
  return () => {
    serviceListeners.delete(onChange);
  };
}

export function useDeliveryService() {
  return useSyncExternalStore(subscribeToService, () => deliveryService, () => null);
}

// Straight-line distance in km (the same sum as the database's private.km_between)
export function kmBetween(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const a =
    Math.sin(radians(to.latitude - from.latitude) / 2) ** 2 +
    Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(radians(to.longitude - from.longitude) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

// "Bengaluru", "Bangalore", "Bengaluru Urban", "Bangalore City"... (as the database's private.is_bengaluru)
export function isBengaluruCity(city: string) {
  return /^(bengaluru|bangalore)(urban|city)?$/.test(city.toLowerCase().replace(/[^a-z]/g, ""));
}

/*
  The same check as the database's private.check_delivery_address (it has the last word at Pay now,
  0054_one_time_orders_anywhere_in_bengaluru.sql). With a milk plan: the service areas only, and the hub's
  distance limit. One-time products only: a service area or any address in Bengaluru (its city).
*/
export function serviceProblemOf(
  address: { area: string; city: string; pin?: { latitude: number; longitude: number } | null },
  service: DeliveryService,
  hasPlan: boolean,
): ServiceProblem | null {
  const area = address.area.trim().toLowerCase();
  const isServiceArea = service.areas.some((served) => served.trim().toLowerCase() === area);
  if (hasPlan && !isServiceArea) return "area";
  if (!hasPlan && !isServiceArea && !isBengaluruCity(address.city)) return "city";
  if (!address.pin) return "pin";
  if (hasPlan && service.hub && service.limitKm !== null && kmBetween(service.hub, address.pin) > service.limitKm) return "far";
  return null;
}

/*
  Saves the hub's exact spot (or null to keep the saved one) and the distance limit. The database checks who
  is asking. Answers a problem to show, or null.
*/
export async function saveDeliveryHub(spot: { latitude: number; longitude: number } | null, limitKm: number | null) {
  const { error } = await createClient().rpc("set_delivery_hub", {
    p_latitude: spot?.latitude ?? null,
    p_longitude: spot?.longitude ?? null,
    p_limit_km: limitKm,
  });
  await loadDeliveryService();
  if (error) {
    console.error("The database did not accept the hub", error);
    return error.message || "Couldn't save the hub. Please try again.";
  }
  return null;
}
