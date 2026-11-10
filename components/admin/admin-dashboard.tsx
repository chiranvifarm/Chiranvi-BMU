"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useCurrentStaffAccess } from "@/store/staff-access-store";
import { useDashboardAlerts, useDashboardNumbers } from "./admin-dashboard-data";
import {
  ADMIN_ORDER_STATUSES,
  changeAdminOrderStatus,
  useRealAdminOrders,
  type AdminOrderStatus,
} from "@/store/admin-orders-store";
import { useTodayDeliveries } from "@/store/admin-deliveries-store";
import { useDeliveryRoutes } from "@/store/admin-routes-store";
import sharedStyles from "./admin-shared.module.css";
import { AdminNotificationsBell } from "./admin-shared";
import AdminDateRangePicker from "./admin-date-range-picker";
import styles from "./admin-dashboard.module.css";

/*
  Chiranvi Panel dashboard (/admin), from the design 01-dashboard:
    header      greeting with the person's name and today's date; customer search (filters the recent
                orders), notifications bell (the alerts), "+ New order"; the date range and Export
    alerts      missed deliveries, low stock, pause requests, each with its action
    numbers     eight cards (deliveries, revenue, plans ending, orders, subscriptions, churn, failed payments)
    revenue     this week against last week (line chart; hover a day to see its amount)
    deliveries  today's delivered / pending / missed ring
    orders      the five newest orders (shared with the Orders page, store/admin-orders-store.ts);
                "..." changes an order's status; Export downloads them as a CSV file
  Everything shown is real data from the database, without the samples (admin-dashboard-data.ts).
*/

const STATUS_CLASS_NAMES: Record<AdminOrderStatus, string> = {
  Delivered: styles["admin-status-delivered"],
  "Out for delivery": styles["admin-status-out-for-delivery"],
  Packed: styles["admin-status-packed"],
  Placed: styles["admin-status-pending"],
  Cancelled: sharedStyles["admin-status-cancelled"],
};

