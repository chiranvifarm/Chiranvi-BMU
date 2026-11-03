"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ADMIN_DELIVERY_STEPS,
  OPEN_ORDER_STATUSES,
  addAdminOrder,
  assignAdminOrderAgent,
  changeAdminOrderStatus,
  markOrdersSeen,
  useAdminOrders,
  type AdminOrder,
  type AdminOrderStatus,
} from "@/store/admin-orders-store";
import {
  areaOfDelivery,
  cancelDeliveryTransfer,
  describeDeliveryEvent,
  isDeliveryOpen,
  useAgentOnDutyReader,
  useAreTodayDeliveriesLoaded,
  useCarryOverOrderDeliveries,
  useTodayDeliveries,
  type Delivery,
} from "@/store/admin-deliveries-store";
import { useDeliveryAgents, useDeliveryRoutes, type DeliveryAgent, type DeliveryRoute } from "@/store/admin-routes-store";
import { useCurrentStaffAccess } from "@/store/staff-access-store";
import { AdminFeatureGate } from "./admin-panel-layout";
import {
  AdminDialog,
  AdminDialogField,
  AdminFilterTabs,
  AdminPageTop,
  AdminPagination,
  AdminStatCards,
  adminInputClassName,
  downloadCsv,
  formatDateRange,
  toDateFileName,
  useAdminCan,
  useAdminToast,
} from "./admin-shared";
import dashboardStyles from "./admin-dashboard.module.css";
import sharedStyles from "./admin-shared.module.css";
// The label / value list and green box of the Leads page's details pop-up, reused for an order's details
import leadStyles from "./admin-leads-page.module.css";

/*
  Orders (/admin/orders), from the design 02-orders: every order across subscriptions and one-time
  purchases, including the ones customers pay for on the website (with their Customer ID).
    top        search (order ID, customer, Customer ID or location), New order (pop-up form), Custom range,
               Export
    numbers    total, delivered, pending (with out for delivery), cancelled, for the chosen dates
    table      All / Delivered / Pending / Cancelled tabs; 14 orders a page; order ID, Customer ID, customer
               name, location, status (a drop-down for staff who may edit orders), delivery agent ("Assign
               agent", or the agent's name to change them). Clicking a row opens its details.
    details    (large, two columns) left: the items with quantities and prices, ordered on (date and time),
               promised delivery (date and time), amount paid, payment method (UPI / Net banking / Card: no
               cash on delivery on the website), the delivery address; right: the delivery agent, a transfer
               waiting between agents, the agent history, each step with its time, and Cancel this order.
               Main button: Assign agent (Placed, no agent yet), or the next step. A website order's
               customer sees the same step on their Orders page.
    assign     every agent, the best one for the order's area first (already delivering there today, then
               the route that covers it, then the fewest stops left); giving a Placed order to an agent
               marks it Packed.
  Orders come from store/admin-orders-store.ts; the agents' stops (today's deliveries, in the database) from
  store/admin-deliveries-store.ts; routes and agents from store/admin-routes-store.ts.
*/

const PAGE_SIZE = 14;

const STATUS_CLASS_NAMES: Record<AdminOrderStatus, string> = {
  Delivered: dashboardStyles["admin-status-delivered"],
  "Out for delivery": dashboardStyles["admin-status-out-for-delivery"],
  Packed: dashboardStyles["admin-status-packed"],
  Placed: dashboardStyles["admin-status-pending"],
  Cancelled: sharedStyles["admin-status-cancelled"],
};

// The next step of the order's flow (none once delivered or cancelled)
const NEXT_STATUS: Partial<Record<AdminOrderStatus, AdminOrderStatus>> = {
  Placed: "Packed",
  Packed: "Out for delivery",
  "Out for delivery": "Delivered",
};

type StatusTab = "all" | "delivered" | "pending" | "cancelled";

function isInTab(order: AdminOrder, tab: StatusTab) {
  if (tab === "all") return true;
  if (tab === "delivered") return order.status === "Delivered";
  if (tab === "cancelled") return order.status === "Cancelled";
  return OPEN_ORDER_STATUSES.includes(order.status);
}

