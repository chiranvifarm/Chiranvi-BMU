"use client";

import { useMemo, useState } from "react";
import {
  decidePauseRequest,
  getShownStatus,
  usePauseRequests,
  type PauseRequest,
} from "@/store/admin-pause-requests-store";
import { useCurrentStaffAccess } from "@/store/staff-access-store";
import { AdminFeatureGate } from "./admin-panel-layout";
import {
  AdminFilterTabs,
  AdminPageTop,
  AdminPagination,
  AdminStatCards,
  downloadCsv,
  toDateFileName,
  useAdminToast,
} from "./admin-shared";
import dashboardStyles from "./admin-dashboard.module.css";
import sharedStyles from "./admin-shared.module.css";

/*
  Pause requests (/admin/pause-requests), from the design 04-pause-requests: customers asking to stop
  milk for a few days, to be approved before tomorrow's delivery sheet is locked at 10 PM.
    top        search (customer or area), Custom range, Export
    numbers    waiting for approval, paused tomorrow (and the milk it saves), resuming this week,
               average pause length
    table      Pending / Approved / Resumed tabs; 14 a page; Approve and Reject on pending requests;
               decided ones show who decided
  Requests come from store/admin-pause-requests-store.ts (saved in this browser for now).
*/

const PAGE_SIZE = 14;

const STATUS_CLASS_NAMES = {
  Pending: dashboardStyles["admin-status-pending"],
  Approved: dashboardStyles["admin-status-delivered"],
  Resumed: dashboardStyles["admin-status-out-for-delivery"],
  Rejected: sharedStyles["admin-status-cancelled"],
};

type RequestTab = "pending" | "approved" | "resumed";

