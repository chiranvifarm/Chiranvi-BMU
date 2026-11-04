"use client";

import { useEffect, useMemo, useState } from "react";
import { markPanelPageSeen } from "@/store/account-state";
import {
  DELIVERY_SLOTS,
  addDelivery,
  cancelDeliveryTransfer,
  getDeliveriesForRange,
  reassignMissed,
  setDeliveryStatus,
  toDateKey,
  useCarryOverOrderDeliveries,
  useDeliveriesUpdatedAt,
  useTodayDeliveries,
  type Delivery,
  type DeliverySlot,
  type DeliveryStatus,
} from "@/store/admin-deliveries-store";
import { useDeliveryAgents, useDeliveryRoutes, type DeliveryRoute } from "@/store/admin-routes-store";
import { AdminFeatureGate } from "./admin-panel-layout";
import {
  AdminDialog,
  AdminDialogField,
  AdminPageTop,
  AdminPagination,
  AdminRowMenu,
  AdminStatCards,
  adminInputClassName,
  downloadCsv,
  formatDateRange,
  toDateFileName,
  useAdminToast,
} from "./admin-shared";
import dashboardStyles from "./admin-dashboard.module.css";
import sharedStyles from "./admin-shared.module.css";
import styles from "./admin-deliveries-page.module.css";

/*
  Deliveries (/admin/deliveries), from the design 10-deliveries: live delivery status for today, by route
  and agent.
    top        search (customer, address, route or agent), Add delivery (pop-up form), Custom range, Export
    numbers    scheduled, delivered (% complete), pending (out for delivery), missed (red: serious);
               clicking Delivered, Pending or Missed shows only those (click again for all)
    table      today's deliveries, 14 a page; the phone calls the customer; "..." marks a delivery
    side card  route progress: delivered / total per route with its agent, done time or expected finish;
               "Reassign missed deliveries" gives the missed ones to another agent
  Route colours are Chiranvi greens and yellows. Earlier days (Custom range) can be looked at, not
  changed. Deliveries come from store/admin-deliveries-store.ts, routes and agents from
  store/admin-routes-store.ts (Routes & agents page); both saved in this browser for now.
*/

const PAGE_SIZE = 14;

const STATUS_CLASS_NAMES: Record<DeliveryStatus, string> = {
  Delivered: dashboardStyles["admin-status-delivered"],
  "Out for delivery": dashboardStyles["admin-status-out-for-delivery"],
  Pending: dashboardStyles["admin-status-pending"],
  Missed: sharedStyles["admin-status-warning"],
};

type StatusFilter = "delivered" | "pending" | "missed" | null;

const firstName = (fullName: string) => fullName.split(" ")[0];

// "7:41 AM"
function clockTime(date: Date) {
  return date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).toUpperCase();
}

