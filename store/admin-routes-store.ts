import { createPanelRecordStore } from "./panel-records";

/*
  Delivery routes and agents for the Chiranvi Panel (Routes & agents page, and the Deliveries page's
  route names, colours and agent lists). Kept in the database (panel_records, "routes" and "agents";
  supabase/migrations/0019_… and 0020_…), seen and changed by the staff member's role (Routes & agents).
  - Routes are added on Routes & agents; route colours are Chiranvi greens and yellows.
  - Agents: everyone with the Delivery agent role gets a card (supabase/migrations/0024_…).
  Each route and agent card carries its agent's number, so a delivery agent (Delivery Panel) reads only their
  own card and route.
*/

export type DeliveryRoute = {
  id: string; // "R1"
  name: string; // "Route 1"
  area: string;
  agent: string; // full name of the agent on this route
  colour: string;
};

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
    void routeStore.change(change.id, (existing) => ({ ...existing, area: change.area, agent: change.agent }),
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
