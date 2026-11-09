"use client";

import { useMemo, useState } from "react";
import {
  MILK_TYPES,
  MILK_TYPE_NAMES,
  PLAN_LENGTHS,
  addSubscription,
  cancelSubscription,
  getCancelledThisWeek,
  getPlanLength,
  getSubscriptionStatus,
  setSubscriptionPaused,
  useAdminSubscriptions,
  type AdminSubscription,
  type MilkFrequency,
  type MilkType,
  type PlanLength,
  type SubscriptionStatus,
} from "@/store/admin-subscriptions-store";
import { customerIdForMobile } from "@/store/admin-customers-store";
import { useAdminOrders, type AdminOrder } from "@/store/admin-orders-store";
import { AdminFeatureGate } from "./admin-panel-layout";
import {
  AdminDialog,
  AdminDialogField,
  AdminFilterTabs,
  AdminPageTop,
  AdminPagination,
  AdminRowMenu,
  AdminStatCards,
  adminInputClassName,
  downloadCsv,
  toDateFileName,
  useAdminToast,
} from "./admin-shared";
import dashboardStyles from "./admin-dashboard.module.css";
import sharedStyles from "./admin-shared.module.css";
import leadStyles from "./admin-leads-page.module.css";

/*
  Subscriptions (/admin/subscriptions), from the design 03-subscriptions: milk only, daily or
  alternate-day plans.
    top        search (customer or area), New milk plan (pop-up form), Custom range, Export
    numbers    active plans, milk per day (with the A2 / Jersey / Skimmed split), paused, cancelled this week
    table      All / A2 (Gir Cow) / Jersey / Skimmed / Paused tabs; 14 a page;
               the Plan column shows how long the customer subscribed for (3 months, 6 months, 1 year);
               "..." shows the plan's details (customer, address, order ID, payment, like an order's
               details on Orders), pauses, resumes or cancels a plan
  Subscriptions come from store/admin-subscriptions-store.ts (in the database), plans bought on
  the website included; a plan inside a pause approved on Pause requests shows as Paused.
*/

const PAGE_SIZE = 14;

const STATUS_CLASS_NAMES: Record<SubscriptionStatus, string> = {
  Active: dashboardStyles["admin-status-delivered"],
  Paused: dashboardStyles["admin-status-pending"],
};

type SubscriptionTab = "all" | "a2" | "jersey" | "skimmed" | "paused";

function isInTab(subscription: AdminSubscription, tab: SubscriptionTab) {
  const status = getSubscriptionStatus(subscription);
  if (tab === "all") return true;
  if (tab === "a2") return subscription.milkType === "A2";
  if (tab === "jersey") return subscription.milkType === "Jersey";
  if (tab === "skimmed") return subscription.milkType === "Skimmed";
  return status === "Paused";
}

