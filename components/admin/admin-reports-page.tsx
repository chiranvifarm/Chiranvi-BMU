"use client";

import { useEffect, useMemo, useState } from "react";
import { useRealAdminOrders } from "@/store/admin-orders-store";
import { useRealSubscriptions } from "@/store/admin-subscriptions-store";
import { useRealAdminCustomers } from "@/store/admin-customers-store";
import { useRealAdminLeads } from "@/store/admin-leads-store";
import { useAdminPayments } from "@/store/admin-payments-store";
import { getDeliveriesForRange, readEarlierDeliveries, useTodayDeliveries, type Delivery } from "@/store/admin-deliveries-store";
import { useDeliveryAgents, useDeliveryRoutes } from "@/store/admin-routes-store";
import { useStaffList } from "@/store/admin-staff-store";
import {
  REPORT_FORMATS,
  REPORT_FREQUENCIES,
  addScheduledReport,
  getNextRun,
  removeScheduledReport,
  setScheduledReportPaused,
  useScheduledReports,
  type ReportFormat,
  type ReportFrequency,
} from "@/store/admin-scheduled-reports-store";
import { AdminFeatureGate } from "./admin-panel-layout";
import {
  AdminDialog,
  AdminDialogField,
  AdminPageTop,
  AdminRowMenu,
  adminInputClassName,
  downloadCsv,
  formatDateRange,
  toDateFileName,
  useAdminToast,
} from "./admin-shared";
import { REPORTS, buildReport, reportToCsvRows, type ReportData, type ReportKey } from "./admin-reports-data";
import { useWebsiteProducts } from "./admin-dashboard-data";
import dashboardStyles from "./admin-dashboard.module.css";
import sharedStyles from "./admin-shared.module.css";
import styles from "./admin-reports-page.module.css";

/*
  Reports (/admin/reports), from the design 12-reports: download any report or have it sent
  automatically.
    top        search (reports), Schedule report (pop-up form), Custom range (this month at first), Export
               (the headline numbers of every report in one file)
    cards      nine reports; View opens it over the blurred page (numbers and tables), Export saves it as a
               CSV file (opens in Excel / Google Sheets). Payments replaces the design's "Wallet &
               payments" (no wallet).
    table      scheduled reports: frequency, who gets it, next run, format, Active / Paused; "..." pauses,
               resumes or removes. Sending needs the backend; for now this is the list of what will be sent.
  The reports are worked out in admin-reports-data.ts from real data only: the database's records without the
  samples, so new orders, plans, customers and leads count by themselves.
*/

const SEND_TO_OPTIONS = ["Owner", "Owner (WhatsApp)", "Manager", "Owner, Manager"];

function nextRunText(frequency: ReportFrequency, now: Date) {
  const next = getNextRun(frequency, now);
  if (!next) return "On trigger";
  const isToday = next.toDateString() === now.toDateString();
  return isToday
    ? `Today, ${next.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).toUpperCase()}`
    : next.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
}

export default function AdminReportsPage() {
  return (
    <AdminFeatureGate feature="reports">
      <ReportsPage />
    </AdminFeatureGate>
  );
}