function shortDate(isoDate: string) {
  return new Date(isoDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function daysBetween(request: PauseRequest) {
  return Math.round((new Date(request.resumeOn).getTime() - new Date(request.pauseFrom).getTime()) / 86400000);
}

export default function AdminPauseRequestsPage() {
  return (
    <AdminFeatureGate feature="pause-requests">
      <PauseRequestsPage />
    </AdminFeatureGate>
  );
}

function PauseRequestsPage() {
  const requests = usePauseRequests();
  const staffAccess = useCurrentStaffAccess();
  const [today] = useState(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  });
  const [rangeFrom, setRangeFrom] = useState(() => new Date(today.getTime() - 6 * 86400000));
  const [rangeTo, setRangeTo] = useState(today);
  const [searchText, setSearchText] = useState("");
  const [tab, setTab] = useState<RequestTab>("pending");
  const [page, setPage] = useState(1);
  const { showToast, toast } = useAdminToast();

  const matchingSearch = useMemo(() => {
    const words = searchText.trim().toLowerCase();
    if (!words) return requests;
    return requests.filter((request) => `${request.customerName} ${request.area}`.toLowerCase().includes(words));
  }, [requests, searchText]);

  const statusOf = (request: PauseRequest) => getShownStatus(request, today);
  const tabMatches = (request: PauseRequest, requestTab: RequestTab) => {
    const status = statusOf(request);
    if (requestTab === "pending") return status === "Pending";
    if (requestTab === "resumed") return status === "Resumed";
    return status === "Approved" || status === "Rejected";
  };
  const counts = {
    pending: matchingSearch.filter((request) => tabMatches(request, "pending")).length,
    approved: matchingSearch.filter((request) => tabMatches(request, "approved")).length,
    resumed: matchingSearch.filter((request) => tabMatches(request, "resumed")).length,
  };
  const shown = matchingSearch.filter((request) => tabMatches(request, tab));
  const pageItems = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Numbers for the cards
  const tomorrow = new Date(today.getTime() + 86400000);
  const approved = requests.filter((request) => request.status === "Approved");
  const pausedTomorrow = approved.filter(
    (request) => new Date(request.pauseFrom) <= tomorrow && new Date(request.resumeOn) > tomorrow,
  );
  const litresSaved = pausedTomorrow.reduce(
    (sum, request) => sum + request.litresPerDay * (request.frequency === "Daily" ? 1 : 0.5),
    0,
  );
  const weekEnd = new Date(today.getTime() + 7 * 86400000);
  const resumingThisWeek = approved.filter(
    (request) => new Date(request.resumeOn) > today && new Date(request.resumeOn) <= weekEnd,
  ).length;
  const averagePause = approved.length
    ? approved.reduce((sum, request) => sum + daysBetween(request), 0) / approved.length
    : 0;

  function decide(request: PauseRequest, status: "Approved" | "Rejected") {
    decidePauseRequest(request.id, status, staffAccess?.name ?? "Admin");
    showToast(`${request.customerName}'s pause ${status === "Approved" ? "approved" : "rejected"}`);
  }

  function exportRequests() {
    downloadCsv(`chiranvi-pause-requests-${toDateFileName(today)}.csv`, [
      ["Customer", "Area", "Subscription", "Frequency", "Pause from", "Resume on", "Days", "Reason", "Status", "Decided by"],
      ...shown.map((request) => [
        request.customerName,
        request.area,
        request.plan,
        request.frequency,
        shortDate(request.pauseFrom),
        shortDate(request.resumeOn),
        daysBetween(request),
        request.reason,
        statusOf(request),
        request.decidedBy ?? "",
      ]),
    ]);
  }

  return (
    <div className={dashboardStyles["admin-dashboard"]}>
      <AdminPageTop
        title="Pause requests"
        description="Approve pauses before tomorrow’s delivery sheet is locked at 10 PM"
        searchText={searchText}
        onSearchTextChange={(text) => {
          setSearchText(text);
          setPage(1);
        }}
        searchPlaceholder="Search customer or area..."
        today={today}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        onRangeChange={(from, to) => {
          setRangeFrom(from);
          setRangeTo(to);
        }}
        onExport={exportRequests}
      />

      <AdminStatCards
        stats={[
          {
            label: "Waiting for approval",
            value: String(requests.filter((request) => request.status === "Pending").length),
            note: "Affects tomorrow’s count",
            trend: "plain",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7.5V12l3 2"],
          },
          {
            label: "Paused tomorrow",
            value: String(pausedTomorrow.length),
            note: `−${Math.round(litresSaved)} L milk tomorrow`,
            trend: "plain",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M10 9v6", "M14 9v6"],
          },
          {
            label: "Resuming this week",
            value: String(resumingThisWeek),
            note: "Auto-resume is on",
            trend: "plain",
            icon: ["M4 8.5h14.5", "M15.5 5.5l3 3-3 3", "M20 15.5H5.5", "M8.5 12.5l-3 3 3 3"],
          },
          {
            label: "Average pause",
            value: `${averagePause.toFixed(1)} days`,
            note: "↓ 0.6 days vs last month",
            trend: "up",
            icon: ["M4 6h16v14H4z", "M4 10h16", "M8 3.5v4M16 3.5v4"],
          },
        ]}
      />

      <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-pause-requests-heading">
        <div className={dashboardStyles["admin-card-heading-row"]}>
          <div>
            <h2 id="admin-pause-requests-heading" className={dashboardStyles["admin-card-title"]}>
              Pause requests
            </h2>
            <p className={dashboardStyles["admin-card-subtitle"]}>
              Customers who asked to stop delivery for a few days
            </p>
          </div>
          <AdminFilterTabs
            label="Show requests"
            selected={tab}
            onSelect={(newTab) => {
              setTab(newTab);
              setPage(1);
            }}
            tabs={[
              { key: "pending", label: `Pending ${counts.pending}` },
              { key: "approved", label: `Approved ${counts.approved}` },
              { key: "resumed", label: `Resumed ${counts.resumed}` },
            ]}
          />
        </div>

        <div className={dashboardStyles["admin-table-scroll"]}>
          <table className={dashboardStyles["admin-orders-table"]}>
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Subscription</th>
                <th scope="col">Pause from</th>
                <th scope="col">Resume on</th>
                <th scope="col">Days</th>
                <th scope="col">Reason</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((request) => {
                const status = statusOf(request);
                return (
                  <tr key={request.id}>
                    <td>
                      <span className={dashboardStyles["admin-orders-customer"]}>{request.customerName}</span>
                      <span className={dashboardStyles["admin-orders-area"]}>{request.area}</span>
                    </td>
                    <td>
                      <span className={dashboardStyles["admin-orders-customer"]}>{request.plan}</span>
                      <span className={dashboardStyles["admin-orders-area"]}>{request.frequency}</span>
                    </td>
                    <td className={dashboardStyles["admin-orders-muted"]}>{shortDate(request.pauseFrom)}</td>
                    <td className={dashboardStyles["admin-orders-muted"]}>{shortDate(request.resumeOn)}</td>
                    <td>{daysBetween(request)}</td>
                    <td>{request.reason}</td>
                    <td>
                      <span className={`${dashboardStyles["admin-status"]} ${STATUS_CLASS_NAMES[status]}`}>{status}</span>
                    </td>
                    <td>
                      {status === "Pending" ? (
                        <span className={sharedStyles["admin-row-buttons"]}>
                          <button type="button" className={sharedStyles["admin-small-button"]} onClick={() => decide(request, "Approved")}>
                            Approve
                          </button>
                          <button
                            type="button"
                            className={sharedStyles["admin-small-button-danger"]}
                            onClick={() => decide(request, "Rejected")}
                          >
                            Reject
                          </button>
                        </span>
                      ) : (
                        <span className={dashboardStyles["admin-orders-muted"]}>By {request.decidedBy}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={8} className={dashboardStyles["admin-orders-empty"]}>
                    {tab === "pending" ? "No requests waiting. All caught up!" : "No requests here."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <AdminPagination page={page} pageSize={PAGE_SIZE} total={shown.length} onPageChange={setPage} itemName="requests" />
      </section>

      {toast}
    </div>
  );
}
