import { useMemo } from "react";
import { createPanelRecordStore } from "./panel-records";

/*
  Scheduled reports on the Chiranvi Panel's Reports page: which report goes to whom, how often and in
  what format. Kept in the database (panel_records, "reports"; supabase/migrations/0019_…), by the staff
  member's role (Reports); actually sending them (WhatsApp / email) needs a timed job on the server, so for
  now this is the list of what will be sent. The first time, the 6 starting reports are copied in.
*/

export type ReportFrequency = "daily" | "monday" | "friday" | "saturday" | "monthly" | "low-stock";
export type ReportFormat = "PDF" | "Excel" | "PDF + Excel" | "WhatsApp";

export type ScheduledReport = {
  id: string;
  name: string; // "Daily summary"
  frequency: ReportFrequency;
  sentTo: string; // "Owner (WhatsApp)"
  format: ReportFormat;
  isPaused: boolean;
};

export const REPORT_FREQUENCIES: { key: ReportFrequency; label: string }[] = [
  { key: "daily", label: "Every day, 9 PM" },
  { key: "monday", label: "Every Monday, 8 AM" },
  { key: "friday", label: "Every Friday, 6 PM" },
  { key: "saturday", label: "Every Saturday, 10 AM" },
  { key: "monthly", label: "1st of month, 9 AM" },
  { key: "low-stock", label: "When stock is low" },
];

export const REPORT_FORMATS: ReportFormat[] = ["PDF", "Excel", "PDF + Excel", "WhatsApp"];

const startingReports: ScheduledReport[] = [
  { id: "SR-1", name: "Daily summary", frequency: "daily", sentTo: "Owner (WhatsApp)", format: "PDF", isPaused: false },
  { id: "SR-2", name: "Weekly sales", frequency: "monday", sentTo: "Owner, Karthik N", format: "Excel", isPaused: false },
  { id: "SR-3", name: "Monthly profit & loss", frequency: "monthly", sentTo: "Owner", format: "PDF + Excel", isPaused: false },
  { id: "SR-4", name: "Complaints summary", frequency: "friday", sentTo: "Owner, Divya Rao", format: "PDF", isPaused: false },
  { id: "SR-5", name: "Low stock alert", frequency: "low-stock", sentTo: "Manager", format: "WhatsApp", isPaused: true },
  { id: "SR-6", name: "Staff attendance", frequency: "saturday", sentTo: "Manager", format: "Excel", isPaused: false },
];

// When it goes out next ("On trigger" for low stock)
export function getNextRun(frequency: ReportFrequency, now = new Date()): Date | null {
  if (frequency === "low-stock") return null;
  const next = new Date(now);
  next.setSeconds(0, 0);
  if (frequency === "daily") {
    next.setHours(21, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }
  if (frequency === "monthly") {
    next.setHours(9, 0);
    next.setDate(1);
    if (next <= now) next.setMonth(next.getMonth() + 1);
    return next;
  }
  const weekday = { monday: 1, friday: 5, saturday: 6 }[frequency];
  const hour = { monday: 8, friday: 18, saturday: 10 }[frequency];
  next.setHours(hour, 0);
  next.setDate(next.getDate() + ((weekday - next.getDay() + 7) % 7));
  if (next <= now) next.setDate(next.getDate() + 7);
  return next;
}

const store = createPanelRecordStore<ScheduledReport>({
  module: "reports",
  seed: { seedKey: "reports", makeSamples: () => startingReports, oldStorageKey: "chiranvi-admin-scheduled-reports" },
});

// The list as the page shows it: oldest first (new ones go at the end)
function inAddedOrder(reports: ScheduledReport[]) {
  return [...reports].sort((first, second) => (Number(first.id.replace(/D/g, "")) || 0) - (Number(second.id.replace(/D/g, "")) || 0));
}

export function addScheduledReport(report: Omit<ScheduledReport, "id" | "isPaused">) {
  const highest = Math.max(0, ...store.getRecords().map((existing) => Number(existing.id.replace(/D/g, "")) || 0));
  const newReport: ScheduledReport = { ...report, id: `SR-${highest + 1}`, isPaused: false };
  void store.add(newReport);
  return newReport;
}

export function setScheduledReportPaused(id: string, isPaused: boolean) {
  void store.change(id, (report) => ({ ...report, isPaused }));
}

export function removeScheduledReport(id: string) {
  void store.remove(id);
}

export function useScheduledReports() {
  const reports = store.useRecords();
  return useMemo(() => inAddedOrder(reports), [reports]);
}
