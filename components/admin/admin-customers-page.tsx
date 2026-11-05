"use client";

import { useEffect, useMemo, useState } from "react";
import { getNameInitials } from "@/components/account/account-profile";
import {
  INACTIVE_AFTER_DAYS,
  addCustomer,
  getCustomerPlanKind,
  getCustomerStatus,
  markCustomersSeen,
  removeCustomer,
  setCustomerPaused,
  useAdminCustomers,
  type AdminCustomer,
  type CustomerStatus,
} from "@/store/admin-customers-store";
import { getPlanLength, getSubscriptionStatus, useAdminSubscriptions } from "@/store/admin-subscriptions-store";
import { useAdminOrders } from "@/store/admin-orders-store";
import BengaluruAreaPicker, { OTHER_AREA, PincodeCheckNote, pincodeForArea } from "@/components/area-picker/bengaluru-area-picker";
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
  useIsPanelOwner,
  OWNER_ONLY_MESSAGE,
} from "./admin-shared";
import dashboardStyles from "./admin-dashboard.module.css";
import sharedStyles from "./admin-shared.module.css";
// The label / value list and green box of the Leads page's details pop-up, reused for a customer's details
import leadStyles from "./admin-leads-page.module.css";

/*
  Customers (/admin/customers), from the design 05-customers: everyone who orders from Chiranvi.
  (The design's wallet column, card and tab are left out: Chiranvi does not use a wallet.)
    top        search (name, phone or area), Add customer (pop-up form: the area from the Bengaluru list
               fills its pincode; "Others" opens a box to type it), Custom range, Export
    numbers    total customers (new this month), active, average lifetime value, inactive
    table      All / New / Active / Paused / Inactive tabs; 14 a page; name with Customer ID, mobile,
               location, plan (subscription / one-time), orders, last order, status; "View details"
               opens everything they filled in on their Profile page and, for a subscription, the milk
               they subscribe to; "..." pauses, resumes or removes a customer
  New: signed up on the website (Profile saved) with no order yet; opening this page clears the sidebar
  badge. Inactive: no order for more than 30 days. Customers come from store/admin-customers-store.ts.
*/

const PAGE_SIZE = 14;

const STATUS_CLASS_NAMES: Record<CustomerStatus, string> = {
  New: dashboardStyles["admin-status-out-for-delivery"],
  Active: dashboardStyles["admin-status-delivered"],
  Paused: dashboardStyles["admin-status-pending"],
  Inactive: sharedStyles["admin-status-cancelled"],
};

type CustomerTab = "all" | "new" | "active" | "paused" | "inactive";

