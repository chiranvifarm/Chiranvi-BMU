"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAdminOrders, type AdminOrder } from "@/store/admin-orders-store";
import { AdminFeatureGate } from "./admin-panel-layout";
import { AdminPageTop, AdminStatCards, useAdminToast } from "./admin-shared";
import dashboardStyles from "./admin-dashboard.module.css";
import styles from "./admin-pay-later-page.module.css";

/*
  "Pay later" panel page: customers on a milk plan who chose "Pay later" at checkout (orders.payment_status
  'pay_later', 0066). The plan runs now and the amount is due by the plan's last day (payment_due_by); they
  pay from their account's Billing & payment. Reads the real pay-later orders from the admin orders store.
*/

const rupees = (amount: number) => `₹${Math.round(amount).toLocaleString("en-IN")}`;

function formatIso(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDay(day: string) {
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Whole days from today until the plan's last day (negative = overdue)
function daysUntil(day: string, today: Date) {
  const due = new Date(`${day}T12:00:00`);
  const start = new Date(today);
  start.setHours(12, 0, 0, 0);
  return Math.round((due.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

export default function AdminPayLaterPage() {
  return (
    <AdminFeatureGate feature="subscriptions">
      <PayLaterPage />
    </AdminFeatureGate>
  );
}

function PayLaterPage() {
  const [today] = useState(() => new Date());
  const [searchText, setSearchText] = useState("");
  const { showToast, toast } = useAdminToast();

  async function sendReminder(order: AdminOrder) {
    const { error } = await createClient().rpc("remind_pay_later", { p_order_number: order.orderNumber });
    showToast(error ? "Couldn't send the reminder. Please try again." : `Reminder sent to ${order.customerName}`);
  }

  const customers = useAdminOrders().filter((order) => order.paymentStatus === "pay_later");
  const words = searchText.trim().toLowerCase();
  const shown = customers.filter(
    (order) => !words || `${order.customerName} ${order.customerId ?? ""} ${order.items} ${order.area}`.toLowerCase().includes(words),
  );

  const { totalDue, dueSoon, overdue } = useMemo(() => {
    let totalDue = 0;
    let dueSoon = 0;
    let overdue = 0;
    for (const order of customers) {
      totalDue += order.amount;
      if (order.paymentDueBy) {
        const left = daysUntil(order.paymentDueBy, today);
        if (left < 0) overdue += 1;
        else if (left <= 7) dueSoon += 1;
      }
    }
    return { totalDue, dueSoon, overdue };
  }, [customers, today]);

  return (
    <div className={dashboardStyles["admin-dashboard"]}>
      <AdminPageTop
        title="Pay later"
        description="Customers on a plan who chose to pay later — the amount is due by their plan's last day"
        searchText={searchText}
        onSearchTextChange={setSearchText}
        searchPlaceholder="Search customer, Customer ID or plan..."
      />

      <AdminStatCards
        stats={[
          {
            label: "Pay-later customers",
            value: customers.length.toLocaleString("en-IN"),
            note: "On a running plan, paying later",
            trend: "plain",
            icon: ["M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M2 21a7 7 0 0 1 14 0", "M16 3.5a4 4 0 0 1 0 7.8", "M22 21a7 7 0 0 0-5-6.7"],
          },
          {
            label: "Amount pending",
            value: rupees(totalDue),
            note: "Due by each plan's last day",
            trend: "plain",
            icon: ["M6 4h8a4 4 0 0 1 0 8H6", "M6 8h12", "M6 12h4l6 8"],
          },
          {
            label: "Due within 7 days",
            value: dueSoon.toLocaleString("en-IN"),
            note: "Send a reminder soon",
            trend: "plain",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7.5V12l3 2"],
          },
          {
            label: "Overdue",
            value: overdue.toLocaleString("en-IN"),
            note: overdue > 0 ? "Past the plan's last day" : "None overdue",
            trend: overdue > 0 ? "bad" : "plain",
            icon: ["M12 3l9 16H3L12 3Z", "M12 10v4", "M12 17h.01"],
          },
        ]}
      />

      <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-pay-later-heading">
        <div className={dashboardStyles["admin-card-heading-row"]}>
          <div>
            <h2 id="admin-pay-later-heading" className={dashboardStyles["admin-card-title"]}>
              Pay-later customers
            </h2>
            <p className={dashboardStyles["admin-card-subtitle"]}>Plans running now with the amount still due</p>
          </div>
        </div>

        <div className={dashboardStyles["admin-table-scroll"]}>
          <table className={`${dashboardStyles["admin-orders-table"]} ${styles["pay-later-table"]}`}>
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Plan</th>
                <th scope="col">Amount due</th>
                <th scope="col">Started</th>
                <th scope="col">Pay by</th>
                <th scope="col">Status</th>
                <th scope="col" className={styles["pay-later-action-head"]}>
                  Reminder
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((order: AdminOrder) => {
                const left = order.paymentDueBy ? daysUntil(order.paymentDueBy, today) : null;
                const isOverdue = left !== null && left < 0;
                return (
                  <tr key={order.orderNumber} className={isOverdue ? styles["pay-later-overdue-row"] : ""}>
                    <td>
                      <span className={dashboardStyles["admin-orders-customer"]}>{order.customerName}</span>
                      <span className={dashboardStyles["admin-orders-area"]}>
                        {order.customerId ?? "—"} · {order.area}
                      </span>
                    </td>
                    <td>
                      <span className={styles["pay-later-plan"]}>{order.items}</span>
                      <span className={dashboardStyles["admin-orders-area"]}>{order.orderNumber}</span>
                    </td>
                    <td className={styles["pay-later-amount"]}>{rupees(order.amount)}</td>
                    <td className={dashboardStyles["admin-orders-muted"]}>{formatIso(order.placedAt)}</td>
                    <td className={dashboardStyles["admin-orders-muted"]}>{order.paymentDueBy ? formatDay(order.paymentDueBy) : "—"}</td>
                    <td>
                      {left === null ? (
                        <span className={dashboardStyles["admin-payment-pending"]}>Pending</span>
                      ) : isOverdue ? (
                        <span className={dashboardStyles["admin-payment-failed"]}>Overdue by {Math.abs(left)}d</span>
                      ) : (
                        <span className={dashboardStyles["admin-payment-pending"]}>{left === 0 ? "Due today" : `Pending · ${left}d left`}</span>
                      )}
                    </td>
                    <td className={styles["pay-later-action-cell"]}>
                      <button type="button" className={styles["pay-later-remind-button"]} onClick={() => void sendReminder(order)}>
                        Send reminder
                      </button>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className={styles["pay-later-empty"]}>
                    No pay-later customers yet. Plans placed with &ldquo;Pay later&rdquo; show here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {toast}
    </div>
  );
}
