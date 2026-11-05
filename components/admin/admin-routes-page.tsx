"use client";

import { useMemo, useState } from "react";
import {
  getDeliveriesForRange,
  addAgentStopsToRoute,
  resolveAgentRequest,
  useAgentRequestsToday,
  moveRouteToAgent,
  toDateKey,
  useTodayDeliveries,
  type Delivery,
  type DeliveryStatus,
} from "@/store/admin-deliveries-store";
import {
  addRoute,
  saveDeliveryHub,
  updateRoutes,
  reloadDeliveryAgents,
  useDeliveryAgents,
  useDeliveryRoutes,
  useDeliveryService,
  type DeliveryAgent,
  type DeliveryRoute,
} from "@/store/admin-routes-store";
import { useStaffList } from "@/store/admin-staff-store";
import { giveTeamRole, useCurrentStaffAccess } from "@/store/staff-access-store";
import BengaluruAreaPicker, { OTHER_AREA } from "@/components/area-picker/bengaluru-area-picker";
import { AdminFeatureGate } from "./admin-panel-layout";
import {
  AdminDialog,
  AdminDialogField,
  AdminPageTop,
  AdminStatCards,
  adminInputClassName,
  downloadCsv,
  toDateFileName,
  useAdminToast,
} from "./admin-shared";
import dashboardStyles from "./admin-dashboard.module.css";
import sharedStyles from "./admin-shared.module.css";
import styles from "./admin-routes-page.module.css";

/*
  Routes & agents (/admin/routes), from the design 11-routes-agents: who delivers where, and how far
  along they are.
    top        search (route, area or agent), New route (pop-up form), Custom range, Export
    numbers    routes (stops), agents on duty (who is on leave), average stops per agent, on-time
               delivery (delivered before 8 AM)
    left       route map: the farm hub and each route's stops in its colour; routes table with progress;
               "Edit routes" changes each route's area and agent (stops not yet delivered move with it);
               clicking a route (its row, or its line on the map) opens its overview: the agent, the counts
               and every order on it, for the dates chosen at the top
    right      delivery agents: route and bike, status, call button, stops done; "Add agent"
  Routes and agents come from store/admin-routes-store.ts and deliveries from
  store/admin-deliveries-store.ts, so the Deliveries page shows the same routes, colours and agents.
*/

type AgentStatus = "On route" | "Finished" | "Not started" | "Free" | "On leave";

const AGENT_STATUS_CLASS_NAMES: Record<AgentStatus, string> = {
  "On route": dashboardStyles["admin-status-out-for-delivery"],
  Finished: dashboardStyles["admin-status-delivered"],
  "Not started": sharedStyles["admin-priority-low"],
  Free: dashboardStyles["admin-status-pending"],
  "On leave": sharedStyles["admin-status-cancelled"],
};

const firstName = (fullName: string) => fullName.split(" ")[0];
const initialsOf = (fullName: string) =>
  fullName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

// Route map: each of the first six routes heads off in its own direction from the hub (as in the design);
// routes added later get a straight line into a direction still free on the map
const HUB = { x: 170, y: 112 };
// The map is wider than the routes (about 90 on each side), so it fills the card without being too tall
const MAP_LEFT = -90;
const MAP_WIDTH = 520;
const ROUTE_SHAPES: [number, number][][] = [
  [[124, 74], [78, 48], [30, 26]],
  [[218, 70], [266, 44], [312, 22]],
  [[238, 122], [290, 136], [318, 176]],
  [[180, 168], [142, 196], [96, 204]],
  [[110, 128], [56, 118], [22, 162]],
  [[196, 60], [164, 34], [168, 14]],
];

function routeShape(index: number): [number, number][] {
  if (ROUTE_SHAPES[index]) return ROUTE_SHAPES[index];
  const freeDirections = [55, 145, -110, -5, 195, 30, -60, 120];
  const extra = index - ROUTE_SHAPES.length;
  const angle = ((freeDirections[extra % freeDirections.length] + Math.floor(extra / freeDirections.length) * 12) * Math.PI) / 180;
  return [1, 2, 3].map((step) => [HUB.x + Math.cos(angle) * 62 * step, HUB.y + Math.sin(angle) * 30 * step]);
}

const EMPTY_NEW_AGENT = { phone: "", bike: "" };

const DELIVERY_STATUS_CLASS_NAMES: Record<DeliveryStatus, string> = {
  Delivered: dashboardStyles["admin-status-delivered"],
  "Out for delivery": dashboardStyles["admin-status-out-for-delivery"],
  Pending: dashboardStyles["admin-status-pending"],
  Missed: sharedStyles["admin-status-warning"],
};