function ReportsPage() {
  const orders = useRealAdminOrders();
  const subscriptions = useRealSubscriptions();
  const customers = useRealAdminCustomers();
  const leads = useRealAdminLeads();
  const payments = useAdminPayments();
  const products = useWebsiteProducts();
  const todaysDeliveries = useTodayDeliveries();
  const routes = useDeliveryRoutes();
  const agents = useDeliveryAgents();
  const staff = useStaffList();
  const scheduledReports = useScheduledReports();

  const [today] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [rangeTo, setRangeTo] = useState(today);
  const [searchText, setSearchText] = useState("");
  const [viewing, setViewing] = useState<ReportKey | null>(null);
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [newSchedule, setNewSchedule] = useState({
    name: REPORTS[0].title,
    frequency: "monday" as ReportFrequency,
    sentTo: SEND_TO_OPTIONS[0],
    format: "PDF" as ReportFormat,
  });
  const { showToast, toast } = useAdminToast();

  // Earlier days' stops in the chosen dates (today's come from the live list)
  const [earlierDeliveries, setEarlierDeliveries] = useState<Delivery[]>([]);
  useEffect(() => {
    let isStillWanted = true;
    void readEarlierDeliveries(rangeFrom, rangeTo).then((deliveries) => {
      if (isStillWanted) setEarlierDeliveries(deliveries);
    });
    return () => {
      isStillWanted = false;
    };
  }, [rangeFrom, rangeTo]);

  const rangeText = formatDateRange(rangeFrom, rangeTo);
  const data: ReportData = useMemo(
    () => ({
      from: rangeFrom,
      to: rangeTo,
      orders,
      subscriptions,
      customers,
      leads,
      payments,
      products,
      deliveries: [...getDeliveriesForRange(rangeFrom, rangeTo, todaysDeliveries), ...earlierDeliveries],
      routes,
      agents,
      staff,
    }),
    [rangeFrom, rangeTo, orders, subscriptions, customers, leads, payments, products, todaysDeliveries, earlierDeliveries, routes, agents, staff],
  );

  const words = searchText.trim().toLowerCase();
  const shownReports = REPORTS.filter((report) => !words || `${report.title} ${report.description}`.toLowerCase().includes(words));
  const shownSchedules = scheduledReports.filter(
    (report) => !words || `${report.name} ${report.sentTo} ${report.format}`.toLowerCase().includes(words),
  );
  const updatedText = `Updated today, ${today.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).toUpperCase()}`;

  function exportReport(key: ReportKey) {
    const report = REPORTS.find((existing) => existing.key === key)!;
    downloadCsv(
      `chiranvi-${report.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${toDateFileName(rangeFrom)}-to-${toDateFileName(rangeTo)}.csv`,
      reportToCsvRows(report.title, rangeText, buildReport(key, data)),
    );
    showToast(`${report.title} downloaded`);
  }

  // The top Export: every report's headline numbers in one file
  function exportAll() {
    const rows: (string | number)[][] = [["Chiranvi Farm · All reports"], [rangeText]];
    REPORTS.forEach((report) => {
      rows.push([], [report.title]);
      buildReport(report.key, data).headline.forEach(({ label, value }) => rows.push([label, value]));
    });
    downloadCsv(`chiranvi-all-reports-${toDateFileName(rangeFrom)}-to-${toDateFileName(rangeTo)}.csv`, rows);
    showToast("All reports downloaded");
  }

  function saveSchedule() {
    if (!newSchedule.name.trim()) {
      showToast("Choose a report");
      return;
    }
    const added = addScheduledReport({ ...newSchedule, name: newSchedule.name.trim() });
    setIsScheduleOpen(false);
    showToast(`${added.name} scheduled · ${REPORT_FREQUENCIES.find((frequency) => frequency.key === added.frequency)?.label}`);
  }

  return (
    <div className={dashboardStyles["admin-dashboard"]}>
      <AdminPageTop
        title="Reports"
        description="Download any report or have it sent to you automatically"
        searchText={searchText}
        onSearchTextChange={setSearchText}
        searchPlaceholder="Search reports..."
        actionLabel="Schedule report"
        onAction={() => setIsScheduleOpen(true)}
        today={today}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        onRangeChange={(from, to) => {
          setRangeFrom(from);
          setRangeTo(to);
        }}
        onExport={exportAll}
      />

      <ul className={styles["admin-report-grid"]}>
        {shownReports.map((report) => (
          <li key={report.key} className={styles["admin-report-card"]}>
            <div className={styles["admin-report-card-top"]}>
              <span className={styles["admin-report-icon"]} aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  {report.icon.map((path) => (
                    <path key={path} d={path} />
                  ))}
                </svg>
              </span>
              <span>
                <span className={styles["admin-report-title"]}>{report.title}</span>
                <span className={styles["admin-report-description"]}>{report.description}</span>
              </span>
            </div>
            <div className={styles["admin-report-card-bottom"]}>
              <span className={styles["admin-report-updated"]}>{updatedText}</span>
              <button type="button" className={styles["admin-report-view"]} onClick={() => setViewing(report.key)}>
                View
              </button>
              <button type="button" className={styles["admin-report-export"]} onClick={() => exportReport(report.key)}>
                Export
              </button>
            </div>
          </li>
        ))}
        {shownReports.length === 0 && <li className={styles["admin-report-empty"]}>No reports match this search.</li>}
      </ul>

      <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-scheduled-heading">
        <div className={dashboardStyles["admin-card-heading-row"]}>
          <div>
            <h2 id="admin-scheduled-heading" className={dashboardStyles["admin-card-title"]}>
              Scheduled reports
            </h2>
            <p className={dashboardStyles["admin-card-subtitle"]}>Sent automatically to your inbox or WhatsApp</p>
          </div>
          <button type="button" className={styles["admin-report-text-button"]} onClick={() => setIsScheduleOpen(true)}>
            + Schedule report
          </button>
        </div>
        <div className={dashboardStyles["admin-table-scroll"]}>
          <table className={dashboardStyles["admin-orders-table"]}>
            <thead>
              <tr>
                <th scope="col">Report</th>
                <th scope="col">Frequency</th>
                <th scope="col">Sent to</th>
                <th scope="col">Next run</th>
                <th scope="col">Format</th>
                <th scope="col">Status</th>
                <th scope="col" className={dashboardStyles["admin-orders-actions"]}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shownSchedules.map((report) => (
                <tr key={report.id}>
                  <td className={dashboardStyles["admin-orders-customer"]}>{report.name}</td>
                  <td>{REPORT_FREQUENCIES.find((frequency) => frequency.key === report.frequency)?.label}</td>
                  <td>{report.sentTo}</td>
                  <td className={dashboardStyles["admin-orders-muted"]}>{report.isPaused ? "—" : nextRunText(report.frequency, new Date())}</td>
                  <td>{report.format}</td>
                  <td>
                    <span className={`${dashboardStyles["admin-status"]} ${report.isPaused ? dashboardStyles["admin-status-pending"] : dashboardStyles["admin-status-delivered"]}`}>
                      {report.isPaused ? "Paused" : "Active"}
                    </span>
                  </td>
                  <td className={dashboardStyles["admin-orders-actions"]}>
                    <AdminRowMenu
                      label={`Actions for ${report.name}`}
                      title="Scheduled report"
                      options={[
                        {
                          label: report.isPaused ? "Resume" : "Pause",
                          onSelect: () => {
                            setScheduledReportPaused(report.id, !report.isPaused);
                            showToast(`${report.name} ${report.isPaused ? "resumed" : "paused"}`);
                          },
                        },
                        {
                          label: "Remove",
                          isDanger: true,
                          permission: "delete",
                          onSelect: () => {
                            removeScheduledReport(report.id);
                            showToast(`${report.name} removed`);
                          },
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {shownSchedules.length === 0 && (
                <tr>
                  <td colSpan={7} className={dashboardStyles["admin-orders-empty"]}>
                    {scheduledReports.length ? "No scheduled reports match this search." : "No reports scheduled yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {viewing && (
        <ReportView
          reportKey={viewing}
          data={data}
          rangeText={rangeText}
          onClose={() => setViewing(null)}
          onExport={() => exportReport(viewing)}
        />
      )}

      {isScheduleOpen && (
        <AdminDialog title="Schedule report" submitLabel="Schedule" onClose={() => setIsScheduleOpen(false)} onSubmit={saveSchedule}>
          <AdminDialogField label="Report" isWide>
            <select
              className={adminInputClassName}
              value={newSchedule.name}
              onChange={(changeEvent) => setNewSchedule({ ...newSchedule, name: changeEvent.target.value })}
            >
              {["Daily summary", ...REPORTS.map((report) => report.title), "Low stock alert"].map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </AdminDialogField>
          <AdminDialogField label="Frequency">
            <select
              className={adminInputClassName}
              value={newSchedule.frequency}
              onChange={(changeEvent) => setNewSchedule({ ...newSchedule, frequency: changeEvent.target.value as ReportFrequency })}
            >
              {REPORT_FREQUENCIES.map((frequency) => (
                <option key={frequency.key} value={frequency.key}>
                  {frequency.label}
                </option>
              ))}
            </select>
          </AdminDialogField>
          <AdminDialogField label="Format">
            <select
              className={adminInputClassName}
              value={newSchedule.format}
              onChange={(changeEvent) => setNewSchedule({ ...newSchedule, format: changeEvent.target.value as ReportFormat })}
            >
              {REPORT_FORMATS.map((format) => (
                <option key={format}>{format}</option>
              ))}
            </select>
          </AdminDialogField>
          <AdminDialogField label="Send to" isWide>
            <select
              className={adminInputClassName}
              value={newSchedule.sentTo}
              onChange={(changeEvent) => setNewSchedule({ ...newSchedule, sentTo: changeEvent.target.value })}
            >
              {SEND_TO_OPTIONS.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </AdminDialogField>
          <p className={styles["admin-report-dialog-note"]}>
            Next run: {nextRunText(newSchedule.frequency, new Date())}. Sending starts once the panel is connected to WhatsApp and
            email.
          </p>
        </AdminDialog>
      )}

      {toast}
    </div>
  );
}

// View: the report over the blurred page, with its numbers, tables and an Export button
function ReportView({
  reportKey,
  data,
  rangeText,
  onClose,
  onExport,
}: {
  reportKey: ReportKey;
  data: ReportData;
  rangeText: string;
  onClose: () => void;
  onExport: () => void;
}) {
  const info = REPORTS.find((report) => report.key === reportKey)!;
  const report = useMemo(() => buildReport(reportKey, data), [reportKey, data]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className={styles["admin-report-view-backdrop"]} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={info.title} className={styles["admin-report-viewer"]}>
        <div className={styles["admin-report-view-heading"]}>
          <div>
            <h2 className={styles["admin-report-view-title"]}>{info.title}</h2>
            <p className={styles["admin-report-view-subtitle"]}>
              {info.description} · {rangeText}
            </p>
          </div>
          <div className={styles["admin-report-view-actions"]}>
            <button type="button" className={styles["admin-report-export"]} onClick={onExport}>
              Export
            </button>
            <button type="button" className={styles["admin-report-view-close"]} aria-label="Close" onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>

        <ul className={styles["admin-report-headline"]}>
          {report.headline.map(({ label, value }) => (
            <li key={label}>
              <span className={styles["admin-report-headline-label"]}>{label}</span>
              <span className={styles["admin-report-headline-value"]}>{value}</span>
            </li>
          ))}
        </ul>

        {report.tables.map((table) => (
          <section key={table.title} className={styles["admin-report-table-section"]}>
            <h3 className={styles["admin-report-table-title"]}>{table.title}</h3>
            <div className={dashboardStyles["admin-table-scroll"]}>
              <table className={dashboardStyles["admin-orders-table"]}>
                <thead>
                  <tr>
                    {table.columns.map((column) => (
                      <th key={column} scope="col">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className={cellIndex === 0 ? dashboardStyles["admin-orders-customer"] : undefined}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {table.rows.length === 0 && (
                    <tr>
                      <td colSpan={table.columns.length} className={dashboardStyles["admin-orders-empty"]}>
                        Nothing in these dates.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        {report.note && <p className={`${styles["admin-report-note"]} ${sharedStyles["admin-status-cancelled"]}`}>{report.note}</p>}
      </div>
    </div>
  );
}