// 6:47 AM
function formatOrderTime(placedAt: string) {
  return new Date(placedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();
}

function getGreeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// 13 – 19 Oct 2026 (or 28 Sep – 4 Oct 2026 across months)
function formatDateRange(from: Date, to: Date) {
  const sameMonth =
    from.getMonth() === to.getMonth() &&
    from.getFullYear() === to.getFullYear();
  const day = (date: Date) => date.getDate();
  const month = (date: Date) =>
    date.toLocaleDateString("en-IN", { month: "short" });
  return sameMonth
    ? `${day(from)} – ${day(to)} ${month(to)} ${to.getFullYear()}`
    : `${day(from)} ${month(from)} – ${day(to)} ${month(to)} ${to.getFullYear()}`;
}

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function AdminDashboard() {
  const staffAccess = useCurrentStaffAccess();
  const [today] = useState(() => new Date());
  const [searchText, setSearchText] = useState("");
  const allOrders = useRealAdminOrders();
  const alerts = useDashboardAlerts();
  const { stats, revenueThisWeek, revenueLastWeek } = useDashboardNumbers();
  const orders = useMemo(() => allOrders.slice(0, 5), [allOrders]);
  const [isRangePickerOpen, setIsRangePickerOpen] = useState(false);
  // The chosen date range: the last seven days at first
  const [rangeFrom, setRangeFrom] = useState(
    () => new Date(today.getTime() - 6 * 86400000),
  );
  const [rangeTo, setRangeTo] = useState(today);
  const [openOrderMenu, setOpenOrderMenu] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState("");

  // Close the open pop-ups on Escape or a click elsewhere
  useEffect(() => {
    function closePopups(event: Event) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof PointerEvent &&
        (event.target as Element).closest?.("[data-admin-popup]")
      )
        return;
      setIsRangePickerOpen(false);
      setOpenOrderMenu(null);
    }
    document.addEventListener("pointerdown", closePopups);
    window.addEventListener("keydown", closePopups);
    return () => {
      document.removeEventListener("pointerdown", closePopups);
      window.removeEventListener("keydown", closePopups);
    };
  }, []);

  // A short message at the bottom of the screen, gone after 3 seconds
  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  const filteredOrders = useMemo(() => {
    const words = searchText.trim().toLowerCase();
    if (!words) return orders;
    return orders.filter((order) =>
      `${order.customerName} ${order.area} ${order.orderNumber}`
        .toLowerCase()
        .includes(words),
    );
  }, [orders, searchText]);

  if (!staffAccess) return null;

  const dateLine = today.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const rangeLabel = formatDateRange(rangeFrom, rangeTo);

  function changeOrderStatus(orderNumber: string, status: AdminOrderStatus) {
    changeAdminOrderStatus(orderNumber, status);
    setOpenOrderMenu(null);
    setToastMessage(`${orderNumber} marked as ${status.toLowerCase()}`);
  }

  // Export: the recent orders as a CSV file (opens in Excel / Google Sheets)
  function exportOrders() {
    const header = [
      "Order",
      "Time",
      "Customer",
      "Area",
      "Items",
      "Amount (₹)",
      "Payment",
      "Status",
    ];
    const rows = orders.map((order) => [
      order.orderNumber,
      formatOrderTime(order.placedAt),
      order.customerName,
      order.area,
      order.items,
      String(order.amount),
      order.payment,
      order.status,
    ]);
    const csv = [header, ...rows]
      .map((row) =>
        row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }),
    );
    link.download = `chiranvi-orders-${toDateInputValue(rangeTo)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className={styles["admin-dashboard"]}>
      {/* Header */}
      <div className={styles["admin-dashboard-header"]}>
        <div>
          <h1 className={styles["admin-dashboard-greeting"]}>
            {getGreeting(today.getHours())}, {staffAccess.name}
          </h1>
          <p className={styles["admin-dashboard-date"]}>
            {dateLine} · Here&rsquo;s how Chiranvi is doing
          </p>
        </div>

        <div className={styles["admin-dashboard-header-tools"]}>
          <label className={styles["admin-search"]}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" />
              <path d="m20 20-4-4" />
            </svg>
            <input
              type="search"
              value={searchText}
              placeholder="Search customer by name or phone..."
              aria-label="Search customer"
              onChange={(changeEvent) =>
                setSearchText(changeEvent.target.value)
              }
            />
          </label>

          {/* Bell: new orders and customers, then the alerts (shared with the other panel pages) */}
          <AdminNotificationsBell />

          <Link
            href="/admin/orders"
            className={styles["admin-new-order-button"]}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New order
          </Link>
        </div>
      </div>

      <div className={styles["admin-dashboard-range-row"]}>
        <div className={styles["admin-popup-anchor"]} data-admin-popup>
          <button
            type="button"
            className={styles["admin-range-button"]}
            aria-expanded={isRangePickerOpen}
            onClick={() => setIsRangePickerOpen((isOpen) => !isOpen)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16v14H4z" />
              <path d="M4 10h16M8 3.5v4M16 3.5v4" />
            </svg>
            Custom range
          </button>
          {isRangePickerOpen && (
            <AdminDateRangePicker
              rangeFrom={rangeFrom}
              rangeTo={rangeTo}
              today={today}
              onChooseRange={(from, to) => {
                setRangeFrom(from);
                setRangeTo(to);
                setIsRangePickerOpen(false);
              }}
            />
          )}
        </div>
        <span className={styles["admin-range-label"]}>{rangeLabel}</span>
        <button
          type="button"
          className={styles["admin-export-button"]}
          onClick={exportOrders}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
            <path d="M4.5 19.5h15" />
          </svg>
          Export
          <svg
            viewBox="0 0 24 24"
            className={styles["admin-export-chevron"]}
            aria-hidden="true"
          >
            <path d="m7 10 5 5 5-5" />
          </svg>
        </button>
      </div>

      {/* Alerts: only what needs acting on */}
      {alerts.length > 0 && (
        <ul className={styles["admin-alerts"]}>
          {alerts.map((alert) => (
            <li
              key={alert.title}
              className={`${styles["admin-alert"]} ${styles[`admin-alert-${alert.tone}`]}`}
            >
              <span
                className={`${styles["admin-alert-icon"]} ${styles[`admin-alert-icon-${alert.tone}`]}`}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {alert.icon.map((path) => (
                    <path key={path} d={path} />
                  ))}
                </svg>
              </span>
              <span className={styles["admin-alert-text"]}>
                <span className={styles["admin-alert-title"]}>{alert.title}</span>
                <span className={styles["admin-alert-detail"]}>
                  {alert.detail}
                </span>
              </span>
              <Link
                href={alert.href}
                className={`${styles["admin-alert-action"]} ${styles[`admin-alert-action-${alert.tone}`]}`}
              >
                {alert.action} →
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Numbers */}
      <ul className={styles["admin-stats"]}>
        {stats.map((stat) => (
          <li key={stat.label} className={styles["admin-stat"]}>
            <span className={styles["admin-stat-label"]}>{stat.label}</span>
            <span className={styles["admin-stat-value"]}>{stat.value}</span>
            <span
              className={`${styles["admin-stat-note"]} ${styles[`admin-stat-note-${stat.trend}`]}`}
            >
              {stat.note}
            </span>
            <span
              className={`${styles["admin-stat-icon"]} ${styles[`admin-stat-icon-${stat.iconTone}`]}`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {stat.icon.map((path) => (
                  <path key={path} d={path} />
                ))}
              </svg>
            </span>
          </li>
        ))}
      </ul>

      <div className={styles["admin-charts-row"]}>
        <RevenueChart today={today} revenueThisWeek={revenueThisWeek} revenueLastWeek={revenueLastWeek} />
        <DeliveriesGauge />
      </div>

      {/* Recent orders */}
      <section
        className={styles["admin-card"]}
        aria-labelledby="admin-recent-orders-heading"
      >
        <div className={styles["admin-card-heading-row"]}>
          <h2
            id="admin-recent-orders-heading"
            className={styles["admin-card-title"]}
          >
            Recent orders
          </h2>
          <Link href="/admin/orders" className={styles["admin-view-all"]}>
            View all →
          </Link>
        </div>
        <div className={styles["admin-table-scroll"]}>
          <table className={styles["admin-orders-table"]}>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Time</th>
                <th scope="col">Customer</th>
                <th scope="col">Items</th>
                <th scope="col">Amount</th>
                <th scope="col">Payment</th>
                <th scope="col">Status</th>
                <th scope="col" className={styles["admin-orders-actions"]}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr key={order.orderNumber}>
                  <td className={styles["admin-orders-muted"]}>
                    {order.orderNumber}
                  </td>
                  <td className={styles["admin-orders-muted"]}>{formatOrderTime(order.placedAt)}</td>
                  <td>
                    <span className={styles["admin-orders-customer"]}>
                      {order.customerName}
                    </span>
                    <span className={styles["admin-orders-area"]}>
                      {order.area}
                    </span>
                  </td>
                  <td>{order.items}</td>
                  <td className={styles["admin-orders-amount"]}>
                    ₹{order.amount}
                  </td>
                  <td>{order.payment}</td>
                  <td>
                    <span
                      className={`${styles["admin-status"]} ${STATUS_CLASS_NAMES[order.status]}`}
                    >
                      {order.status}
                    </span>
                  </td>
                  <td className={styles["admin-orders-actions"]}>
                    <div
                      className={styles["admin-popup-anchor"]}
                      data-admin-popup
                    >
                      <button
                        type="button"
                        className={styles["admin-more-button"]}
                        aria-label={`Change status of ${order.orderNumber}`}
                        aria-expanded={openOrderMenu === order.orderNumber}
                        onClick={() =>
                          setOpenOrderMenu((current) =>
                            current === order.orderNumber
                              ? null
                              : order.orderNumber,
                          )
                        }
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <circle cx="5" cy="12" r="1.9" />
                          <circle cx="12" cy="12" r="1.9" />
                          <circle cx="19" cy="12" r="1.9" />
                        </svg>
                      </button>
                      {openOrderMenu === order.orderNumber && (
                        <div
                          className={`${styles["admin-popup"]} ${styles["admin-order-menu"]}`}
                        >
                          <p className={styles["admin-popup-title"]}>Mark as</p>
                          {ADMIN_ORDER_STATUSES.map((status) => (
                            <button
                              key={status}
                              type="button"
                              disabled={status === order.status}
                              onClick={() =>
                                changeOrderStatus(order.orderNumber, status)
                              }
                            >
                              {status}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={8} className={styles["admin-orders-empty"]}>
                    {searchText ? <>No recent orders match &ldquo;{searchText}&rdquo;.</> : "No orders yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p
        className={styles["admin-toast"]}
        role="status"
        data-visible={toastMessage ? "true" : "false"}
      >
        {toastMessage}
      </p>
    </div>
  );
}

/*
  Revenue line chart: this week (dark green line, shaded below) against last week (dashed yellow), its
  scale made to fit the amounts. Today's amount is shown in a dark label; hovering another day moves the label there.
  The chart is drawn at its real size on screen (one chart unit = one pixel), so its labels keep the
  same text size as the rest of the panel however wide the card is.
*/
// The top of the chart's scale: a round number with some room above the biggest amount
function chartScaleTop(biggestAmount: number) {
  if (biggestAmount <= 0) return 1000;
  const roomy = biggestAmount * 1.2;
  const step = 10 ** Math.floor(Math.log10(roomy)) / 2;
  return Math.ceil(roomy / step) * step;
}

// ₹500, ₹2.5k, ₹60k
function formatChartAmount(amount: number) {
  return Math.abs(amount) >= 1000 ? `₹${Number((amount / 1000).toFixed(1))}k` : `₹${Math.round(amount)}`;
}

function RevenueChart({
  today,
  revenueThisWeek,
  revenueLastWeek,
}: {
  today: Date;
  revenueThisWeek: number[];
  revenueLastWeek: number[];
}) {
  const [hoveredDay, setHoveredDay] = useState(revenueThisWeek.length - 1);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const [chartSize, setChartSize] = useState({ width: 600, height: 210 });
  useEffect(() => {
    const chartArea = chartAreaRef.current;
    if (!chartArea) return;
    const measure = () =>
      setChartSize({
        width: chartArea.clientWidth,
        height: chartArea.clientHeight,
      });
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(chartArea);
    return () => resizeObserver.disconnect();
  }, []);
  const { width, height } = chartSize;
  const left = 46;
  const right = 14;
  const top = 18;
  const bottom = 30;
  // A day of refunds can be below zero
  const minimum = Math.min(0, ...revenueThisWeek, ...revenueLastWeek);
  const maximum = chartScaleTop(Math.max(...revenueThisWeek, ...revenueLastWeek));
  const scaleLines = [4, 3, 2, 1, 0].map((step) => minimum + ((maximum - minimum) * step) / 4);
  const x = (dayIndex: number) =>
    left + (dayIndex * (width - left - right)) / (revenueThisWeek.length - 1);
  const y = (amount: number) =>
    top + ((maximum - amount) * (height - top - bottom)) / (maximum - minimum);
  const line = (values: number[]) =>
    values
      .map((value, index) => `${index ? "L" : "M"}${x(index)},${y(value)}`)
      .join(" ");
  const dayLabels = revenueThisWeek.map((_, index) => {
    const date = new Date(
      today.getTime() - (revenueThisWeek.length - 1 - index) * 86400000,
    );
    return `${date.toLocaleDateString("en-IN", { weekday: "short" })} ${date.getDate()}`;
  });
  const isToday = hoveredDay === revenueThisWeek.length - 1;
  const tooltipText = `${isToday ? "Today" : dayLabels[hoveredDay]} ₹${revenueThisWeek[hoveredDay].toLocaleString("en-IN")}`;
  const tooltipWidth = tooltipText.length * 7.8 + 20;

  return (
    <section
      className={`${styles["admin-card"]} ${styles["admin-revenue"]}`}
      aria-labelledby="admin-revenue-heading"
    >
      <div className={styles["admin-card-heading-row"]}>
        <div>
          <h2 id="admin-revenue-heading" className={styles["admin-card-title"]}>
            Revenue
          </h2>
          <p className={styles["admin-card-subtitle"]}>
            This week vs last week
          </p>
        </div>
        <p className={styles["admin-chart-legend"]}>
          <span className={styles["admin-chart-legend-this-week"]}>
            This week
          </span>
          <span className={styles["admin-chart-legend-last-week"]}>
            Last week
          </span>
        </p>
      </div>

      <div ref={chartAreaRef} className={styles["admin-revenue-chart-area"]}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className={styles["admin-revenue-chart"]}
          role="img"
          aria-label="Revenue this week against last week"
        >
          <defs>
            <linearGradient id="admin-revenue-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#285c3a" stopOpacity="0.2" />
              <stop offset="1" stopColor="#285c3a" stopOpacity="0" />
            </linearGradient>
          </defs>
          {scaleLines.map((amount) => (
            <g key={amount}>
              <line
                x1={left}
                x2={width - right}
                y1={y(amount)}
                y2={y(amount)}
                className={styles["admin-chart-grid"]}
              />
              <text
                x={left - 8}
                y={y(amount) + 4}
                textAnchor="end"
                className={styles["admin-chart-axis"]}
              >
                {formatChartAmount(amount)}
              </text>
            </g>
          ))}
          <path
            d={`${line(revenueThisWeek)} L${x(revenueThisWeek.length - 1)},${y(minimum)} L${x(0)},${y(minimum)} Z`}
            fill="url(#admin-revenue-fill)"
          />
          <path
            d={line(revenueLastWeek)}
            className={styles["admin-chart-last-week"]}
          />
          <path
            d={line(revenueThisWeek)}
            className={styles["admin-chart-this-week"]}
          />
          {revenueThisWeek.map((amount, index) => (
            <g key={index}>
              <circle
                cx={x(index)}
                cy={y(amount)}
                r={index === revenueThisWeek.length - 1 ? 5.5 : 4}
                className={
                  index === revenueThisWeek.length - 1
                    ? styles["admin-chart-point-today"]
                    : styles["admin-chart-point"]
                }
              />
              {/* Wide invisible strip, so the day is easy to hover */}
              <rect
                x={x(index) - 30}
                y={top}
                width={60}
                height={height - top - bottom}
                fill="transparent"
                onPointerEnter={() => setHoveredDay(index)}
                onPointerLeave={() => setHoveredDay(revenueThisWeek.length - 1)}
              />
              <text
                x={x(index)}
                y={height - 8}
                textAnchor="middle"
                className={styles["admin-chart-axis"]}
              >
                {dayLabels[index]}
              </text>
            </g>
          ))}
          <g
            transform={`translate(${Math.max(0, Math.min(x(hoveredDay) - tooltipWidth + 12, width - right - tooltipWidth))}, ${Math.max(0, y(revenueThisWeek[hoveredDay]) - 34)})`}
            pointerEvents="none"
          >
            <rect
              width={tooltipWidth}
              height={24}
              rx={6}
              className={styles["admin-chart-tooltip"]}
            />
            <text
              x={tooltipWidth / 2}
              y={16}
              textAnchor="middle"
              className={styles["admin-chart-tooltip-text"]}
            >
              {tooltipText}
            </text>
          </g>
        </svg>
      </div>
    </section>
  );
}

/*
  Today's deliveries (design): a LIVE tag, a half-circle gauge (delivered green, pending yellow, missed
  red) with the share delivered in the middle, three tiles with the counts and shares, and which routes
  missed deliveries. Live from the Deliveries page (store/admin-deliveries-store.ts).
*/
function DeliveriesGauge() {
  const deliveries = useTodayDeliveries();
  const routes = useDeliveryRoutes();
  const scheduled = deliveries.length;
  const delivered = deliveries.filter((delivery) => delivery.status === "Delivered").length;
  const missedDeliveries = deliveries.filter((delivery) => delivery.status === "Missed");
  const missed = missedDeliveries.length;
  const pending = scheduled - delivered - missed;
  const routeCount = new Set(deliveries.map((delivery) => delivery.routeId)).size;
  const missedRoutes = [...new Set(missedDeliveries.map((delivery) => delivery.routeId))].map(
    (routeId) => routes.find((route) => route.id === routeId)?.name ?? routeId,
  );
  const shareOf = (count: number) => (scheduled ? (count / scheduled) * 100 : 0);

  // The gauge's three parts, in hundredths of the half circle; a tiny part still shows as a sliver
  const gap = 0.8;
  const parts = [
    { key: "delivered", share: shareOf(delivered) },
    { key: "pending", share: shareOf(pending) },
    { key: "missed", share: shareOf(missed) },
  ]
    .filter((part) => part.share > 0)
    .map((part) => ({ ...part, length: Math.max(part.share, 1.6) }));
  const total = parts.reduce((sum, part) => sum + part.length, 0) + gap * (parts.length - 1);
  let start = 0;
  const arcs = parts.map((part) => {
    const length = (part.length / total) * 100;
    const arc = { key: part.key, length, start };
    start += length + (gap / total) * 100;
    return arc;
  });

  const tiles = [
    { key: "delivered", label: "Delivered", count: delivered },
    { key: "pending", label: "Pending", count: pending },
    { key: "missed", label: "Missed", count: missed },
  ];

  return (
    <section className={`${styles["admin-card"]} ${styles["admin-deliveries"]}`} aria-labelledby="admin-deliveries-heading">
      <div className={styles["admin-deliveries-heading-row"]}>
        <div>
          <h2 id="admin-deliveries-heading" className={styles["admin-card-title"]}>
            Today&rsquo;s deliveries
          </h2>
          <p className={styles["admin-card-subtitle"]}>
            {scheduled.toLocaleString("en-IN")} scheduled · {routeCount} routes
          </p>
        </div>
        <span className={styles["admin-deliveries-live"]}>
          <span className={styles["admin-deliveries-live-dot"]} aria-hidden="true" />
          Live
        </span>
      </div>

      <div className={styles["admin-gauge"]}>
        <svg viewBox="0 0 220 120" aria-hidden="true">
          <path d="M 20 110 A 90 90 0 0 1 200 110" pathLength={100} className={styles["admin-gauge-track"]} />
          {arcs.map((arc) => (
            <path
              key={arc.key}
              d="M 20 110 A 90 90 0 0 1 200 110"
              pathLength={100}
              className={styles[`admin-gauge-${arc.key}`]}
              strokeDasharray={`${arc.length} 100`}
              strokeDashoffset={-arc.start}
            />
          ))}
        </svg>
        <span className={styles["admin-gauge-text"]}>
          <span className={styles["admin-gauge-percent"]}>{shareOf(delivered).toFixed(1)}%</span>
          <span className={styles["admin-gauge-caption"]}>
            {delivered.toLocaleString("en-IN")} of {scheduled.toLocaleString("en-IN")} delivered
          </span>
        </span>
      </div>

      <ul className={styles["admin-deliveries-tiles"]}>
        {tiles.map((tile) => (
          <li key={tile.key} className={`${styles["admin-deliveries-tile"]} ${styles[`admin-deliveries-tile-${tile.key}`]}`}>
            <span className={styles["admin-deliveries-tile-label"]}>{tile.label}</span>
            <span className={styles["admin-deliveries-tile-numbers"]}>
              <span className={styles["admin-deliveries-tile-count"]}>{tile.count.toLocaleString("en-IN")}</span>
              <span className={styles["admin-deliveries-tile-share"]}>{shareOf(tile.count).toFixed(1)}%</span>
            </span>
          </li>
        ))}
      </ul>

      <p className={styles["admin-deliveries-footer"]}>
        {missed ? (
          <>
            {missed} missed on {missedRoutes.join(", ")} ·{" "}
            <Link href="/admin/deliveries" className={styles["admin-deliveries-link"]}>
              Reassign agent →
            </Link>
          </>
        ) : (
          <>
            Nothing missed today ·{" "}
            <Link href="/admin/deliveries" className={styles["admin-deliveries-link"]}>
              Open deliveries →
            </Link>
          </>
        )}
      </p>
    </section>
  );
}