/*
  A route's overview: its agent (name, number, bike, on leave), the counts, and every order on it for the
  chosen dates. An order shows its own agent: it can differ from the route's (a stop handed to someone else).
*/
function RouteOverview({
  route,
  stops,
  agent,
  datesLabel,
  onClose,
}: {
  route: DeliveryRoute;
  stops: Delivery[];
  agent?: DeliveryAgent;
  datesLabel: string;
  onClose: () => void;
}) {
  const countOf = (...statuses: DeliveryStatus[]) => stops.filter((stop) => statuses.includes(stop.status)).length;
  const counts = [
    { label: "Orders", value: stops.length },
    { label: "Delivered", value: countOf("Delivered") },
    { label: "Still to go", value: countOf("Pending", "Out for delivery") },
    { label: "Missed", value: countOf("Missed") },
  ];
  return (
    <AdminDialog title={`${route.name} · ${route.area}`} submitLabel="Close route overview" onClose={onClose} onSubmit={onClose} isLarge hasOnlyCloseButton>
      <section className={styles["admin-route-overview-agent"]} aria-label="Delivery agent">
        <h3 className={styles["admin-route-overview-title"]}>Delivery agent</h3>
        {route.agent ? (
          <p className={styles["admin-route-overview-agent-line"]}>
            <strong>{route.agent}</strong>
            {agent?.phone && <a href={`tel:+91${agent.phone}`}>+91 {agent.phone}</a>}
            {agent?.bike && agent.bike !== "—" && <span>{agent.bike}</span>}
            {agent?.isOnLeave && <span className={`${dashboardStyles["admin-status"]} ${AGENT_STATUS_CLASS_NAMES["On leave"]}`}>On leave</span>}
          </p>
        ) : (
          <p className={styles["admin-route-overview-agent-line"]}>Not assigned. Choose one in Edit routes.</p>
        )}
      </section>

      <div className={styles["admin-route-overview-counts"]}>
        {counts.map((count) => (
          <p key={count.label} className={styles["admin-route-overview-count"]}>
            <strong>{count.value.toLocaleString("en-IN")}</strong>
            {count.label}
          </p>
        ))}
      </div>

      <h3 className={styles["admin-route-overview-title"]}>Orders · {datesLabel}</h3>
      {stops.length === 0 ? (
        <p className={styles["admin-route-overview-empty"]}>No orders on this route {datesLabel.toLowerCase()}.</p>
      ) : (
        <div className={dashboardStyles["admin-table-scroll"]}>
          <table className={dashboardStyles["admin-orders-table"]}>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Customer</th>
                <th scope="col">Items</th>
                <th scope="col">Slot</th>
                <th scope="col">Agent</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {stops.map((stop) => (
                <tr key={stop.id}>
                  <td>
                    {stop.orderNumber ?? stop.id}
                    {stop.isSubscription && <span className={dashboardStyles["admin-orders-area"]}>Subscription</span>}
                  </td>
                  <td>
                    {stop.customerName}
                    <span className={dashboardStyles["admin-orders-area"]}>{stop.address}</span>
                  </td>
                  <td className={dashboardStyles["admin-orders-muted"]}>
                    {stop.items?.length ? stop.items.map((item) => `${item.name} ${item.packSize} × ${item.quantity}`.replace("  ", " ")).join(", ") : "—"}
                  </td>
                  <td className={dashboardStyles["admin-orders-muted"]}>{stop.slot}</td>
                  <td>{stop.agent ? firstName(stop.agent) : "—"}</td>
                  <td>
                    <span className={`${dashboardStyles["admin-status"]} ${DELIVERY_STATUS_CLASS_NAMES[stop.status]}`}>{stop.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminDialog>
  );
}

// Further than this from the spot (the phone's own estimate): not saved, so the hub is always exact
const ROUGH_HUB_METRES = 50;

/*
  The primary hub (the pick-up point): its exact spot, from the phone of someone standing there, and how far
  from it Chiranvi delivers. Customers further than that are told to contact the farm.
*/
function PrimaryHubCard({ canEdit, showToast }: { canEdit: boolean; showToast: (message: string) => void }) {
  const service = useDeliveryService();
  const [limitText, setLimitText] = useState<string | null>(null);
  const [isFinding, setIsFinding] = useState(false);
  const [problem, setProblem] = useState("");
  const shownLimit = limitText ?? (service?.limitKm ? String(service.limitKm) : "");
  const limitKm = shownLimit ? Number(shownLimit) : null;

  async function save(spot: { latitude: number; longitude: number } | null) {
    const saveProblem = await saveDeliveryHub(spot, limitKm);
    setProblem(saveProblem ?? "");
    if (saveProblem) return;
    setLimitText(null);
    showToast(spot ? "Hub location saved" : "Distance limit saved");
  }

  function saveThisSpot() {
    if (!("geolocation" in navigator)) {
      setProblem("This device can't share its location.");
      return;
    }
    setProblem("");
    setIsFinding(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsFinding(false);
        if (position.coords.accuracy > ROUGH_HUB_METRES) {
          setProblem(`Not exact enough (about ${Math.round(position.coords.accuracy)} m). Use a phone at the hub, in the open, and try again.`);
          return;
        }
        void save({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      },
      (failure) => {
        setIsFinding(false);
        setProblem(
          failure.code === failure.PERMISSION_DENIED
            ? "Location is blocked. Allow location for this website in your settings."
            : "Couldn't find your location. Try again in the open.",
        );
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  return (
    <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-primary-hub-heading">
      <h2 id="admin-primary-hub-heading" className={dashboardStyles["admin-card-title"]}>
        Primary hub
      </h2>
      <p className={dashboardStyles["admin-card-subtitle"]}>
        {service?.hub ? `${service.hub.name} · location saved` : "Chiranvi Farm · location not saved yet"}
      </p>
      {canEdit && (
        <div className={styles["admin-hub-controls"]}>
          <button type="button" className={styles["admin-routes-text-button"]} disabled={isFinding} onClick={saveThisSpot}>
            {isFinding ? "Finding your location…" : service?.hub ? "Update to my current location" : "Use my current location"}
          </button>
          <label className={styles["admin-hub-limit"]}>
            Deliver within (km)
            <input
              className={adminInputClassName}
              inputMode="numeric"
              placeholder="Not set"
              value={shownLimit}
              onChange={(changeEvent) => setLimitText(changeEvent.target.value.replace(/\D/g, "").slice(0, 3))}
            />
          </label>
          <button type="button" className={styles["admin-routes-text-button"]} onClick={() => void save(null)}>
            Save limit
          </button>
        </div>
      )}
      <p className={styles["admin-hub-note"]}>
        Stand at the hub with a phone and tap the button. The distance limit only works once the location is saved.
      </p>
      {problem && (
        <p className={styles["admin-hub-problem"]} role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}

export default function AdminRoutesPage() {
  return (
    <AdminFeatureGate feature="routes">
      <RoutesPage />
    </AdminFeatureGate>
  );
}

function RoutesPage() {
  const access = useCurrentStaffAccess();
  const agentRequests = useAgentRequestsToday();
  const canResolveRequests = Boolean(access?.can("deliveries", "edit"));
  // The owner or a manager makes someone an agent (from the staff list; not managers or the owner)
  const canGiveRoles = Boolean(access?.isOwner || access?.roleId === "manager");
  const staffToMakeAgents = useStaffList().filter((person) => person.roleId === null || person.roleId === "staff");
  const todaysDeliveries = useTodayDeliveries();
  const savedRoutes = useDeliveryRoutes();
  // Route 1, Route 2 … (by their number: the list comes newest first)
  const routes = useMemo(
    () => [...savedRoutes].sort((first, second) => (Number(first.id.slice(1)) || 0) - (Number(second.id.slice(1)) || 0)),
    [savedRoutes],
  );
  const agents = useDeliveryAgents();
  const [today] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState(today);
  const [rangeTo, setRangeTo] = useState(today);
  const [searchText, setSearchText] = useState("");
  const [highlightedRoute, setHighlightedRoute] = useState<string | null>(null);
  // The route whose overview is open
  const [openRouteId, setOpenRouteId] = useState<string | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [routeEdits, setRouteEdits] = useState<{ id: string; area: string; agent: string }[]>([]);
  const [isNewRouteOpen, setIsNewRouteOpen] = useState(false);
  const [newRoute, setNewRoute] = useState({ area: "", otherArea: "", agent: "" });
  const [isNewAgentOpen, setIsNewAgentOpen] = useState(false);
  const [newAgent, setNewAgent] = useState(EMPTY_NEW_AGENT);
  const { showToast, toast } = useAdminToast();

  const isOnlyToday = toDateKey(rangeFrom) === toDateKey(today) && toDateKey(rangeTo) === toDateKey(today);
  const inRange = useMemo(
    () => getDeliveriesForRange(rangeFrom, rangeTo, todaysDeliveries),
    [rangeFrom, rangeTo, todaysDeliveries],
  );
  const words = searchText.trim().toLowerCase();

  const onDuty = agents.filter((agent) => !agent.isOnLeave);
  const onLeave = agents.filter((agent) => agent.isOnLeave);
  const delivered = inRange.filter((delivery) => delivery.status === "Delivered");
  // On time: delivered before 8 AM
  const onTime = delivered.filter((delivery) => delivery.deliveredAt && new Date(delivery.deliveredAt).getHours() < 8).length;

  const routeRows = routes.map((route, index) => {
    const stops = inRange.filter((delivery) => delivery.routeId === route.id);
    const done = stops.filter((delivery) => delivery.status === "Delivered").length;
    return { route, index, stops: stops.length, done, percent: stops.length ? Math.round((done / stops.length) * 100) : 0 };
  });
  const openRoute = routes.find((route) => route.id === openRouteId);
  const shownRouteRows = routeRows.filter(
    ({ route }) => !words || `${route.id} ${route.name} ${route.area} ${route.agent}`.toLowerCase().includes(words),
  );

  const agentRows = agents.map((agent) => {
    const stops = inRange.filter((delivery) => delivery.agent === agent.name);
    const done = stops.filter((delivery) => delivery.status === "Delivered").length;
    const missed = stops.filter((delivery) => delivery.status === "Missed").length;
    const ownRoutes = routes.filter((route) => route.agent === agent.name);
    // Other routes they have stops on: still to deliver (helping, e.g. reassigned) or already delivered
    const otherRoutes = (onlyUndelivered: boolean) =>
      [
        ...new Set(
          stops
            .filter((delivery) => !onlyUndelivered || delivery.status === "Pending" || delivery.status === "Out for delivery")
            .map((delivery) => delivery.routeId),
        ),
      ]
        .filter((routeId) => routeId && !ownRoutes.some((route) => route.id === routeId))
        .map((routeId) => routes.find((route) => route.id === routeId)?.name ?? routeId)
        .join(", ");
    const helpingRoutes = otherRoutes(true);
    const earlierRoutes = otherRoutes(false);
    const status: AgentStatus = agent.isOnLeave
      ? "On leave"
      : stops.length === 0
        ? "Free"
        : done + missed === stops.length
          ? "Finished"
          : done > 0 || stops.some((delivery) => delivery.status === "Out for delivery")
            ? "On route"
            : "Not started";
    const routeText = ownRoutes.length
      ? ownRoutes.map((route) => route.name).join(", ")
      : helpingRoutes
        ? `Helping ${helpingRoutes}`
        : earlierRoutes
          ? `Delivered on ${earlierRoutes}`
          : agent.isOnLeave
          ? "On leave today"
          : "Spare";
    return { agent, stops: stops.length, done, status, routeText };
  });
  const shownAgentRows = agentRows.filter(
    ({ agent, routeText }) => !words || `${agent.name} ${agent.bike} ${routeText}`.toLowerCase().includes(words),
  );

  function openEditRoutes() {
    setRouteEdits(routes.map((route) => ({ id: route.id, area: route.area, agent: route.agent })));
    setIsEditOpen(true);
  }

  function saveEditRoutes() {
    if (routeEdits.some((edit) => !edit.area.trim())) {
      showToast("Every route needs an area");
      return;
    }
    const changedAgents = routeEdits.filter((edit) => routes.find((route) => route.id === edit.id)?.agent !== edit.agent);
    updateRoutes(routeEdits.map((edit) => ({ ...edit, area: edit.area.trim() })));
    changedAgents.forEach((edit) => moveRouteToAgent(edit.id, edit.agent));
    setIsEditOpen(false);
    showToast(
      changedAgents.length
        ? `Routes saved · ${changedAgents.map((edit) => `${edit.id} to ${firstName(edit.agent)}`).join(", ")}`
        : "Routes saved",
    );
  }

  function saveNewRoute() {
    // "Others": the area as typed
    const area = (newRoute.area === OTHER_AREA ? newRoute.otherArea : newRoute.area).trim();
    if (!area || !newRoute.agent) {
      showToast("Choose the area and an agent");
      return;
    }
    const added = addRoute(area, newRoute.agent);
    addAgentStopsToRoute(newRoute.agent, added.id);
    setIsNewRouteOpen(false);
    setNewRoute({ area: "", otherArea: "", agent: "" });
    showToast(`${added.name} · ${added.area} added for ${firstName(added.agent)}`);
  }

  async function markRequestResolved(dayId: string, requestId: string, kind: string) {
    const problem = await resolveAgentRequest(dayId, requestId);
    showToast(problem ?? `${kind}: marked resolved`);
  }

  // The person gets the Delivery agent role (shown on Roles & permissions), and with it their agent card
  async function saveNewAgent() {
    const person = staffToMakeAgents.find((candidate) => candidate.phone === newAgent.phone);
    if (!person) {
      showToast("Choose a person from the staff list");
      return;
    }
    const problem = await giveTeamRole(person.phone, "delivery-agent", newAgent.bike);
    if (problem) {
      showToast(problem);
      return;
    }
    void reloadDeliveryAgents();
    setIsNewAgentOpen(false);
    setNewAgent(EMPTY_NEW_AGENT);
    showToast(`${person.name} is now a delivery agent`);
  }

  function exportRoutes() {
    downloadCsv(`chiranvi-routes-agents-${toDateFileName(rangeFrom)}${isOnlyToday ? "" : `-to-${toDateFileName(rangeTo)}`}.csv`, [
      ["Route", "Area", "Agent", "Stops", "Delivered", "Progress (%)"],
      ...routeRows.map(({ route, stops, done, percent }) => [route.name, route.area, route.agent, stops, done, percent]),
      [],
      ["Agent", "Phone", "Bike", "Route", "Status", "Stops", "Delivered"],
      ...agentRows.map(({ agent, routeText, status, stops, done }) => [agent.name, agent.phone, agent.bike, routeText, status, stops, done]),
    ]);
  }

  return (
    <div className={dashboardStyles["admin-dashboard"]}>
      <AdminPageTop
        title="Routes & agents"
        description="Who delivers where, and how far along they are"
        searchText={searchText}
        onSearchTextChange={setSearchText}
        searchPlaceholder="Search route, area or agent..."
        actionLabel="New route"
        onAction={() => {
          setNewRoute({ area: "", otherArea: "", agent: onDuty.find((agent) => !routes.some((route) => route.agent === agent.name))?.name ?? onDuty[0]?.name ?? "" });
          setIsNewRouteOpen(true);
        }}
        today={today}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        onRangeChange={(from, to) => {
          setRangeFrom(from);
          setRangeTo(to);
        }}
        onExport={exportRoutes}
      />

      <AdminStatCards
        stats={[
          {
            label: "Routes",
            value: String(routes.length),
            note: `${inRange.length.toLocaleString("en-IN")} stops ${isOnlyToday ? "today" : "in these dates"}`,
            trend: "plain",
            icon: ["M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6Z", "M9 4v14", "M15 6v14"],
          },
          {
            label: "Agents on duty",
            value: `${onDuty.length} / ${agents.length}`,
            note: onLeave.length ? `${onLeave.length} on leave (${onLeave.map((agent) => agent.name).join(", ")})` : "Everyone on duty",
            trend: "plain",
            icon: ["M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z", "M3 20a6 6 0 0 1 12 0", "M16 4.5a3.5 3.5 0 0 1 0 6.5", "M18 14.5a6 6 0 0 1 3 5.5"],
          },
          {
            label: "Avg stops per agent",
            value: onDuty.length ? String(Math.floor(inRange.length / onDuty.length)) : "0",
            note: `Across ${onDuty.length} agents on duty`,
            trend: "plain",
            icon: ["M2.5 6.5h11v9.5h-11z", "M13.5 9.5h4l3.5 3.5v3h-7.5", "M6.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"],
          },
          {
            label: "On-time delivery",
            value: `${delivered.length ? ((onTime / delivered.length) * 100).toFixed(1) : "0"}%`,
            note: "Before 8 AM",
            trend: "up",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7.5V12l3 2"],
          },
        ]}
      />

      <div className={styles["admin-routes-columns"]}>
        <div className={styles["admin-routes-left-column"]}>
          <PrimaryHubCard canEdit={Boolean(access?.can("routes", "edit"))} showToast={showToast} />
          <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-route-map-heading">
            <h2 id="admin-route-map-heading" className={dashboardStyles["admin-card-title"]}>
              Route map
            </h2>
            <p className={dashboardStyles["admin-card-subtitle"]}>
              Farm hub → {routes.length} delivery routes
            </p>
            <RouteMap routes={routes} highlightedRoute={highlightedRoute} onHighlight={setHighlightedRoute} onOpenRoute={setOpenRouteId} />
          </section>

          <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-routes-heading">
            <div className={dashboardStyles["admin-card-heading-row"]}>
              <h2 id="admin-routes-heading" className={dashboardStyles["admin-card-title"]}>
                Routes
              </h2>
              <button type="button" className={styles["admin-routes-text-button"]} onClick={openEditRoutes}>
                Edit routes →
              </button>
            </div>
            <div className={dashboardStyles["admin-table-scroll"]}>
              <table className={dashboardStyles["admin-orders-table"]}>
                <thead>
                  <tr>
                    <th scope="col">Route</th>
                    <th scope="col">Area</th>
                    <th scope="col">Stops</th>
                    <th scope="col">Agent</th>
                    <th scope="col">Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {shownRouteRows.map(({ route, stops, percent }) => (
                    <tr
                      key={route.id}
                      className={`${styles["admin-route-row"]} ${highlightedRoute === route.id ? styles["admin-route-row-highlighted"] : ""}`}
                      onMouseEnter={() => setHighlightedRoute(route.id)}
                      onMouseLeave={() => setHighlightedRoute(null)}
                      onClick={() => setOpenRouteId(route.id)}
                    >
                      <td>
                        <span className={styles["admin-route-name-cell"]}>
                          <span className={styles["admin-route-dot"]} style={{ background: route.colour }} aria-hidden="true" />
                          {/* The keyboard's way in: the whole row opens it for a mouse */}
                          <button type="button" className={styles["admin-route-open-button"]} aria-label={`Open the overview of ${route.name}`}>
                            {route.name}
                          </button>
                        </span>
                      </td>
                      <td className={dashboardStyles["admin-orders-muted"]}>{route.area}</td>
                      <td>{stops ? stops.toLocaleString("en-IN") : "—"}</td>
                      <td>{route.agent ? firstName(route.agent) : "Not assigned"}</td>
                      <td>
                        <span className={styles["admin-route-progress-cell"]}>
                          <span className={styles["admin-route-progress-bar"]} aria-hidden="true">
                            <span style={{ width: `${percent}%` }} />
                          </span>
                          <span className={styles["admin-route-percent"]}>{stops ? `${percent}%` : "—"}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                  {shownRouteRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className={dashboardStyles["admin-orders-empty"]}>
                        No routes match this search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className={styles["admin-routes-left-column"]}>
          <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-agents-heading">
            <div className={dashboardStyles["admin-card-heading-row"]}>
              <div>
                <h2 id="admin-agents-heading" className={dashboardStyles["admin-card-title"]}>
                  Delivery agents
                </h2>
                <p className={dashboardStyles["admin-card-subtitle"]}>
                  {onDuty.length} on duty {isOnlyToday ? "today" : ""}
                </p>
              </div>
              {canGiveRoles && (
                <button type="button" className={styles["admin-routes-text-button"]} onClick={() => setIsNewAgentOpen(true)}>
                  + Add agent
                </button>
              )}
            </div>

            <ul className={styles["admin-agent-list"]}>
              {shownAgentRows.map(({ agent, stops, done, status, routeText }, index) => (
                <li key={agent.name} className={styles["admin-agent-row"]}>
                  <span className={`${sharedStyles["admin-initials"]} ${index % 2 ? sharedStyles["admin-initials-yellow"] : ""}`} aria-hidden="true">
                    {initialsOf(agent.name)}
                  </span>
                  <div className={styles["admin-agent-details"]}>
                    <div className={styles["admin-agent-top-row"]}>
                      <span>
                        <span className={styles["admin-agent-name"]}>{agent.name}</span>
                        <span className={styles["admin-agent-route"]}>
                          {routeText} · Bike {agent.bike}
                        </span>
                      </span>
                      <span className={`${dashboardStyles["admin-status"]} ${AGENT_STATUS_CLASS_NAMES[status]}`}>{status}</span>
                      <a
                        href={`tel:+91${agent.phone}`}
                        className={styles["admin-agent-call"]}
                        aria-label={`Call ${agent.name}`}
                        title={`Call ${agent.phone.replace(/(\d{5})(\d{5})/, "$1 $2")}`}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2Z" />
                        </svg>
                      </a>
                    </div>
                    {stops > 0 && (
                      <div className={styles["admin-agent-progress-row"]}>
                        <span className={styles["admin-agent-progress-bar"]} aria-hidden="true">
                          <span style={{ width: `${(done / stops) * 100}%` }} />
                        </span>
                        <span className={styles["admin-agent-stops"]}>
                          {done.toLocaleString("en-IN")} / {stops.toLocaleString("en-IN")} stops
                        </span>
                      </div>
                    )}
                  </div>
                </li>
              ))}
              {shownAgentRows.length === 0 && <li className={styles["admin-agent-empty"]}>No agents match this search.</li>}
            </ul>
          </section>

          {/* What the agents asked the manager for today (Delivery Panel → Raise a request) */}
          <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-agent-requests-heading">
            <h2 id="admin-agent-requests-heading" className={dashboardStyles["admin-card-title"]}>
              Agent requests
            </h2>
            <p className={dashboardStyles["admin-card-subtitle"]}>
              {agentRequests.filter((request) => request.status === "Pending").length} waiting today
            </p>
            {agentRequests.length === 0 ? (
              <p className={styles["admin-agent-empty"]}>No requests from agents today.</p>
            ) : (
              <ul className={styles["admin-agent-request-list"]}>
                {agentRequests.map((request) => (
                  <li key={request.id} className={styles["admin-agent-request"]}>
                    <div className={styles["admin-agent-request-top-row"]}>
                      <span className={styles["admin-agent-request-kind"]}>{request.kind}</span>
                      <span
                        className={`${styles["admin-agent-request-status"]} ${request.status === "Resolved" ? styles["admin-agent-request-status-resolved"] : ""}`}
                      >
                        {request.status === "Resolved" ? "Resolved" : "Waiting"}
                      </span>
                    </div>
                    <p className={styles["admin-agent-request-detail"]}>
                      {agents.find((agent) => agent.phone === request.agentMobile)?.name ?? request.agentMobile} · {request.customerName} ·{" "}
                      {new Date(request.raisedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                    </p>
                    {request.note && <p className={styles["admin-agent-request-note"]}>{request.note}</p>}
                    {canResolveRequests && request.status === "Pending" && (
                      <button
                        type="button"
                        className={styles["admin-agent-request-resolve"]}
                        onClick={() => void markRequestResolved(request.dayId, request.id, request.kind)}
                      >
                        Mark resolved
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {openRoute && (
        <RouteOverview
          route={openRoute}
          stops={inRange.filter((delivery) => delivery.routeId === openRoute.id)}
          agent={agents.find((agent) => agent.name === openRoute.agent)}
          datesLabel={isOnlyToday ? "Today" : "In these dates"}
          onClose={() => setOpenRouteId(null)}
        />
      )}

      {isEditOpen && (
        <AdminDialog title="Edit routes" submitLabel="Save routes" onClose={() => setIsEditOpen(false)} onSubmit={saveEditRoutes}>
          <p className={styles["admin-routes-dialog-note"]}>
            Change a route&rsquo;s area or agent. Stops not yet delivered today move to the new agent.
          </p>
          {routeEdits.map((edit, editIndex) => {
            const route = routes.find((existing) => existing.id === edit.id) as DeliveryRoute;
            const changeEdit = (changes: Partial<typeof edit>) =>
              setRouteEdits(routeEdits.map((existing, index) => (index === editIndex ? { ...existing, ...changes } : existing)));
            return (
              <div key={edit.id} className={styles["admin-routes-edit-row"]}>
                <span className={styles["admin-route-name-cell"]}>
                  <span className={styles["admin-route-dot"]} style={{ background: route.colour }} aria-hidden="true" />
                  {route.name}
                </span>
                <input
                  className={adminInputClassName}
                  aria-label={`${route.name} area`}
                  value={edit.area}
                  onChange={(changeEvent) => changeEdit({ area: changeEvent.target.value })}
                />
                <select
                  className={adminInputClassName}
                  aria-label={`${route.name} agent`}
                  value={edit.agent}
                  onChange={(changeEvent) => changeEdit({ agent: changeEvent.target.value })}
                >
                  <option value="">Not assigned</option>
                  {onDuty.map((agent) => (
                    <option key={agent.name} value={agent.name}>
                      {agent.name}
                    </option>
                  ))}
                  {edit.agent && !onDuty.some((agent) => agent.name === edit.agent) && <option value={edit.agent}>{edit.agent} (on leave)</option>}
                </select>
              </div>
            );
          })}
        </AdminDialog>
      )}

      {isNewRouteOpen && (
        <AdminDialog title="New route" submitLabel="Add route" onClose={() => setIsNewRouteOpen(false)} onSubmit={saveNewRoute}>
          <div className={sharedStyles["admin-dialog-field"]}>
            <span id="admin-new-route-area-label" className={sharedStyles["admin-dialog-label"]}>
              Area
            </span>
            <BengaluruAreaPicker
              area={newRoute.area}
              onChoose={(chosenArea) => setNewRoute({ ...newRoute, area: chosenArea })}
              labelId="admin-new-route-area-label"
              look="admin"
            />
          </div>
          <AdminDialogField label="Agent">
            <select
              className={adminInputClassName}
              value={newRoute.agent}
              onChange={(changeEvent) => setNewRoute({ ...newRoute, agent: changeEvent.target.value })}
            >
              {onDuty.map((agent) => (
                <option key={agent.name} value={agent.name}>
                  {agent.name}
                  {routes.some((route) => route.agent === agent.name) ? "" : " (spare)"}
                </option>
              ))}
            </select>
          </AdminDialogField>
          {newRoute.area === OTHER_AREA && (
            <AdminDialogField label="Area name" isWide>
              <input
                className={adminInputClassName}
                placeholder="Area or landmark"
                value={newRoute.otherArea}
                onChange={(changeEvent) => setNewRoute({ ...newRoute, otherArea: changeEvent.target.value })}
                autoFocus
              />
            </AdminDialogField>
          )}
          <p className={styles["admin-routes-dialog-note"]}>
            It is called Route {Math.max(0, ...routes.map((route) => Number(route.id.slice(1)))) + 1} and shows on the map and on the
            Deliveries page, ready for new deliveries.
          </p>
        </AdminDialog>
      )}

      {isNewAgentOpen && (
        <AdminDialog title="Add agent" submitLabel="Add agent" onClose={() => setIsNewAgentOpen(false)} onSubmit={saveNewAgent}>
          <AdminDialogField label="Person" isWide>
            <select
              className={adminInputClassName}
              value={newAgent.phone}
              autoFocus
              onChange={(changeEvent) => setNewAgent({ ...newAgent, phone: changeEvent.target.value })}
            >
              <option value="">{staffToMakeAgents.length > 0 ? "Choose from the staff list" : "No one to add: add them in the Staff section first"}</option>
              {staffToMakeAgents.map((person) => (
                <option key={person.phone} value={person.phone}>
                  {person.name} · {person.phone.slice(0, 5)} {person.phone.slice(5)}
                </option>
              ))}
            </select>
          </AdminDialogField>
          <AdminDialogField label="Bike number" isWide>
            <input
              className={adminInputClassName}
              placeholder="KA-05-4410"
              value={newAgent.bike}
              onChange={(changeEvent) => setNewAgent({ ...newAgent, bike: changeEvent.target.value })}
            />
          </AdminDialogField>
          <p className={styles["admin-routes-dialog-note"]}>
            They get the Delivery agent role and log in with their own number. New agents start as spare: give them a route with
            Edit routes, or orders from the Orders page.
          </p>
        </AdminDialog>
      )}

      {toast}
    </div>
  );
}

/*
  The route map: a light street grid, the farm hub in the middle and each route's stops joined by a line
  in its colour, with its tag (R1, R2, ...) at the far end. Hovering a route (or its table row) brings it
  forward and fades the others. The Delivery Panel's Up next page shows this same map with only the agent's own
  routes (shownRouteIds), each in the same place as here.
*/
export function RouteMap({
  routes,
  highlightedRoute,
  onHighlight,
  shownRouteIds,
  onOpenRoute,
  fillsBox = false,
}: {
  routes: DeliveryRoute[];
  highlightedRoute: string | null;
  onHighlight: (routeId: string | null) => void;
  shownRouteIds?: string[];
  onOpenRoute?: (routeId: string) => void; // clicking a route's line (the panel only)
  fillsBox?: boolean; // more streets above and below, and the map covers the box it is in (the Delivery Panel)
}) {
  const shownCount = shownRouteIds?.length ?? routes.length;
  const mapTop = fillsBox ? -108 : 0;
  const mapHeight = fillsBox ? 440 : 224;
  const blockRows = fillsBox ? [-2, -1, 0, 1, 2, 3, 4, 5] : [0, 1, 2, 3];
  return (
    <svg viewBox={`${MAP_LEFT} ${mapTop} ${MAP_WIDTH} ${mapHeight}`} preserveAspectRatio={fillsBox ? "xMidYMid slice" : undefined} className={styles["admin-route-map"]} role="img" aria-label={`Map of ${shownCount} routes from the farm hub`}>
      <rect x={MAP_LEFT} y={mapTop} width={MAP_WIDTH} height={mapHeight} rx="10" className={styles["admin-route-map-ground"]} />
      {/* Blocks between the streets */}
      {Array.from({ length: 9 }, (_, column) => column).map((column) =>
        blockRows.map((row) => (
          <rect
            key={`${column}-${row}`}
            x={MAP_LEFT + 8 + column * 56}
            y={8 + row * 54}
            width={48}
            height={46}
            rx="4"
            className={styles["admin-route-map-block"]}
          />
        )),
      )}

      {routes.map((route, index) => {
        if (shownRouteIds && !shownRouteIds.includes(route.id)) return null;
        // By its number (R4 is the fourth), so a route is in the same place on the panel and for its agent
        const shape = routeShape((Number(route.id.slice(1)) || index + 1) - 1);
        // A tall box has room for a longer line: the stops move out from the hub and stay on the map, their size stays the same
        const stops = fillsBox ? shape.map(([x, y]): [number, number] => [Math.min(MAP_LEFT + MAP_WIDTH - 14, Math.max(MAP_LEFT + 14, HUB.x + (x - HUB.x) * 1.6)), HUB.y + (y - HUB.y) * 1.6]) : shape;
        const points = [[HUB.x, HUB.y] as [number, number], ...stops];
        const [endX, endY] = points[points.length - 1];
        const isFaded = highlightedRoute !== null && highlightedRoute !== route.id;
        const tagTop = Math.min(mapTop + mapHeight - 16, Math.max(mapTop + 2, endY - 18));
        return (
          <g
            key={route.id}
            className={styles["admin-route-map-route"]}
            style={{ opacity: isFaded ? 0.25 : 1 }}
            onMouseEnter={() => onHighlight(route.id)}
            onMouseLeave={() => onHighlight(null)}
            onClick={() => onOpenRoute?.(route.id)}
          >
            <title>{`${route.name} · ${route.area} · ${route.agent || "Not assigned"}`}</title>
            <polyline
              points={points.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="none"
              stroke={route.colour}
              strokeWidth={highlightedRoute === route.id ? 4 : 2.6}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {points.slice(1).map(([x, y]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r="3.6" fill="#ffffff" stroke={route.colour} strokeWidth="2" />
            ))}
            <rect
              x={Math.min(MAP_LEFT + MAP_WIDTH - 24, Math.max(MAP_LEFT + 2, endX - 11))}
              y={tagTop}
              width="22"
              height="13"
              rx="3.5"
              fill={route.colour}
            />
            <text
              x={Math.min(MAP_LEFT + MAP_WIDTH - 24, Math.max(MAP_LEFT + 2, endX - 11)) + 11}
              y={tagTop + 9.6}
              textAnchor="middle"
              className={styles["admin-route-map-tag"]}
              fill={["#a3c98a", "#f5bf2c", "#e0a91f", "#d9b54a"].includes(route.colour) ? "#13251b" : "#ffffff"}
            >
              {route.id}
            </text>
          </g>
        );
      })}

      {/* Farm hub */}
      <circle cx={HUB.x} cy={HUB.y} r="13" fill="#13251b" stroke="#f5bf2c" strokeWidth="2" />
      <path
        d={`M${HUB.x - 5.5} ${HUB.y + 0.5} L${HUB.x} ${HUB.y - 5} L${HUB.x + 5.5} ${HUB.y + 0.5} M${HUB.x - 4} ${HUB.y - 0.8} V${HUB.y + 5} H${HUB.x + 4} V${HUB.y - 0.8}`}
        fill="none"
        stroke="#f5bf2c"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <rect x={HUB.x - 25} y={HUB.y + 17} width="50" height="14" rx="4" fill="#13251b" />
      <text x={HUB.x} y={HUB.y + 26.8} textAnchor="middle" className={styles["admin-route-map-hub-label"]}>
        Farm hub
      </text>
    </svg>
  );
}