function minutesAgo(isoDate: string, now: Date) {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(isoDate).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

const EMPTY_NEW_DELIVERY = {
  customerName: "",
  address: "",
  phone: "",
  routeId: "",
  slot: DELIVERY_SLOTS[1] as DeliverySlot,
};

export default function AdminDeliveriesPage() {
  return (
    <AdminFeatureGate feature="deliveries">
      <DeliveriesPage />
    </AdminFeatureGate>
  );
}

function DeliveriesPage() {
  const todaysDeliveries = useTodayDeliveries();
  const routes = useDeliveryRoutes();
  const agents = useDeliveryAgents();
  const agentsOnDuty = agents.filter((agent) => !agent.isOnLeave).map((agent) => agent.name);
  // Routes load from the database on their own, so a delivery can arrive before its route: show its id until
  // then ("—": a stop without a route)
  const routeOf = (routeId: string): DeliveryRoute =>
    routes.find((route) => route.id === routeId) ?? { id: routeId || "—", name: routeId || "No route", area: "", agent: "", colour: "#285C3A" };
  const updatedAt = useDeliveriesUpdatedAt();
  const [today] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState(today);
  const [rangeTo, setRangeTo] = useState(today);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null);
  const [page, setPage] = useState(1);
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [newDelivery, setNewDelivery] = useState(EMPTY_NEW_DELIVERY);
  const [isReassignOpen, setIsReassignOpen] = useState(false);
  const [chosenReassignTo, setReassignTo] = useState("");
  // The first agent on duty unless another was chosen
  const reassignTo = chosenReassignTo || agentsOnDuty[0] || "";
  const { showToast, toast } = useAdminToast();
  useCarryOverOrderDeliveries();

  // Opening this page counts as seeing the transfers between agents (the bell's list clears)
  useEffect(() => {
    markPanelPageSeen("delivery-transfers");
  }, []);

  const todayKey = toDateKey(today);
  const isOnlyToday = toDateKey(rangeFrom) === todayKey && toDateKey(rangeTo) === todayKey;

  const inRange = useMemo(
    () => getDeliveriesForRange(rangeFrom, rangeTo, todaysDeliveries),
    [rangeFrom, rangeTo, todaysDeliveries],
  );
  const words = searchText.trim().toLowerCase();
  const matching = useMemo(
    () =>
      words
        ? inRange.filter((delivery) => {
            const route = routeOf(delivery.routeId);
            return `${delivery.customerName} ${delivery.address} ${route.id} ${route.name} ${route.area} ${delivery.agent}`
              .toLowerCase()
              .includes(words);
          })
        : inRange,
    [inRange, words],
  );
  const shown = matching.filter((delivery) => {
    if (statusFilter === "delivered") return delivery.status === "Delivered";
    if (statusFilter === "pending") return delivery.status === "Pending" || delivery.status === "Out for delivery";
    if (statusFilter === "missed") return delivery.status === "Missed";
    return true;
  });
  const pageItems = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const delivered = inRange.filter((delivery) => delivery.status === "Delivered").length;
  const outForDelivery = inRange.filter((delivery) => delivery.status === "Out for delivery").length;
  const pending = inRange.filter((delivery) => delivery.status === "Pending").length + outForDelivery;
  const missed = inRange.filter((delivery) => delivery.status === "Missed");
  const missedRoutes = [...new Set(missed.map((delivery) => routeOf(delivery.routeId).name))];
  const missedToday = todaysDeliveries.filter((delivery) => delivery.status === "Missed").length;
  const activeRoutes = new Set(inRange.map((delivery) => delivery.routeId).filter(Boolean)).size;

  // Per route: how far along it is, who drives it, when it finished or is expected to
  const routeProgress = routes.map((route) => {
    const onRoute = inRange.filter((delivery) => delivery.routeId === route.id);
    const done = onRoute.filter((delivery) => delivery.status === "Delivered");
    const missedOnRoute = onRoute.filter((delivery) => delivery.status === "Missed").length;
    const left = onRoute.length - done.length - missedOnRoute;
    const lastDone = done.reduce((latest, delivery) => (delivery.deliveredAt && delivery.deliveredAt > latest ? delivery.deliveredAt : latest), "");
    const timing =
      left === 0
        ? lastDone
          ? `Done ${clockTime(new Date(lastDone))}`
          : "Done"
        : // About 4 minutes a stop from now
          `ETA ${clockTime(new Date(Math.max(today.getTime(), new Date(`${todayKey}T07:30:00`).getTime()) + left * 4 * 60000))}`;
    return { route, total: onRoute.length, done: done.length, timing, missedOnRoute };
  }).filter((progress) => progress.total > 0);

  function changeFilter(filter: Exclude<StatusFilter, null>) {
    setStatusFilter(statusFilter === filter ? null : filter);
    setPage(1);
  }

  function markDelivery(delivery: Delivery, status: DeliveryStatus) {
    setDeliveryStatus(delivery.id, status);
    showToast(`${delivery.customerName}: ${status.toLowerCase()}`);
  }

  function saveNewDelivery() {
    const phone = newDelivery.phone.replace(/\D/g, "");
    if (!newDelivery.customerName.trim() || !newDelivery.address.trim() || phone.length !== 10) {
      showToast("Enter the name, address and a 10-digit phone number");
      return;
    }
    // The first route unless another was chosen
    const routeId = newDelivery.routeId || routes[0]?.id;
    if (!routeId) {
      showToast("Add a route on Routes & agents first");
      return;
    }
    const added = addDelivery({
      ...newDelivery,
      routeId,
      customerName: newDelivery.customerName.trim(),
      address: newDelivery.address.trim(),
      phone,
      agent: routeOf(routeId).agent,
    });
    setRangeFrom(today);
    setRangeTo(today);
    setStatusFilter(null);
    setSearchText("");
    setPage(1);
    setIsNewOpen(false);
    setNewDelivery(EMPTY_NEW_DELIVERY);
    showToast(`Delivery for ${added.customerName} added to ${routeOf(added.routeId).name}`);
  }

  function saveReassign() {
    const count = reassignMissed(reassignTo);
    setIsReassignOpen(false);
    // Nothing is missed any more: show everything again
    if (statusFilter === "missed") setStatusFilter(null);
    showToast(`${count} missed ${count === 1 ? "delivery" : "deliveries"} given to ${reassignTo}`);
  }

  function exportDeliveries() {
    downloadCsv(`chiranvi-deliveries-${toDateFileName(rangeFrom)}${isOnlyToday ? "" : `-to-${toDateFileName(rangeTo)}`}.csv`, [
      ["Date", "Customer", "Address", "Phone", "Route", "Area", "Agent", "Slot", "Status", "Delivered at"],
      ...shown.map((delivery) => [
        delivery.date,
        delivery.customerName,
        delivery.address,
        delivery.phone,
        routeOf(delivery.routeId).name,
        routeOf(delivery.routeId).area,
        delivery.agent,
        delivery.slot,
        delivery.status,
        delivery.deliveredAt ? clockTime(new Date(delivery.deliveredAt)) : "",
      ]),
    ]);
  }

  return (
    <div className={dashboardStyles["admin-dashboard"]}>
      <AdminPageTop
        title="Deliveries"
        description="Live delivery status for today, by route and agent"
        searchText={searchText}
        onSearchTextChange={(text) => {
          setSearchText(text);
          setPage(1);
        }}
        searchPlaceholder="Search customer, route or agent..."
        actionLabel="Add delivery"
        onAction={() => setIsNewOpen(true)}
        today={today}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        onRangeChange={(from, to) => {
          setRangeFrom(from);
          setRangeTo(to);
          setPage(1);
        }}
        onExport={exportDeliveries}
      />

      <AdminStatCards
        stats={[
          {
            label: isOnlyToday ? "Scheduled today" : "Scheduled",
            value: inRange.length.toLocaleString("en-IN"),
            note: `${activeRoutes} routes · ${agents.length} agents`,
            trend: "plain",
            icon: ["M4 6h16v14H4z", "M4 10h16M8 3.5v4M16 3.5v4"],
          },
          {
            label: "Delivered",
            value: delivered.toLocaleString("en-IN"),
            note: `${inRange.length ? ((delivered / inRange.length) * 100).toFixed(1) : "0"}% complete`,
            trend: "up",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M8.5 12.2l2.4 2.4 4.8-4.8"],
            onClick: () => changeFilter("delivered"),
            isSelected: statusFilter === "delivered",
            clickLabel: "Show delivered",
          },
          {
            label: "Pending",
            value: pending.toLocaleString("en-IN"),
            note: `${outForDelivery} out for delivery`,
            trend: "plain",
            icon: ["M2.5 6.5h11v9.5h-11z", "M13.5 9.5h4l3.5 3.5v3h-7.5", "M6.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"],
            onClick: () => changeFilter("pending"),
            isSelected: statusFilter === "pending",
            clickLabel: "Show pending",
          },
          {
            label: "Missed",
            value: String(missed.length),
            note: missed.length ? `${missedRoutes.join(", ")}${isOnlyToday ? " · reassign" : ""}` : "None missed",
            trend: missed.length ? "bad" : "plain",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M9 9l6 6M15 9l-6 6"],
            onClick: () => changeFilter("missed"),
            isSelected: statusFilter === "missed",
            clickLabel: "Show missed",
          },
        ]}
      />

      <div className={styles["admin-deliveries-columns"]}>
        <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-deliveries-heading">
          <div className={dashboardStyles["admin-card-heading-row"]}>
            <div>
              <h2 id="admin-deliveries-heading" className={dashboardStyles["admin-card-title"]}>
                {isOnlyToday ? "Today’s deliveries" : `Deliveries · ${formatDateRange(rangeFrom, rangeTo)}`}
              </h2>
              <p className={dashboardStyles["admin-card-subtitle"]}>
                {isOnlyToday ? "Live status from agents’ app" : "Earlier days can be looked at, not changed"}
              </p>
            </div>
            {statusFilter && (
              <button
                type="button"
                className={styles["admin-deliveries-filter-chip"]}
                onClick={() => {
                  setStatusFilter(null);
                  setPage(1);
                }}
              >
                Only {statusFilter} ({shown.length})
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
                <span className={dashboardStyles["admin-visually-hidden"]}>Show all</span>
              </button>
            )}
          </div>

          <div className={dashboardStyles["admin-table-scroll"]}>
            <table className={dashboardStyles["admin-orders-table"]}>
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Route</th>
                  <th scope="col">Agent</th>
                  <th scope="col">Slot</th>
                  <th scope="col">Status</th>
                  <th scope="col">Call</th>
                  <th scope="col" className={dashboardStyles["admin-orders-actions"]}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((delivery) => {
                  const route = routeOf(delivery.routeId);
                  const isToday = delivery.date === todayKey;
                  return (
                    <tr key={delivery.id}>
                      <td>
                        <span className={dashboardStyles["admin-orders-customer"]}>{delivery.customerName}</span>
                        <span className={dashboardStyles["admin-orders-area"]}>
                          {delivery.orderNumber ? `${delivery.orderNumber} · ` : ""}
                          {delivery.address}
                          {isOnlyToday ? "" : ` · ${new Date(`${delivery.date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
                        </span>
                      </td>
                      <td>
                        <span className={styles["admin-route-cell"]}>
                          <span className={styles["admin-route-dot"]} style={{ background: route.colour }} aria-hidden="true" />
                          {route.id}
                        </span>
                      </td>
                      <td>
                        {firstName(delivery.agent)}
                        {/* Asked another agent to take it, waiting for their answer */}
                        {delivery.transferRequest && (
                          <span className={styles["admin-delivery-transfer-note"]}>
                            Transfer to {firstName(delivery.transferRequest.toAgent)} · waiting
                          </span>
                        )}
                      </td>
                      <td className={dashboardStyles["admin-orders-muted"]}>{delivery.slot}</td>
                      <td>
                        <span className={`${dashboardStyles["admin-status"]} ${STATUS_CLASS_NAMES[delivery.status]}`}>{delivery.status}</span>
                      </td>
                      <td>
                        <a
                          href={`tel:+91${delivery.phone}`}
                          className={styles["admin-call-button"]}
                          aria-label={`Call ${delivery.customerName}`}
                          title={`Call ${delivery.phone.replace(/(\d{5})(\d{5})/, "$1 $2")}`}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2Z" />
                          </svg>
                        </a>
                      </td>
                      <td className={dashboardStyles["admin-orders-actions"]}>
                        {isToday && (
                          <AdminRowMenu
                            label={`Actions for ${delivery.customerName}`}
                            title="Delivery"
                            options={[
                              ...(["Delivered", "Out for delivery", "Pending", "Missed"] as DeliveryStatus[]).map((status) => ({
                                label: status === "Pending" ? "Back to pending" : `Mark ${status.toLowerCase()}`,
                                isDisabled: status === delivery.status,
                                isDanger: status === "Missed",
                                onSelect: () => markDelivery(delivery, status),
                              })),
                              ...(delivery.transferRequest
                                ? [
                                    {
                                      label: "Cancel transfer",
                                      isDanger: true,
                                      onSelect: () => {
                                        cancelDeliveryTransfer(delivery.id);
                                        showToast(`Transfer of ${delivery.customerName}'s delivery taken back`);
                                      },
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
                {pageItems.length === 0 && (
                  <tr>
                    <td colSpan={7} className={dashboardStyles["admin-orders-empty"]}>
                      {inRange.length === 0 ? "No deliveries are scheduled for these dates." : "No deliveries match these filters."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <AdminPagination page={page} pageSize={PAGE_SIZE} total={shown.length} onPageChange={setPage} itemName="deliveries" />
        </section>

        <section className={`${dashboardStyles["admin-card"]} ${styles["admin-route-progress-card"]}`} aria-labelledby="admin-route-progress-heading">
          <h2 id="admin-route-progress-heading" className={dashboardStyles["admin-card-title"]}>
            Route progress
          </h2>
          <p className={dashboardStyles["admin-card-subtitle"]}>
            {isOnlyToday ? (updatedAt ? `Updated ${minutesAgo(updatedAt, new Date())}` : "Live") : formatDateRange(rangeFrom, rangeTo)}
          </p>

          <ul className={styles["admin-route-progress-list"]}>
            {routeProgress.map(({ route, total, done, timing, missedOnRoute }) => (
              <li key={route.id}>
                <div className={styles["admin-route-progress-top"]}>
                  <span className={styles["admin-route-progress-name"]}>
                    <span className={styles["admin-route-dot"]} style={{ background: route.colour }} aria-hidden="true" />
                    {route.name} · {route.area}
                  </span>
                  <span className={styles["admin-route-progress-count"]}>
                    {done.toLocaleString("en-IN")} / {total.toLocaleString("en-IN")}
                  </span>
                </div>
                <p className={styles["admin-route-progress-agent"]}>
                  Agent: {firstName(route.agent)} · {isOnlyToday ? timing : `${Math.round((done / total) * 100)}% delivered`}
                  {missedOnRoute > 0 && <span className={styles["admin-route-progress-missed"]}> · {missedOnRoute} missed</span>}
                </p>
                <div
                  className={styles["admin-route-progress-bar"]}
                  role="progressbar"
                  aria-label={`${route.name} delivered`}
                  aria-valuemin={0}
                  aria-valuemax={total}
                  aria-valuenow={done}
                >
                  <span style={{ width: `${(done / total) * 100}%`, background: route.colour }} />
                </div>
              </li>
            ))}
            {routeProgress.length === 0 && <li className={styles["admin-route-progress-empty"]}>No routes for these dates.</li>}
          </ul>

          <button
            type="button"
            className={styles["admin-reassign-button"]}
            disabled={missedToday === 0}
            onClick={() => setIsReassignOpen(true)}
          >
            {missedToday ? `Reassign missed deliveries (${missedToday})` : "No missed deliveries today"}
          </button>
        </section>
      </div>

      {isNewOpen && (
        <AdminDialog title="Add delivery" submitLabel="Add delivery" onClose={() => setIsNewOpen(false)} onSubmit={saveNewDelivery}>
          <AdminDialogField label="Customer name">
            <input
              className={adminInputClassName}
              value={newDelivery.customerName}
              onChange={(changeEvent) => setNewDelivery({ ...newDelivery, customerName: changeEvent.target.value })}
              autoFocus
            />
          </AdminDialogField>
          <AdminDialogField label="Phone">
            <input
              className={adminInputClassName}
              inputMode="numeric"
              placeholder="10 digits"
              value={newDelivery.phone}
              onChange={(changeEvent) => setNewDelivery({ ...newDelivery, phone: changeEvent.target.value.replace(/\D/g, "").slice(0, 10) })}
            />
          </AdminDialogField>
          <AdminDialogField label="Address" isWide>
            <input
              className={adminInputClassName}
              placeholder="#12, Basavanagudi"
              value={newDelivery.address}
              onChange={(changeEvent) => setNewDelivery({ ...newDelivery, address: changeEvent.target.value })}
            />
          </AdminDialogField>
          <AdminDialogField label="Route">
            <select
              className={adminInputClassName}
              value={newDelivery.routeId}
              onChange={(changeEvent) => setNewDelivery({ ...newDelivery, routeId: changeEvent.target.value })}
            >
              {routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.name} · {route.area} ({firstName(route.agent)})
                </option>
              ))}
            </select>
          </AdminDialogField>
          <AdminDialogField label="Slot">
            <select
              className={adminInputClassName}
              value={newDelivery.slot}
              onChange={(changeEvent) => setNewDelivery({ ...newDelivery, slot: changeEvent.target.value as DeliverySlot })}
            >
              {DELIVERY_SLOTS.map((slot) => (
                <option key={slot}>{slot}</option>
              ))}
            </select>
          </AdminDialogField>
        </AdminDialog>
      )}

      {isReassignOpen && (
        <AdminDialog
          title="Reassign missed deliveries"
          submitLabel={`Give ${missedToday} to ${firstName(reassignTo)}`}
          onClose={() => setIsReassignOpen(false)}
          onSubmit={saveReassign}
        >
          <p className={styles["admin-reassign-text"]}>
            {missedToday} {missedToday === 1 ? "delivery was" : "deliveries were"} missed today. They go out again with the agent
            you choose.
          </p>
          <AdminDialogField label="Give to" isWide>
            <select className={adminInputClassName} value={reassignTo} onChange={(changeEvent) => setReassignTo(changeEvent.target.value)}>
              {agentsOnDuty.map((agent) => {
                const left = todaysDeliveries.filter(
                  (delivery) => delivery.agent === agent && (delivery.status === "Pending" || delivery.status === "Out for delivery"),
                ).length;
                return (
                  <option key={agent} value={agent}>
                    {agent} · {left ? `${left} still to deliver` : "free"}
                  </option>
                );
              })}
            </select>
          </AdminDialogField>
        </AdminDialog>
      )}

      {toast}
    </div>
  );
}