function formatOrderDate(placedAt: string) {
  const date = new Date(placedAt);
  const day = date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const time = date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} · ${time}`;
}

// "25 Oct 2026, 6:47 pm"
function formatDateAndTime(isoDate: string) {
  return new Date(isoDate).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const EMPTY_NEW_ORDER = { customerName: "", area: "", items: "", amount: "", payment: "UPI", slot: "6–7 AM" };

export default function AdminOrdersPage() {
  return (
    <AdminFeatureGate feature="orders">
      <OrdersPage />
    </AdminFeatureGate>
  );
}

function OrdersPage() {
  const orders = useAdminOrders();
  const [today] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState(() => new Date(today.getTime() - 6 * 86400000));
  const [rangeTo, setRangeTo] = useState(today);
  const [searchText, setSearchText] = useState("");
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [page, setPage] = useState(1);
  const [isNewOrderOpen, setIsNewOrderOpen] = useState(false);
  const [newOrder, setNewOrder] = useState(EMPTY_NEW_ORDER);
  const { showToast, toast } = useAdminToast();
  const canEdit = useAdminCan("edit");
  // Giving an order to an agent saves its stop in Deliveries, so that page's rights are needed too
  const access = useCurrentStaffAccess();
  const canAssign = canEdit && Boolean(access?.can("deliveries", "create") && access.can("deliveries", "edit"));
  // The order whose details are open (clicking its row)
  const [viewingNumber, setViewingNumber] = useState<string | null>(null);
  const viewing = orders.find((order) => order.orderNumber === viewingNumber);
  // The order being given to an agent ("Assign agent")
  const [assigningNumber, setAssigningNumber] = useState<string | null>(null);
  const assigning = orders.find((order) => order.orderNumber === assigningNumber);
  // Each order's stop today (its agent), by order number
  const todaysDeliveries = useTodayDeliveries();
  const areDeliveriesLoaded = useAreTodayDeliveriesLoaded();
  const routes = useDeliveryRoutes();
  const deliveryOfOrder = useMemo(() => {
    const byOrder = new Map<string, Delivery>();
    for (const delivery of todaysDeliveries) if (delivery.orderNumber) byOrder.set(delivery.orderNumber, delivery);
    return byOrder;
  }, [todaysDeliveries]);
  useCarryOverOrderDeliveries();

  // Opening this page counts as seeing the new orders: the sidebar badge and the bell's list clear
  useEffect(() => {
    markOrdersSeen();
  }, []);

  function moveOrder(order: AdminOrder, status: AdminOrderStatus) {
    changeAdminOrderStatus(order.orderNumber, status);
    showToast(`${order.orderNumber} marked as ${status.toLowerCase()}${order.websiteOrderId ? " · the customer sees it too" : ""}`);
  }

  function openAssign(order: AdminOrder) {
    // A new stop is numbered after today's ones, so wait until they're read
    if (!areDeliveriesLoaded) {
      showToast("Today's deliveries are still loading, try again in a moment");
      return;
    }
    setAssigningNumber(order.orderNumber);
  }

  function assignAgent(order: AdminOrder, agent: DeliveryAgent) {
    const area = order.area.trim().toLowerCase();
    const current = deliveryOfOrder.get(order.orderNumber);
    // The agent's route that covers the order's area, else their own route, else the stop's route, else the first
    const route =
      routes.find((existing) => existing.agent === agent.name && existing.area.toLowerCase() === area) ??
      routes.find((existing) => existing.agent === agent.name) ??
      routes.find((existing) => existing.id === current?.routeId) ??
      routes[0];
    assignAdminOrderAgent(order, agent.name, route?.id ?? current?.routeId ?? "");
    setAssigningNumber(null);
    const markedPacked = order.status === "Placed";
    showToast(
      `${order.orderNumber} assigned to ${agent.name}${markedPacked ? " · marked as packed" : ""}${markedPacked && order.websiteOrderId ? ", the customer sees it too" : ""}`,
    );
  }

  // Orders in the chosen dates that match the search (the numbers and tabs count these)
  const ordersInRange = useMemo(() => {
    const from = new Date(rangeFrom);
    from.setHours(0, 0, 0, 0);
    const to = new Date(rangeTo);
    to.setHours(23, 59, 59, 999);
    const words = searchText.trim().toLowerCase();
    return orders.filter((order) => {
      const placedAt = new Date(order.placedAt);
      if (placedAt < from || placedAt > to) return false;
      return !words || `${order.customerName} ${order.area} ${order.orderNumber} ${order.customerId ?? ""}`.toLowerCase().includes(words);
    });
  }, [orders, rangeFrom, rangeTo, searchText]);

  const counts = {
    all: ordersInRange.length,
    delivered: ordersInRange.filter((order) => isInTab(order, "delivered")).length,
    pending: ordersInRange.filter((order) => isInTab(order, "pending")).length,
    outForDelivery: ordersInRange.filter((order) => order.status === "Out for delivery").length,
    cancelled: ordersInRange.filter((order) => isInTab(order, "cancelled")).length,
  };
  const shownOrders = ordersInRange.filter((order) => isInTab(order, statusTab));
  const pageOrders = shownOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const deliveredShare = counts.all ? ((counts.delivered / counts.all) * 100).toFixed(1) : "0";

  function exportOrders() {
    downloadCsv(`chiranvi-orders-${toDateFileName(rangeFrom)}-to-${toDateFileName(rangeTo)}.csv`, [
      ["Order ID", "Customer ID", "Customer", "Mobile", "Location", "Ordered on", "Promised delivery", "Items", "Amount paid (₹)", "Payment", "Status"],
      ...shownOrders.map((order) => [
        order.orderNumber,
        order.customerId ?? "",
        order.customerName,
        order.customerMobile ?? "",
        order.area,
        formatDateAndTime(order.placedAt),
        order.promisedAt ? formatDateAndTime(order.promisedAt) : order.slot,
        order.items,
        order.amount,
        order.payment,
        order.status,
      ]),
    ]);
  }

  function saveNewOrder() {
    const amount = Number(newOrder.amount);
    if (!newOrder.customerName.trim() || !newOrder.items.trim() || !(amount > 0)) {
      showToast("Fill in the customer, items and amount");
      return;
    }
    const added = addAdminOrder({
      customerName: newOrder.customerName.trim(),
      area: newOrder.area.trim() || "—",
      items: newOrder.items.trim(),
      amount,
      payment: newOrder.payment as AdminOrder["payment"],
      slot: newOrder.slot,
    });
    setIsNewOrderOpen(false);
    setNewOrder(EMPTY_NEW_ORDER);
    setRangeTo(today);
    setStatusTab("all");
    setPage(1);
    showToast(`${added.orderNumber} added for ${added.customerName}`);
  }

  return (
    <div className={dashboardStyles["admin-dashboard"]}>
      <AdminPageTop
        title="Orders"
        description="Every order across subscriptions and one-time purchases"
        searchText={searchText}
        onSearchTextChange={(text) => {
          setSearchText(text);
          setPage(1);
        }}
        searchPlaceholder="Search order ID, customer, Customer ID or location..."
        actionLabel="New order"
        onAction={() => setIsNewOrderOpen(true)}
        today={today}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        onRangeChange={(from, to) => {
          setRangeFrom(from);
          setRangeTo(to);
          setPage(1);
        }}
        onExport={exportOrders}
      />

      <AdminStatCards
        stats={[
          {
            label: "Total orders",
            value: counts.all.toLocaleString("en-IN"),
            note: "↑ 9.1% vs last week",
            trend: "up",
            icon: ["M9 3.5h6v3H9z", "M7 5H5.5v15.5h13V5H17", "M8.5 11.5h7", "M8.5 15.5h5"],
          },
          {
            label: "Delivered",
            value: counts.delivered.toLocaleString("en-IN"),
            note: `${deliveredShare}% of all orders`,
            trend: "plain",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M8.5 12.2l2.4 2.4 4.8-4.8"],
          },
          {
            label: "Pending",
            value: counts.pending.toLocaleString("en-IN"),
            note: `${counts.outForDelivery} out for delivery`,
            trend: "plain",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7.5V12l3 2"],
          },
          {
            label: "Cancelled",
            value: counts.cancelled.toLocaleString("en-IN"),
            note: "↓ 2 vs last week",
            trend: "up",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M9 9l6 6", "M15 9l-6 6"],
          },
        ]}
      />

      <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-orders-heading">
        <div className={dashboardStyles["admin-card-heading-row"]}>
          <div>
            <h2 id="admin-orders-heading" className={dashboardStyles["admin-card-title"]}>
              All orders
            </h2>
            <p className={dashboardStyles["admin-card-subtitle"]}>
              Orders placed between {formatDateRange(rangeFrom, rangeTo)}
            </p>
          </div>
          <AdminFilterTabs
            label="Show orders"
            selected={statusTab}
            onSelect={(tab) => {
              setStatusTab(tab);
              setPage(1);
            }}
            tabs={[
              { key: "all", label: `All ${counts.all}` },
              { key: "delivered", label: `Delivered ${counts.delivered}` },
              { key: "pending", label: `Pending ${counts.pending}` },
              { key: "cancelled", label: `Cancelled ${counts.cancelled}` },
            ]}
          />
        </div>

        <div className={dashboardStyles["admin-table-scroll"]}>
          <table className={dashboardStyles["admin-orders-table"]}>
            <thead>
              <tr>
                <th scope="col">Order ID</th>
                <th scope="col">Customer ID</th>
                <th scope="col">Customer name</th>
                <th scope="col">Location</th>
                <th scope="col">Status</th>
                <th scope="col" className={dashboardStyles["admin-orders-actions"]}>Delivery agent</th>
              </tr>
            </thead>
            <tbody>
              {pageOrders.map((order) => {
                const agentName = deliveryOfOrder.get(order.orderNumber)?.agent;
                const isOpen = OPEN_ORDER_STATUSES.includes(order.status);
                return (
                  <tr
                    key={order.orderNumber}
                    className={dashboardStyles["admin-orders-row-clickable"]}
                    tabIndex={0}
                    aria-label={`${order.orderNumber}, ${order.customerName}: open details`}
                    onClick={() => setViewingNumber(order.orderNumber)}
                    onKeyDown={(keyEvent) => {
                      if (keyEvent.key === "Enter" && keyEvent.target === keyEvent.currentTarget) setViewingNumber(order.orderNumber);
                    }}
                  >
                    <td>
                      <span className={dashboardStyles["admin-orders-customer"]}>{order.orderNumber}</span>
                      <span className={dashboardStyles["admin-orders-area"]}>{formatOrderDate(order.placedAt)}</span>
                    </td>
                    <td className={dashboardStyles["admin-orders-muted"]}>{order.customerId ?? "—"}</td>
                    <td>{order.customerName}</td>
                    <td>{order.area}</td>
                    {/* The status and agent cells don't open the details */}
                    <td onClick={(clickEvent) => clickEvent.stopPropagation()} onKeyDown={(keyEvent) => keyEvent.stopPropagation()}>
                      {canEdit && order.status !== "Cancelled" ? (
                        <span
                          className={`${dashboardStyles["admin-status"]} ${STATUS_CLASS_NAMES[order.status]} ${dashboardStyles["admin-status-select-pill"]}`}
                        >
                          <select
                            className={dashboardStyles["admin-status-select"]}
                            value={order.status}
                            aria-label={`Status of ${order.orderNumber}`}
                            onChange={(changeEvent) => moveOrder(order, changeEvent.target.value as AdminOrderStatus)}
                          >
                            {ADMIN_DELIVERY_STEPS.map((step) => (
                              <option key={step} value={step}>
                                {step}
                              </option>
                            ))}
                          </select>
                          <svg className={dashboardStyles["admin-status-select-arrow"]} viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M7 10l5 5 5-5" />
                          </svg>
                        </span>
                      ) : (
                        <span className={`${dashboardStyles["admin-status"]} ${STATUS_CLASS_NAMES[order.status]}`}>{order.status}</span>
                      )}
                    </td>
                    <td
                      className={dashboardStyles["admin-orders-actions"]}
                      onClick={(clickEvent) => clickEvent.stopPropagation()}
                      onKeyDown={(keyEvent) => keyEvent.stopPropagation()}
                    >
                      {canAssign && isOpen ? (
                        <button
                          type="button"
                          className={`${dashboardStyles["admin-order-agent-button"]} ${agentName ? dashboardStyles["admin-order-agent-button-assigned"] : ""}`}
                          aria-label={agentName ? `Change the agent of ${order.orderNumber} (now ${agentName})` : `Assign an agent to ${order.orderNumber}`}
                          onClick={() => openAssign(order)}
                        >
                          {agentName ?? "Assign agent"}
                        </button>
                      ) : (
                        <span className={dashboardStyles["admin-orders-muted"]}>{agentName ?? "—"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {pageOrders.length === 0 && (
                <tr>
                  <td colSpan={6} className={dashboardStyles["admin-orders-empty"]}>
                    No orders match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <AdminPagination page={page} pageSize={PAGE_SIZE} total={shownOrders.length} onPageChange={setPage} itemName="orders" />
      </section>

      {viewing && !assigning && (
        <OrderDetailsDialog
          order={viewing}
          delivery={deliveryOfOrder.get(viewing.orderNumber)}
          routes={routes}
          canEdit={canEdit}
          canAssign={canAssign}
          onClose={() => setViewingNumber(null)}
          onMove={(status) => moveOrder(viewing, status)}
          onAssign={() => openAssign(viewing)}
          onCancelTransfer={(delivery) => {
            cancelDeliveryTransfer(delivery.id);
            showToast(`Transfer of ${viewing.orderNumber} taken back`);
          }}
        />
      )}

      {assigning && (
        <AssignAgentDialog
          order={assigning}
          delivery={deliveryOfOrder.get(assigning.orderNumber)}
          todaysDeliveries={todaysDeliveries}
          routes={routes}
          onClose={() => setAssigningNumber(null)}
          onAssign={(agent) => assignAgent(assigning, agent)}
        />
      )}

      {isNewOrderOpen && (
        <AdminDialog title="New order" submitLabel="Add order" onClose={() => setIsNewOrderOpen(false)} onSubmit={saveNewOrder}>
          <AdminDialogField label="Customer name">
            <input
              className={adminInputClassName}
              value={newOrder.customerName}
              onChange={(changeEvent) => setNewOrder({ ...newOrder, customerName: changeEvent.target.value })}
              autoFocus
            />
          </AdminDialogField>
          <AdminDialogField label="Area">
            <input
              className={adminInputClassName}
              value={newOrder.area}
              onChange={(changeEvent) => setNewOrder({ ...newOrder, area: changeEvent.target.value })}
            />
          </AdminDialogField>
          <AdminDialogField label="Items" isWide>
            <input
              className={adminInputClassName}
              value={newOrder.items}
              placeholder="Milk 1 L × 2, Paneer 200 g"
              onChange={(changeEvent) => setNewOrder({ ...newOrder, items: changeEvent.target.value })}
            />
          </AdminDialogField>
          <AdminDialogField label="Amount (₹)">
            <input
              className={adminInputClassName}
              inputMode="numeric"
              value={newOrder.amount}
              onChange={(changeEvent) => setNewOrder({ ...newOrder, amount: changeEvent.target.value.replace(/\D/g, "") })}
            />
          </AdminDialogField>
          <AdminDialogField label="Payment">
            <select
              className={adminInputClassName}
              value={newOrder.payment}
              onChange={(changeEvent) => setNewOrder({ ...newOrder, payment: changeEvent.target.value })}
            >
              {["UPI", "Net banking", "Card", "Cash"].map((payment) => (
                <option key={payment}>{payment}</option>
              ))}
            </select>
          </AdminDialogField>
          <AdminDialogField label="Delivery slot">
            <select
              className={adminInputClassName}
              value={newOrder.slot}
              onChange={(changeEvent) => setNewOrder({ ...newOrder, slot: changeEvent.target.value })}
            >
              {["5–6 AM", "6–7 AM", "7–8 AM"].map((slot) => (
                <option key={slot}>{slot}</option>
              ))}
            </select>
          </AdminDialogField>
        </AdminDialog>
      )}

      {toast}
    </div>
  );
}

// "6:47 am"
function formatClock(isoDate: string) {
  return new Date(isoDate).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

/*
  An order's details (clicking its row). Left: what was ordered (with quantities and prices), when it was
  ordered and promised, what was paid and how, where it goes. Right: its delivery agent, a transfer waiting
  between agents, the agent history, each step with its time, and Cancel this order (asks first).
*/
function OrderDetailsDialog({
  order,
  delivery,
  routes,
  canEdit,
  canAssign,
  onClose,
  onMove,
  onAssign,
  onCancelTransfer,
}: {
  order: AdminOrder;
  delivery: Delivery | undefined;
  routes: DeliveryRoute[];
  canEdit: boolean;
  canAssign: boolean; // may also change Deliveries (an agent's stops)
  onClose: () => void;
  onMove: (status: AdminOrderStatus) => void;
  onAssign: () => void;
  onCancelTransfer: (delivery: Delivery) => void;
}) {
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const isOpen = OPEN_ORDER_STATUSES.includes(order.status);
  const nextStatus = NEXT_STATUS[order.status];
  // Placed with no agent: give it to one; Packed / Out for delivery: the next step; otherwise close
  const mainAction: { label: string; run: () => void } =
    !canEdit
      ? { label: "Close", run: onClose }
      : order.status === "Placed" && !delivery && canAssign
        ? { label: "Assign agent", run: onAssign }
        : (order.status === "Packed" || order.status === "Out for delivery") && nextStatus
          ? { label: `Mark as ${nextStatus.toLowerCase()}`, run: () => onMove(nextStatus) }
          : { label: "Close", run: onClose };
  const flowSteps: AdminOrderStatus[] = order.status === "Cancelled" ? ["Placed", "Cancelled"] : ADMIN_DELIVERY_STEPS;
  const reachedIndex = flowSteps.indexOf(order.status);
  const route = delivery ? routes.find((existing) => existing.id === delivery.routeId) : undefined;
  const agentPhone = useDeliveryAgents().find((agent) => agent.name === delivery?.agent)?.phone ?? "";
  const history = [...(delivery?.history ?? [])].reverse();
  return (
    <AdminDialog title={`Order ${order.orderNumber}`} submitLabel={mainAction.label} onClose={onClose} onSubmit={mainAction.run} isLarge>
      <div className={dashboardStyles["admin-order-details-columns"]}>
        <div className={dashboardStyles["admin-order-details-column"]}>
          <dl className={leadStyles["admin-lead-details"]}>
            <div>
              <dt>Order ID</dt>
              <dd>{order.orderNumber}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <span className={`${dashboardStyles["admin-status"]} ${STATUS_CLASS_NAMES[order.status]}`}>{order.status}</span>
              </dd>
            </div>
            <div>
              <dt>Customer ID</dt>
              <dd>{order.customerId ?? "—"}</dd>
            </div>
            <div>
              <dt>Customer name</dt>
              <dd>{order.customerName}</dd>
            </div>
            <div>
              <dt>Mobile</dt>
              <dd>{order.customerMobile ? <a href={`tel:+91${order.customerMobile}`}>{`${order.customerMobile.slice(0, 5)} ${order.customerMobile.slice(5)}`}</a> : "—"}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{order.area || "—"}</dd>
            </div>
            {/* Ordered for someone else: the number on the delivery address, to call at the door */}
            {order.deliveryMobile && (
              <div>
                <dt>Delivery contact</dt>
                <dd>
                  <a href={`tel:+91${order.deliveryMobile}`}>{`${order.deliveryMobile.slice(0, 5)} ${order.deliveryMobile.slice(5)}`}</a>
                </dd>
              </div>
            )}
            {order.deliverTo && (
              <div className={leadStyles["admin-lead-details-wide"]}>
                <dt>Deliver to</dt>
                <dd>{order.deliverTo}</dd>
              </div>
            )}
            <div>
              <dt>Ordered on</dt>
              <dd>{formatDateAndTime(order.placedAt)}</dd>
            </div>
            <div>
              <dt>Promised delivery</dt>
              <dd>{order.promisedAt ? formatDateAndTime(order.promisedAt) : `Slot ${order.slot}`}</dd>
            </div>
            <div>
              <dt>Amount paid</dt>
              <dd>₹{order.amount.toLocaleString("en-IN")}</dd>
            </div>
            <div>
              <dt>Payment method</dt>
              <dd>{order.payment}</dd>
            </div>
          </dl>

          {/* What was ordered */}
          <div className={leadStyles["admin-lead-bulk-order"]}>
            <h3>Items</h3>
            <ul>
              {order.itemList?.length ? (
                order.itemList.map((item) => (
                  <li key={`${item.name}-${item.packSize}`}>
                    <span>
                      {item.name} · {item.packSize} × {item.quantity}
                      {item.productId && <span className={dashboardStyles["admin-order-item-product-id"]}>Product ID {item.productId}</span>}
                    </span>
                    <strong>₹{(item.price * item.quantity).toLocaleString("en-IN")}</strong>
                  </li>
                ))
              ) : (
                <li>
                  <span>{order.items}</span>
                  <strong>₹{order.amount.toLocaleString("en-IN")}</strong>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className={dashboardStyles["admin-order-details-column"]}>
          {/* Who delivers it */}
          <section className={dashboardStyles["admin-order-agent-box"]} aria-label="Delivery agent">
            <h3 className={dashboardStyles["admin-order-box-title"]}>Delivery agent</h3>
            {delivery ? (
              <>
                <p className={dashboardStyles["admin-order-agent-name"]}>{delivery.agent}</p>
                <p className={dashboardStyles["admin-order-agent-detail"]}>
                  {/^\d{10}$/.test(agentPhone) && <a href={`tel:+91${agentPhone}`}>{`${agentPhone.slice(0, 5)} ${agentPhone.slice(5)}`}</a>}
                  {route ? `${/^\d{10}$/.test(agentPhone) ? " · " : ""}${route.name} · ${route.area}` : ""}
                </p>
                <p className={dashboardStyles["admin-order-agent-detail"]}>
                  {delivery.status} · slot {delivery.slot}
                </p>
                {canAssign && isOpen && (
                  <button type="button" className={dashboardStyles["admin-order-change-agent-button"]} onClick={onAssign}>
                    Change agent
                  </button>
                )}
              </>
            ) : (
              <p className={dashboardStyles["admin-order-agent-detail"]}>Not assigned yet</p>
            )}
          </section>

          {/* One agent asked another to take it */}
          {delivery?.transferRequest && (
            <section className={dashboardStyles["admin-order-transfer-box"]} aria-label="Transfer waiting">
              <h3 className={dashboardStyles["admin-order-box-title"]}>
                Transfer waiting: {delivery.transferRequest.fromAgent} → {delivery.transferRequest.toAgent}
              </h3>
              <p className={dashboardStyles["admin-order-agent-detail"]}>
                Asked at {formatClock(delivery.transferRequest.requestedAt)}
                {delivery.transferRequest.reason ? ` · ${delivery.transferRequest.reason}` : ""}
              </p>
              {canAssign && (
                <button type="button" className={dashboardStyles["admin-order-danger-link"]} onClick={() => onCancelTransfer(delivery)}>
                  Cancel transfer
                </button>
              )}
            </section>
          )}

          {history.length > 0 && (
            <section aria-label="Agent history">
              <h3 className={dashboardStyles["admin-order-box-title"]}>Agent history</h3>
              <ul className={dashboardStyles["admin-order-history"]}>
                {history.map((event) => (
                  <li key={`${event.kind}-${event.at}`}>
                    <span>{describeDeliveryEvent(event)}</span>
                    <span className={dashboardStyles["admin-order-step-time"]}>{formatClock(event.at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Each step and when it was reached */}
          <ol className={dashboardStyles["admin-order-steps"]} aria-label="Order steps">
            {flowSteps.map((step, index) => {
              const reachedAt = order.statusChangedAt?.[step];
              const isDone = index <= reachedIndex;
              return (
                <li key={step} className={isDone ? dashboardStyles["admin-order-step-done"] : undefined}>
                  <span className={dashboardStyles["admin-order-step-dot"]} aria-hidden="true" />
                  <span className={dashboardStyles["admin-order-step-name"]}>{step}</span>
                  <span className={dashboardStyles["admin-order-step-time"]}>{reachedAt ? formatDateAndTime(reachedAt) : isDone ? "Done" : "—"}</span>
                </li>
              );
            })}
          </ol>

          {/* Cancelling asks first */}
          {canEdit && isOpen && (
            <div className={dashboardStyles["admin-order-cancel-area"]}>
              {isConfirmingCancel ? (
                <>
                  <p className={dashboardStyles["admin-order-agent-detail"]}>Cancel {order.orderNumber}? Its delivery is taken off the agent&rsquo;s list.</p>
                  <div className={dashboardStyles["admin-order-cancel-buttons"]}>
                    <button type="button" className={dashboardStyles["admin-order-change-agent-button"]} onClick={() => setIsConfirmingCancel(false)}>
                      Keep order
                    </button>
                    <button
                      type="button"
                      className={dashboardStyles["admin-order-cancel-button"]}
                      onClick={() => {
                        setIsConfirmingCancel(false);
                        onMove("Cancelled");
                      }}
                    >
                      Yes, cancel order
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" className={dashboardStyles["admin-order-cancel-button"]} onClick={() => setIsConfirmingCancel(true)}>
                  Cancel this order
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </AdminDialog>
  );
}

// An agent as the assign window shows them, with what they have today
type AgentChoice = {
  agent: DeliveryAgent;
  isOnDuty: boolean;
  stopsToGo: number;
  delivered: number;
  missed: number;
  stopsToGoInArea: number;
  coveringRoute?: DeliveryRoute;
  ownRoute?: DeliveryRoute;
  areaCounts: [string, number][]; // their areas today, most stops first
  openOrdersInArea: string[]; // "#CF-60084"
};

/*
  "Assign agent": every agent, the best for this order first — on leave last (they can't be picked), then
  the most stops still to go in the order's area today, then the agent whose route covers the area, then the
  fewest stops left, then by name. The top one is "Suggested" when they match the area.
*/
function AssignAgentDialog({
  order,
  delivery,
  todaysDeliveries,
  routes,
  onClose,
  onAssign,
}: {
  order: AdminOrder;
  delivery: Delivery | undefined;
  todaysDeliveries: Delivery[];
  routes: DeliveryRoute[];
  onClose: () => void;
  onAssign: (agent: DeliveryAgent) => void;
}) {
  const agents = useDeliveryAgents();
  const isOnDuty = useAgentOnDutyReader();
  const area = order.area.trim().toLowerCase();

  const choices: AgentChoice[] = useMemo(() => {
    const list = agents.map((agent): AgentChoice => {
      const stops = todaysDeliveries.filter((existing) => existing.agent === agent.name);
      const open = stops.filter(isDeliveryOpen);
      const counts = new Map<string, number>();
      for (const stop of stops) {
        const stopArea = areaOfDelivery(stop);
        if (stopArea) counts.set(stopArea, (counts.get(stopArea) ?? 0) + 1);
      }
      const inArea = open.filter((stop) => areaOfDelivery(stop).toLowerCase() === area);
      return {
        agent,
        isOnDuty: isOnDuty(agent.phone),
        stopsToGo: open.length,
        delivered: stops.filter((stop) => stop.status === "Delivered").length,
        missed: stops.filter((stop) => stop.status === "Missed").length,
        stopsToGoInArea: inArea.length,
        coveringRoute: routes.find((route) => route.agent === agent.name && route.area.toLowerCase() === area),
        ownRoute: routes.find((route) => route.agent === agent.name),
        areaCounts: [...counts.entries()].sort((first, second) => second[1] - first[1]),
        openOrdersInArea: inArea.flatMap((stop) => (stop.orderNumber && stop.orderNumber !== order.orderNumber ? [stop.orderNumber] : [])),
      };
    });
    return list.sort(
      (first, second) =>
        Number(Boolean(first.agent.isOnLeave)) - Number(Boolean(second.agent.isOnLeave)) ||
        second.stopsToGoInArea - first.stopsToGoInArea ||
        Number(Boolean(second.coveringRoute)) - Number(Boolean(first.coveringRoute)) ||
        first.stopsToGo - second.stopsToGo ||
        first.agent.name.localeCompare(second.agent.name),
    );
  }, [agents, todaysDeliveries, routes, area, isOnDuty, order.orderNumber]);

  const top = choices[0];
  const suggestedName = top && !top.agent.isOnLeave && (top.stopsToGoInArea > 0 || top.coveringRoute) ? top.agent.name : null;
  const [pickedName, setPickedName] = useState<string | null>(
    () => delivery?.agent ?? choices.find((choice) => !choice.agent.isOnLeave)?.agent.name ?? null,
  );
  const picked = choices.find((choice) => choice.agent.name === pickedName && !choice.agent.isOnLeave);

  return (
    <AdminDialog
      title={`Assign delivery agent · ${order.orderNumber}`}
      submitLabel="Assign"
      isLarge
      onClose={onClose}
      onSubmit={() => (picked ? onAssign(picked.agent) : onClose())}
    >
      <div className={dashboardStyles["admin-assign-agent"]}>
        <p className={dashboardStyles["admin-order-agent-detail"]}>
          {order.customerName}
          {order.area ? ` · ${order.area}` : ""} · {order.items}
        </p>
        {delivery?.transferRequest && (
          <p className={dashboardStyles["admin-assign-agent-transfer-note"]}>
            {delivery.transferRequest.fromAgent} asked {delivery.transferRequest.toAgent} to take this order. Assigning here replaces that request.
          </p>
        )}
        {choices.length === 0 ? (
          <p className={dashboardStyles["admin-order-agent-detail"]}>No delivery agents yet. Add them on Routes &amp; agents.</p>
        ) : (
          <div className={dashboardStyles["admin-table-scroll"]}>
            <table className={`${dashboardStyles["admin-orders-table"]} ${dashboardStyles["admin-assign-agent-table"]}`}>
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Duty and route</th>
                  <th scope="col">Today</th>
                  <th scope="col">Areas today</th>
                </tr>
              </thead>
              <tbody>
                {choices.map((choice) => {
                  const { agent } = choice;
                  const isPicked = picked?.agent.name === agent.name;
                  const routeLine =
                    choice.stopsToGoInArea > 0
                      ? `Already delivering in ${order.area} today · ${choice.stopsToGoInArea} order${choice.stopsToGoInArea === 1 ? "" : "s"}`
                      : choice.coveringRoute
                        ? `${choice.coveringRoute.name} covers ${order.area}`
                        : choice.ownRoute
                          ? `${choice.ownRoute.name} · ${choice.ownRoute.area}`
                          : "Spare agent (no route)";
                  return (
                    <tr
                      key={agent.name}
                      className={`${dashboardStyles["admin-assign-agent-row"]} ${isPicked ? dashboardStyles["admin-assign-agent-row-picked"] : ""} ${agent.isOnLeave ? dashboardStyles["admin-assign-agent-row-on-leave"] : ""}`}
                      onClick={() => !agent.isOnLeave && setPickedName(agent.name)}
                    >
                      <td>
                        <label className={dashboardStyles["admin-assign-agent-name"]}>
                          <input
                            type="radio"
                            name="assign-agent"
                            checked={isPicked}
                            disabled={agent.isOnLeave}
                            onChange={() => setPickedName(agent.name)}
                          />
                          <span>{agent.name}</span>
                        </label>
                        <span className={dashboardStyles["admin-assign-agent-badges"]}>
                          {agent.name === suggestedName && <span className={dashboardStyles["admin-assign-agent-suggested"]}>Suggested</span>}
                          {agent.name === delivery?.agent && <span className={dashboardStyles["admin-assign-agent-current"]}>Assigned now</span>}
                        </span>
                        <span className={dashboardStyles["admin-orders-area"]}>
                          {/^\d{10}$/.test(agent.phone) ? (
                            <a href={`tel:+91${agent.phone}`} onClick={(clickEvent) => clickEvent.stopPropagation()}>
                              {`${agent.phone.slice(0, 5)} ${agent.phone.slice(5)}`}
                            </a>
                          ) : (
                            agent.phone
                          )}
                          {agent.bike ? ` · ${agent.bike}` : ""}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`${dashboardStyles["admin-assign-agent-duty"]} ${
                            agent.isOnLeave
                              ? dashboardStyles["admin-assign-agent-duty-leave"]
                              : choice.isOnDuty
                                ? dashboardStyles["admin-assign-agent-duty-on"]
                                : dashboardStyles["admin-assign-agent-duty-off"]
                          }`}
                        >
                          {agent.isOnLeave ? "On leave" : choice.isOnDuty ? "On duty" : "Off duty"}
                        </span>
                        <span className={dashboardStyles["admin-orders-area"]}>{routeLine}</span>
                      </td>
                      <td>
                        <span className={dashboardStyles["admin-orders-customer"]}>
                          {choice.stopsToGo} stop{choice.stopsToGo === 1 ? "" : "s"} to go
                        </span>
                        <span className={dashboardStyles["admin-orders-area"]}>
                          {choice.delivered} delivered · {choice.missed} missed
                        </span>
                      </td>
                      <td>
                        <span className={dashboardStyles["admin-assign-agent-areas"]}>
                          {choice.areaCounts.slice(0, 3).map(([stopArea, count]) => (
                            <span
                              key={stopArea}
                              className={`${dashboardStyles["admin-assign-agent-area-chip"]} ${stopArea.toLowerCase() === area ? dashboardStyles["admin-assign-agent-area-chip-match"] : ""}`}
                            >
                              {stopArea} {count}
                            </span>
                          ))}
                          {choice.areaCounts.length > 3 && <span className={dashboardStyles["admin-orders-area"]}>+{choice.areaCounts.length - 3} more</span>}
                          {choice.areaCounts.length === 0 && <span className={dashboardStyles["admin-orders-area"]}>No stops yet</span>}
                        </span>
                        {choice.openOrdersInArea.length > 0 && (
                          <span className={dashboardStyles["admin-orders-area"]}>Here: {choice.openOrdersInArea.join(", ")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminDialog>
  );
}