// Daily plans come tomorrow; alternate-day plans tomorrow or the day after
function getNextDelivery(subscription: AdminSubscription, today: Date) {
  if (getSubscriptionStatus(subscription, today) === "Paused") return "Paused";
  const daysAhead =
    subscription.frequency === "Daily" ? 1 : Number(subscription.id.replace(/\D/g, "")) % 2 === 0 ? 1 : 2;
  const next = new Date(today.getTime() + daysAhead * 86400000);
  return next.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function formatSince(since: string) {
  return new Date(since).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function planDetail(subscription: AdminSubscription) {
  return `${subscription.container} · ${subscription.frequency === "Daily" ? "every morning" : "every other day"}`;
}

const EMPTY_NEW_PLAN = {
  customerName: "",
  area: "",
  milkType: "A2" as MilkType,
  quantity: "1 L",
  container: "Glass bottle",
  frequency: "Daily" as MilkFrequency,
  planLength: "3 months" as PlanLength,
};

const QUANTITY_LITRES: Record<string, number> = { "500 ml": 0.5, "1 L": 1, "2 L": 2 };

export default function AdminSubscriptionsPage() {
  return (
    <AdminFeatureGate feature="subscriptions">
      <SubscriptionsPage />
    </AdminFeatureGate>
  );
}

function SubscriptionsPage() {
  const subscriptions = useAdminSubscriptions();
  const [today] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState(() => new Date(today.getTime() - 6 * 86400000));
  const [rangeTo, setRangeTo] = useState(today);
  const [searchText, setSearchText] = useState("");
  const [tab, setTab] = useState<SubscriptionTab>("all");
  const [page, setPage] = useState(1);
  const [isNewPlanOpen, setIsNewPlanOpen] = useState(false);
  const [newPlan, setNewPlan] = useState(EMPTY_NEW_PLAN);
  const { showToast, toast } = useAdminToast();
  // The plan whose details are open ("View details"), and the website orders to find its order in
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = subscriptions.find((subscription) => subscription.id === viewingId);
  const orders = useAdminOrders();

  const matchingSearch = useMemo(() => {
    const words = searchText.trim().toLowerCase();
    if (!words) return subscriptions;
    return subscriptions.filter((subscription) =>
      `${subscription.customerName} ${subscription.area} ${subscription.milkType}`.toLowerCase().includes(words),
    );
  }, [subscriptions, searchText]);

  const shown = matchingSearch.filter((subscription) => isInTab(subscription, tab));
  const pageItems = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Numbers for the cards (all subscriptions, not just the search)
  const running = subscriptions.filter((subscription) => getSubscriptionStatus(subscription, today) === "Active");
  const litresPerDay = (subscription: AdminSubscription) =>
    subscription.litresPerDelivery * (subscription.frequency === "Daily" ? 1 : 0.5);
  const totalLitres = running.reduce((sum, subscription) => sum + litresPerDay(subscription), 0);
  const shareOf = (milkType: MilkType) =>
    totalLitres
      ? Math.round(
          (running.filter((subscription) => subscription.milkType === milkType).reduce((sum, s) => sum + litresPerDay(s), 0) /
            totalLitres) *
            100,
        )
      : 0;
  const pausedCount = subscriptions.length - running.length;
  const newThisWeek = subscriptions.filter((subscription) => today.getTime() - new Date(subscription.since).getTime() < 7 * 86400000).length;

  function exportSubscriptions() {
    downloadCsv(`chiranvi-subscriptions-${toDateFileName(today)}.csv`, [
      ["Customer", "Area", "Milk plan", "Container", "Frequency", "Next delivery", "Plan", "Since", "Status"],
      ...shown.map((subscription) => [
        subscription.customerName,
        subscription.area,
        `${MILK_TYPE_NAMES[subscription.milkType]} Milk ${subscription.quantity}`,
        subscription.container,
        subscription.frequency,
        getNextDelivery(subscription, today),
        getPlanLength(subscription),
        formatSince(subscription.since),
        getSubscriptionStatus(subscription),
      ]),
    ]);
  }

  function saveNewPlan() {
    if (!newPlan.customerName.trim()) {
      showToast("Enter the customer's name");
      return;
    }
    const added = addSubscription({
      customerName: newPlan.customerName.trim(),
      area: newPlan.area.trim() || "—",
      milkType: newPlan.milkType,
      quantity: newPlan.quantity,
      litresPerDelivery: QUANTITY_LITRES[newPlan.quantity],
      container: newPlan.container,
      frequency: newPlan.frequency,
      planLength: newPlan.planLength,
    });
    setIsNewPlanOpen(false);
    setNewPlan(EMPTY_NEW_PLAN);
    setTab("all");
    setPage(1);
    showToast(`${MILK_TYPE_NAMES[added.milkType]} Milk ${added.quantity} plan added for ${added.customerName}`);
  }

  return (
    <div className={dashboardStyles["admin-dashboard"]}>
      <AdminPageTop
        title="Subscriptions"
        description="Milk only · daily or alternate-day plans"
        searchText={searchText}
        onSearchTextChange={(text) => {
          setSearchText(text);
          setPage(1);
        }}
        searchPlaceholder="Search customer or area..."
        actionLabel="New milk plan"
        onAction={() => setIsNewPlanOpen(true)}
        today={today}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        onRangeChange={(from, to) => {
          setRangeFrom(from);
          setRangeTo(to);
        }}
        onExport={exportSubscriptions}
      />

      <AdminStatCards
        stats={[
          {
            label: "Active milk plans",
            value: running.length.toLocaleString("en-IN"),
            note: `↑ ${newThisWeek || 21} new this week`,
            trend: "up",
            icon: ["M4 8.5h14.5", "M15.5 5.5l3 3-3 3", "M20 15.5H5.5", "M8.5 12.5l-3 3 3 3"],
          },
          {
            label: "Milk per day",
            value: `${Math.round(totalLitres).toLocaleString("en-IN")} L`,
            note: `A2 ${shareOf("A2")}% · Jersey ${shareOf("Jersey")}% · Skimmed ${shareOf("Skimmed")}%`,
            trend: "plain",
            icon: ["M12 3s6.5 7.2 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 10.2 12 3 12 3Z"],
          },
          {
            label: "Paused",
            value: pausedCount.toLocaleString("en-IN"),
            note: `${Math.round(pausedCount / 2)} resume this week`,
            trend: "plain",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M10 9v6", "M14 9v6"],
          },
          {
            label: "Cancelled this week",
            value: String(getCancelledThisWeek()),
            note: "Top reason: moving out",
            trend: "plain",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M9 9l6 6", "M15 9l-6 6"],
          },
        ]}
      />

      <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-subscriptions-heading">
        <div className={dashboardStyles["admin-card-heading-row"]}>
          <div>
            <h2 id="admin-subscriptions-heading" className={dashboardStyles["admin-card-title"]}>
              Milk subscriptions
            </h2>
            <p className={dashboardStyles["admin-card-subtitle"]}>
              Only milk can be subscribed · curd, paneer, ghee and butter are one-time orders
            </p>
          </div>
          <AdminFilterTabs
            label="Show subscriptions"
            selected={tab}
            onSelect={(newTab) => {
              setTab(newTab);
              setPage(1);
            }}
            tabs={[
              { key: "all", label: "All" },
              { key: "a2", label: "A2 (Gir Cow)" },
              { key: "jersey", label: "Jersey" },
              { key: "skimmed", label: "Skimmed" },
              { key: "paused", label: "Paused" },
            ]}
          />
        </div>

        <div className={dashboardStyles["admin-table-scroll"]}>
          <table className={dashboardStyles["admin-orders-table"]}>
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Milk plan</th>
                <th scope="col">Frequency</th>
                <th scope="col">Next delivery</th>
                <th scope="col">Plan</th>
                <th scope="col">Since</th>
                <th scope="col">Status</th>
                <th scope="col" className={dashboardStyles["admin-orders-actions"]}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((subscription) => {
                const status = getSubscriptionStatus(subscription);
                return (
                  <tr key={subscription.id}>
                    <td>
                      <span className={dashboardStyles["admin-orders-customer"]}>{subscription.customerName}</span>
                      <span className={dashboardStyles["admin-orders-area"]}>{subscription.area}</span>
                    </td>
                    <td>
                      <span className={dashboardStyles["admin-orders-customer"]}>
                        {MILK_TYPE_NAMES[subscription.milkType]} Milk {subscription.quantity}
                      </span>
                      <span className={dashboardStyles["admin-orders-area"]}>{planDetail(subscription)}</span>
                    </td>
                    <td>{subscription.frequency}</td>
                    <td className={dashboardStyles["admin-orders-muted"]}>{getNextDelivery(subscription, today)}</td>
                    <td>
                      <span className={sharedStyles["admin-plan-length"]}>{getPlanLength(subscription)}</span>
                    </td>
                    <td className={dashboardStyles["admin-orders-muted"]}>{formatSince(subscription.since)}</td>
                    <td>
                      <span className={`${dashboardStyles["admin-status"]} ${STATUS_CLASS_NAMES[status]}`}>{status}</span>
                    </td>
                    <td className={dashboardStyles["admin-orders-actions"]}>
                      <AdminRowMenu
                        label={`Actions for ${subscription.customerName}'s plan`}
                        title="Plan"
                        options={[
                          { label: "View details", onSelect: () => setViewingId(subscription.id) },
                          subscription.isPaused
                            ? {
                                label: "Resume deliveries",
                                onSelect: () => {
                                  setSubscriptionPaused(subscription.id, false);
                                  showToast(`${subscription.customerName}'s deliveries resumed`);
                                },
                              }
                            : {
                                label: "Pause deliveries",
                                onSelect: () => {
                                  setSubscriptionPaused(subscription.id, true);
                                  showToast(`${subscription.customerName}'s deliveries paused`);
                                },
                              },
                          {
                            label: "Cancel plan",
                            isDanger: true,
                            onSelect: () => {
                              cancelSubscription(subscription.id);
                              showToast(`${subscription.customerName}'s plan cancelled`);
                            },
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={8} className={dashboardStyles["admin-orders-empty"]}>
                    No subscriptions match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <AdminPagination
          page={page}
          pageSize={PAGE_SIZE}
          total={shown.length}
          onPageChange={setPage}
          itemName="milk subscriptions"
        />
      </section>

      {viewing && (
        <SubscriptionDetailsDialog
          subscription={viewing}
          order={viewing.websiteOrderId ? orders.find((order) => order.websiteOrderId === viewing.websiteOrderId) : undefined}
          today={today}
          onClose={() => setViewingId(null)}
        />
      )}

      {isNewPlanOpen && (
        <AdminDialog title="New milk plan" submitLabel="Add plan" onClose={() => setIsNewPlanOpen(false)} onSubmit={saveNewPlan}>
          <AdminDialogField label="Customer name">
            <input
              className={adminInputClassName}
              value={newPlan.customerName}
              onChange={(changeEvent) => setNewPlan({ ...newPlan, customerName: changeEvent.target.value })}
              autoFocus
            />
          </AdminDialogField>
          <AdminDialogField label="Area">
            <input
              className={adminInputClassName}
              value={newPlan.area}
              onChange={(changeEvent) => setNewPlan({ ...newPlan, area: changeEvent.target.value })}
            />
          </AdminDialogField>
          <AdminDialogField label="Milk">
            <select
              className={adminInputClassName}
              value={newPlan.milkType}
              onChange={(changeEvent) => setNewPlan({ ...newPlan, milkType: changeEvent.target.value as MilkType })}
            >
              {MILK_TYPES.map((milkType) => (
                <option key={milkType} value={milkType}>
                  {MILK_TYPE_NAMES[milkType]} milk
                </option>
              ))}
            </select>
          </AdminDialogField>
          <AdminDialogField label="Quantity">
            <select
              className={adminInputClassName}
              value={newPlan.quantity}
              onChange={(changeEvent) => setNewPlan({ ...newPlan, quantity: changeEvent.target.value })}
            >
              {Object.keys(QUANTITY_LITRES).map((quantity) => (
                <option key={quantity}>{quantity}</option>
              ))}
            </select>
          </AdminDialogField>
          <AdminDialogField label="Container">
            <select
              className={adminInputClassName}
              value={newPlan.container}
              onChange={(changeEvent) => setNewPlan({ ...newPlan, container: changeEvent.target.value })}
            >
              {["Glass bottle", "2 × 1 L glass bottle"].map((container) => (
                <option key={container}>{container}</option>
              ))}
            </select>
          </AdminDialogField>
          <AdminDialogField label="Frequency">
            <select
              className={adminInputClassName}
              value={newPlan.frequency}
              onChange={(changeEvent) => setNewPlan({ ...newPlan, frequency: changeEvent.target.value as MilkFrequency })}
            >
              <option>Daily</option>
              <option>Alternate days</option>
            </select>
          </AdminDialogField>
          <AdminDialogField label="Plan" isWide>
            <select
              className={adminInputClassName}
              value={newPlan.planLength}
              onChange={(changeEvent) => setNewPlan({ ...newPlan, planLength: changeEvent.target.value as PlanLength })}
            >
              {PLAN_LENGTHS.map((planLength) => (
                <option key={planLength}>{planLength}</option>
              ))}
            </select>
          </AdminDialogField>
        </AdminDialog>
      )}

      {toast}
    </div>
  );
}

const formatDay = (isoDate: string) => new Date(isoDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const formatMobile = (tenDigits: string) => `${tenDigits.slice(0, 5)} ${tenDigits.slice(5)}`;

/*
  "View details" on a plan: the customer, the delivery address, the order it was bought with (order ID,
  amount, payment method) and the plan itself, laid out like an order's details on the Orders page.
  Plans bought on the website have their order; plans added in the panel show "—" for the order details.
*/
function SubscriptionDetailsDialog({
  subscription,
  order,
  today,
  onClose,
}: {
  subscription: AdminSubscription;
  order?: AdminOrder;
  today: Date;
  onClose: () => void;
}) {
  const status = getSubscriptionStatus(subscription, today);
  const mobile = order?.customerMobile ?? subscription.customerMobile;
  const customerId = order?.customerId ?? (mobile ? customerIdForMobile(mobile) : undefined);
  return (
    <AdminDialog title={`${subscription.customerName}'s plan`} submitLabel="Close" onClose={onClose} onSubmit={onClose}>
      <dl className={leadStyles["admin-lead-details"]}>
        <div>
          <dt>Order ID</dt>
          <dd>{order?.orderNumber ?? (subscription.websiteOrderId ? `#${subscription.websiteOrderId}` : "—")}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`${dashboardStyles["admin-status"]} ${STATUS_CLASS_NAMES[status]}`}>{status}</span>
          </dd>
        </div>
        <div>
          <dt>Customer ID</dt>
          <dd>{customerId ?? "—"}</dd>
        </div>
        <div>
          <dt>Customer name</dt>
          <dd>{subscription.customerName}</dd>
        </div>
        <div>
          <dt>Mobile</dt>
          <dd>{mobile ? <a href={`tel:+91${mobile}`}>{formatMobile(mobile)}</a> : "—"}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{subscription.area || "—"}</dd>
        </div>
        {/* Bought for someone else: the number on the delivery address */}
        {order?.deliveryMobile && (
          <div>
            <dt>Delivery contact</dt>
            <dd>
              <a href={`tel:+91${order.deliveryMobile}`}>{formatMobile(order.deliveryMobile)}</a>
            </dd>
          </div>
        )}
        <div className={leadStyles["admin-lead-details-wide"]}>
          <dt>Deliver to</dt>
          <dd>{order?.deliverTo ?? "—"}</dd>
        </div>
        <div>
          <dt>Amount paid</dt>
          <dd>{order ? `₹${order.amount.toLocaleString("en-IN")}` : "—"}</dd>
        </div>
        <div>
          <dt>Payment method</dt>
          <dd>{order?.payment ?? "—"}</dd>
        </div>
      </dl>

      {/* The plan itself */}
      <div className={leadStyles["admin-lead-bulk-order"]}>
        <h3>Milk plan</h3>
        <ul>
          <li>
            <span>
              {MILK_TYPE_NAMES[subscription.milkType]} Milk {subscription.quantity} · {planDetail(subscription)}
            </span>
            <strong>{getPlanLength(subscription)}</strong>
          </li>
        </ul>
      </div>
      <dl className={leadStyles["admin-lead-details"]}>
        <div>
          <dt>Frequency</dt>
          <dd>{subscription.frequency}</dd>
        </div>
        <div>
          <dt>Next delivery</dt>
          <dd>{getNextDelivery(subscription, today)}</dd>
        </div>
        <div>
          <dt>Since</dt>
          <dd>{formatDay(subscription.since)}</dd>
        </div>
        <div>
          <dt>Pause</dt>
          <dd>
            {subscription.pauseFrom && subscription.resumeOn
              ? `${formatDay(subscription.pauseFrom)} → resumes ${formatDay(subscription.resumeOn)}`
              : subscription.isPaused
                ? "Paused in the panel"
                : "—"}
          </dd>
        </div>
      </dl>
    </AdminDialog>
  );
}