function lastOrderText(daysAgo: number, orderCount = 1) {
  if (orderCount === 0) return "—";
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  const date = new Date(Date.now() - daysAgo * 86400000);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// area: the choice in the area box; otherArea: typed when it is "Others"
const EMPTY_NEW_CUSTOMER = { name: "", area: "", otherArea: "", pincode: "", phone: "", plan: "A2 (Gir Cow) Milk 1 L" };
// Today's milks (1 L glass bottle or 500 ml), or one-time orders only
const PLAN_CHOICES = [
  "A2 (Gir Cow) Milk 1 L",
  "A2 (Gir Cow) Milk 500 ml",
  "Jersey Milk 1 L",
  "Jersey Milk 500 ml",
  "Skimmed Milk 1 L",
  "Skimmed Milk 500 ml",
  "One-time orders",
];

export default function AdminCustomersPage() {
  return (
    <AdminFeatureGate feature="customers">
      <CustomersPage />
    </AdminFeatureGate>
  );
}

function CustomersPage() {
  const customers = useAdminCustomers();
  const [today] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [rangeTo, setRangeTo] = useState(today);
  const [searchText, setSearchText] = useState("");
  const [tab, setTab] = useState<CustomerTab>("all");
  const [page, setPage] = useState(1);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState(EMPTY_NEW_CUSTOMER);
  const { showToast, toast } = useAdminToast();
  // Sensitive actions only the owner can do (Roles & permissions)
  const isOwner = useIsPanelOwner();
  // The customer whose full details are open ("View details")
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = customers.find((customer) => customer.id === viewingId);

  // Opening this page counts as seeing the new customers: the sidebar badge clears
  useEffect(() => {
    markCustomersSeen();
  }, []);

  const matchingSearch = useMemo(() => {
    const words = searchText.trim().toLowerCase();
    if (!words) return customers;
    const digits = words.replace(/\D/g, "");
    return customers.filter(
      (customer) =>
        `${customer.name} ${customer.area} ${customer.id}`.toLowerCase().includes(words) ||
        (digits.length >= 3 && customer.phone.replace(/\D/g, "").includes(digits)),
    );
  }, [customers, searchText]);

  const shown = matchingSearch.filter((customer) => tab === "all" || getCustomerStatus(customer).toLowerCase() === tab);
  const pageItems = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const activeCount = customers.filter((customer) => getCustomerStatus(customer) === "Active").length;
  const inactiveCount = customers.filter((customer) => getCustomerStatus(customer) === "Inactive").length;
  const newThisMonth = customers.filter((customer) => customer.joinedDaysAgo < today.getDate()).length;
  const averageValue = customers.length
    ? Math.round(customers.reduce((sum, customer) => sum + customer.lifetimeValue, 0) / customers.length)
    : 0;

  function saveNewCustomer() {
    const phoneDigits = newCustomer.phone.replace(/\D/g, "");
    if (!newCustomer.name.trim() || phoneDigits.length !== 10) {
      showToast("Enter the name and a 10-digit phone number");
      return;
    }
    if (newCustomer.pincode && newCustomer.pincode.length !== 6) {
      showToast("Enter a 6-digit pincode, or leave it empty");
      return;
    }
    const area = newCustomer.area === OTHER_AREA ? newCustomer.otherArea.trim() : newCustomer.area;
    const added = addCustomer({
      name: newCustomer.name.trim(),
      area: area || "—",
      pincode: newCustomer.pincode || undefined,
      phone: `${phoneDigits.slice(0, 5)} ${phoneDigits.slice(5, 7)} ${phoneDigits.slice(7)}`,
      plan: newCustomer.plan,
    });
    setIsAddOpen(false);
    setNewCustomer(EMPTY_NEW_CUSTOMER);
    setTab("all");
    setPage(1);
    showToast(`${added.name} added`);
  }

  function exportCustomers() {
    downloadCsv(`chiranvi-customers-${toDateFileName(today)}.csv`, [
      [
        "Customer ID",
        "First name",
        "Last name",
        "Primary mobile",
        "Email",
        "Primary address",
        "Location",
        "Pincode",
        "Plan",
        "Plan details",
        "Lifetime value (₹)",
        "Orders",
        "Last order",
        "Status",
      ],
      ...shown.map((customer: AdminCustomer) => {
        const profile = customer.profile;
        return [
          customer.id,
          profile?.firstName ?? customer.name,
          profile?.lastName ?? "",
          customer.phone,
          profile?.email ?? "",
          profile?.primaryAddress ?? "",
          customer.area,
          profile?.pincode ?? customer.pincode ?? "",
          getCustomerPlanKind(customer),
          customer.plan,
          customer.lifetimeValue,
          customer.orderCount,
          lastOrderText(customer.lastOrderDaysAgo, customer.orderCount),
          getCustomerStatus(customer),
        ];
      }),
    ]);
  }

  return (
    <div className={dashboardStyles["admin-dashboard"]}>
      <AdminPageTop
        title="Customers"
        description="Everyone who orders from Chiranvi"
        searchText={searchText}
        onSearchTextChange={(text) => {
          setSearchText(text);
          setPage(1);
        }}
        searchPlaceholder="Search customer by name or phone..."
        actionLabel="Add customer"
        onAction={() => setIsAddOpen(true)}
        today={today}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        onRangeChange={(from, to) => {
          setRangeFrom(from);
          setRangeTo(to);
        }}
        onExport={exportCustomers}
      />

      <AdminStatCards
        stats={[
          {
            label: "Total customers",
            value: customers.length.toLocaleString("en-IN"),
            note: `↑ ${newThisMonth} new this month`,
            trend: "up",
            icon: ["M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4.5 20.5a7.5 7.5 0 0 1 15 0"],
          },
          {
            label: "Active",
            value: activeCount.toLocaleString("en-IN"),
            note: `${customers.length ? Math.round((activeCount / customers.length) * 100) : 0}% of all customers`,
            trend: "plain",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M8.5 12.2l2.4 2.4 4.8-4.8"],
          },
          {
            label: "Avg lifetime value",
            value: `₹${averageValue.toLocaleString("en-IN")}`,
            note: "↑ 6.2% vs last month",
            trend: "up",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M9 7.5h6", "M9 10.5h6", "M11 7.5c2.6 0 2.6 4.5 0 4.5H9l4.5 4.5"],
          },
          {
            label: "Inactive",
            value: inactiveCount.toLocaleString("en-IN"),
            note: `No order in ${INACTIVE_AFTER_DAYS} days`,
            trend: "plain",
            icon: ["M10 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M3 20.5a7 7 0 0 1 14 0", "M16 11h6"],
          },
        ]}
      />

      <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-customers-heading">
        <div className={dashboardStyles["admin-card-heading-row"]}>
          <div>
            <h2 id="admin-customers-heading" className={dashboardStyles["admin-card-title"]}>
              Customers
            </h2>
            <p className={dashboardStyles["admin-card-subtitle"]}>Search by name, mobile, location or Customer ID</p>
          </div>
          <AdminFilterTabs
            label="Show customers"
            selected={tab}
            onSelect={(newTab) => {
              setTab(newTab);
              setPage(1);
            }}
            tabs={[
              { key: "all", label: "All" },
              { key: "new", label: "New" },
              { key: "active", label: "Active" },
              { key: "paused", label: "Paused" },
              { key: "inactive", label: "Inactive" },
            ]}
          />
        </div>

        <div className={dashboardStyles["admin-table-scroll"]}>
          <table className={dashboardStyles["admin-orders-table"]}>
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Mobile</th>
                <th scope="col">Location</th>
                <th scope="col">Plan</th>
                <th scope="col">Orders</th>
                <th scope="col">Last order</th>
                <th scope="col">Status</th>
                <th scope="col" className={dashboardStyles["admin-orders-actions"]}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((customer, rowIndex) => {
                const status = getCustomerStatus(customer);
                return (
                  <tr key={customer.id}>
                    <td>
                      <span className={sharedStyles["admin-person-cell"]}>
                        <span
                          className={`${sharedStyles["admin-initials"]} ${
                            rowIndex % 2 ? sharedStyles["admin-initials-yellow"] : ""
                          }`}
                          aria-hidden="true"
                        >
                          {getNameInitials(customer.name)}
                        </span>
                        <span>
                          <span className={dashboardStyles["admin-orders-customer"]}>{customer.name}</span>
                          <span className={dashboardStyles["admin-orders-area"]}>{customer.id}</span>
                        </span>
                      </span>
                    </td>
                    <td className={dashboardStyles["admin-orders-muted"]}>
                      <a href={`tel:+91${customer.phone.replace(/\D/g, "")}`} className={sharedStyles["admin-phone-link"]}>
                        {customer.phone}
                      </a>
                    </td>
                    <td>{customer.area}</td>
                    <td>{getCustomerPlanKind(customer)}</td>
                    <td>{customer.orderCount}</td>
                    <td className={dashboardStyles["admin-orders-muted"]}>{lastOrderText(customer.lastOrderDaysAgo, customer.orderCount)}</td>
                    <td>
                      <span className={`${dashboardStyles["admin-status"]} ${STATUS_CLASS_NAMES[status]}`}>{status}</span>
                    </td>
                    <td className={dashboardStyles["admin-orders-actions"]}>
                      <AdminRowMenu
                        label={`Actions for ${customer.name}`}
                        title="Customer"
                        options={[
                          { label: "View details", onSelect: () => setViewingId(customer.id) },
                          customer.isPaused
                            ? {
                                label: "Resume deliveries",
                                onSelect: () => {
                                  setCustomerPaused(customer.id, false);
                                  showToast(`${customer.name}'s deliveries resumed`);
                                },
                              }
                            : {
                                label: "Pause deliveries",
                                onSelect: () => {
                                  setCustomerPaused(customer.id, true);
                                  showToast(`${customer.name}'s deliveries paused`);
                                },
                              },
                          {
                            label: "Remove customer",
                            isDanger: true,
                            permission: "delete",
                            onSelect: () => {
                              if (!isOwner) {
                                showToast(OWNER_ONLY_MESSAGE);
                                return;
                              }
                              removeCustomer(customer.id);
                              showToast(`${customer.name} removed`);
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
                    No customers match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <AdminPagination page={page} pageSize={PAGE_SIZE} total={shown.length} onPageChange={setPage} itemName="customers" />
      </section>

      {viewing && <CustomerDetailsDialog customer={viewing} onClose={() => setViewingId(null)} />}

      {isAddOpen && (
        <AdminDialog title="Add customer" submitLabel="Add customer" onClose={() => setIsAddOpen(false)} onSubmit={saveNewCustomer}>
          <AdminDialogField label="Name">
            <input
              className={adminInputClassName}
              value={newCustomer.name}
              onChange={(changeEvent) => setNewCustomer({ ...newCustomer, name: changeEvent.target.value })}
              autoFocus
            />
          </AdminDialogField>
          <AdminDialogField label="Phone">
            <input
              className={adminInputClassName}
              inputMode="numeric"
              placeholder="10-digit number"
              value={newCustomer.phone}
              onChange={(changeEvent) =>
                setNewCustomer({ ...newCustomer, phone: changeEvent.target.value.replace(/\D/g, "").slice(0, 10) })
              }
            />
          </AdminDialogField>
          <div className={sharedStyles["admin-dialog-field"]}>
            <span id="admin-new-customer-area-label" className={sharedStyles["admin-dialog-label"]}>
              Area
            </span>
            <BengaluruAreaPicker
              area={newCustomer.area}
              onChoose={(chosenArea) => setNewCustomer({ ...newCustomer, area: chosenArea, pincode: pincodeForArea(chosenArea) })}
              labelId="admin-new-customer-area-label"
              look="admin"
            />
          </div>
          {newCustomer.area === OTHER_AREA && (
            <AdminDialogField label="Area name">
              <input
                className={adminInputClassName}
                placeholder="Area or landmark"
                value={newCustomer.otherArea}
                onChange={(changeEvent) => setNewCustomer({ ...newCustomer, otherArea: changeEvent.target.value })}
                autoFocus
              />
            </AdminDialogField>
          )}
          <AdminDialogField label="Pincode">
            <input
              className={adminInputClassName}
              inputMode="numeric"
              placeholder="6-digit pincode"
              value={newCustomer.pincode}
              onChange={(changeEvent) =>
                setNewCustomer({ ...newCustomer, pincode: changeEvent.target.value.replace(/[^0-9]/g, "").slice(0, 6) })
              }
            />
            {pincodeForArea(newCustomer.area) && <PincodeCheckNote look="admin" />}
          </AdminDialogField>
          <AdminDialogField label="Plan">
            <select
              className={adminInputClassName}
              value={newCustomer.plan}
              onChange={(changeEvent) => setNewCustomer({ ...newCustomer, plan: changeEvent.target.value })}
            >
              {PLAN_CHOICES.map((plan) => (
                <option key={plan}>{plan}</option>
              ))}
            </select>
          </AdminDialogField>
        </AdminDialog>
      )}

      {toast}
    </div>
  );
}

/*
  "View details": everything the customer filled in on their Profile page (customers added in the panel or
  from before sign-up show what is known), their Customer ID, orders, last order, status and plan, and
  for a subscription the milk they subscribe to (Subscriptions page, matched by name and area).
*/
function CustomerDetailsDialog({ customer, onClose }: { customer: AdminCustomer; onClose: () => void }) {
  const subscriptions = useAdminSubscriptions();
  const orders = useAdminOrders();
  // Taken once when the pop-up opens (to turn "joined N days ago" into a date)
  const [openedAt] = useState(() => Date.now());
  const profile = customer.profile;
  const status = getCustomerStatus(customer);
  const planKind = getCustomerPlanKind(customer);
  const subscribedMilk =
    planKind === "Subscription"
      ? subscriptions.filter((subscription) => subscription.customerName === customer.name && subscription.area === customer.area)
      : [];
  const joinedOn = new Date(customer.registeredAt ?? openedAt - customer.joinedDaysAgo * 86400000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  // Order history: their orders on the Orders page, newest first. Website orders carry the Customer ID and
  // login number; sample orders from before sign-up only have a name and area.
  const customerDigits = customer.phone.replace(/\D/g, "");
  const orderHistory = orders
    .filter((order) =>
      order.customerId || order.customerMobile
        ? order.customerId === customer.id || order.customerMobile === customerDigits
        : order.customerName === customer.name && order.area === customer.area
    )
    .sort((first, second) => second.placedAt.localeCompare(first.placedAt));
  const formatTime = (isoTime: string) =>
    new Date(isoTime).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  const shown = (value: string | undefined) => (value && value.trim() ? value : "—");
  const phoneLink = (phone: string) => (
    <a href={`tel:+91${phone.replace(/\D/g, "")}`}>{phone}</a>
  );

  return (
    <AdminDialog title={customer.name} submitLabel="Close" onClose={onClose} onSubmit={onClose}>
      <dl className={leadStyles["admin-lead-details"]}>
        <div>
          <dt>Customer ID</dt>
          <dd>{customer.id}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`${dashboardStyles["admin-status"]} ${STATUS_CLASS_NAMES[status]}`}>{status}</span>
          </dd>
        </div>
        <div>
          <dt>First name</dt>
          <dd>{shown(profile?.firstName ?? customer.name.split(" ")[0])}</dd>
        </div>
        <div>
          <dt>Last name</dt>
          <dd>{shown(profile ? profile.lastName : customer.name.split(" ").slice(1).join(" "))}</dd>
        </div>
        <div>
          <dt>Primary mobile</dt>
          <dd>{phoneLink(customer.phone)}</dd>
        </div>
        <div className={leadStyles["admin-lead-details-wide"]}>
          <dt>Email</dt>
          <dd>{profile?.email ? <a href={`mailto:${profile.email}`}>{profile.email}</a> : "—"}</dd>
        </div>
        <div className={leadStyles["admin-lead-details-wide"]}>
          <dt>Primary address</dt>
          <dd>{shown(profile?.primaryAddress)}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{shown(customer.area)}</dd>
        </div>
        <div>
          <dt>Pincode</dt>
          <dd>{shown(profile?.pincode ?? customer.pincode)}</dd>
        </div>
        <div>
          <dt>Joined</dt>
          <dd>{joinedOn}</dd>
        </div>
        <div>
          <dt>Orders</dt>
          <dd>{customer.orderCount}</dd>
        </div>
        <div>
          <dt>Last order</dt>
          <dd>{lastOrderText(customer.lastOrderDaysAgo, customer.orderCount)}</dd>
        </div>
        <div>
          <dt>Lifetime value</dt>
          <dd>₹{customer.lifetimeValue.toLocaleString("en-IN")}</dd>
        </div>
        <div>
          <dt>Plan</dt>
          <dd>{planKind}</dd>
        </div>
        {profile?.dateOfBirth && (
          <div>
            <dt>Date of birth</dt>
            <dd>{new Date(profile.dateOfBirth).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</dd>
          </div>
        )}
        {profile?.familySize && (
          <div>
            <dt>Family size</dt>
            <dd>{profile.familySize}</dd>
          </div>
        )}
        {profile?.preferredPlanType && (
          <div>
            <dt>Preferred plan type</dt>
            <dd>{profile.preferredPlanType}</dd>
          </div>
        )}
      </dl>

      {/* A subscription: the milk they subscribe to */}
      {planKind === "Subscription" && (
        <div className={leadStyles["admin-lead-bulk-order"]}>
          <h3>Subscribed products</h3>
          <ul>
            {subscribedMilk.length > 0 ? (
              subscribedMilk.map((subscription) => (
                <li key={subscription.id}>
                  <span>
                    {subscription.milkType} Milk {subscription.quantity} · {subscription.container} · {subscription.frequency} ·{" "}
                    {getPlanLength(subscription)}
                  </span>
                  <strong>{getSubscriptionStatus(subscription)}</strong>
                </li>
              ))
            ) : (
              <li>
                <span>{customer.plan}</span>
                <strong>{customer.isPaused ? "Paused" : "Active"}</strong>
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Order history: every order, with its items (and Product IDs), amount, payment and delivery */}
      <div className={leadStyles["admin-lead-bulk-order"]}>
        <h3>Order history</h3>
        <ul>
          {orderHistory.length > 0 ? (
            orderHistory.map((order) => (
              <li key={order.orderNumber} className={dashboardStyles["admin-customer-order-history-row"]}>
                <span>
                  <strong>
                    {order.orderNumber} · {formatTime(order.placedAt)}
                  </strong>
                  {order.itemList && order.itemList.length > 0
                    ? order.itemList.map((item) => (
                        <span key={`${item.name}-${item.packSize}`} className={dashboardStyles["admin-customer-order-history-item"]}>
                          {item.name} {item.packSize} × {item.quantity} · ₹{(item.price * item.quantity).toLocaleString("en-IN")}
                          {item.productId && ` · Product ID ${item.productId}`}
                        </span>
                      ))
                    : <span className={dashboardStyles["admin-customer-order-history-item"]}>{order.items}</span>}
                  <span className={dashboardStyles["admin-customer-order-history-item"]}>
                    ₹{order.amount.toLocaleString("en-IN")} paid by {order.payment}
                    {order.statusChangedAt?.Delivered && ` · Delivered ${formatTime(order.statusChangedAt.Delivered)}`}
                  </span>
                </span>
                <strong>{order.status}</strong>
              </li>
            ))
          ) : (
            <li>
              <span>No orders yet</span>
            </li>
          )}
        </ul>
      </div>
    </AdminDialog>
  );
}
