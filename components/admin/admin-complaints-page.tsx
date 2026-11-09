"use client";

import { useMemo, useState } from "react";
import {
  TICKET_HANDLERS,
  TICKET_ISSUES,
  TICKET_PRIORITIES,
  addTicket,
  updateTicket,
  useComplaintTickets,
  type ComplaintTicket,
  type TicketPriority,
  type TicketStatus,
} from "@/store/admin-complaints-store";
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

/*
  Refunds & complaints (/admin/refunds), from the design 08-refunds-complaints: customer issues, the
  refund given and who is handling each ticket. Refunds go back to the customer's payment method
  (no wallet).
    top        search (customer, ticket or order), New ticket (pop-up form), Custom range, Export
    numbers    open complaints (high priority in red), resolved, refunded, average resolution time
    table      All / Open / In progress / Resolved tabs; 14 a page; "..." changes the status or who
               handles it
  Red only where it is serious: open tickets and high priority. Tickets come from
  store/admin-complaints-store.ts (in the database).
*/

const PAGE_SIZE = 14;

const STATUS_CLASS_NAMES: Record<TicketStatus, string> = {
  Open: sharedStyles["admin-status-warning"],
  "In progress": dashboardStyles["admin-status-out-for-delivery"],
  Resolved: dashboardStyles["admin-status-delivered"],
};

const PRIORITY_CLASS_NAMES: Record<TicketPriority, string> = {
  High: sharedStyles["admin-status-warning"],
  Medium: sharedStyles["admin-status-cancelled"],
  Low: sharedStyles["admin-priority-low"],
};

type TicketTab = "all" | "open" | "progress" | "resolved";
const TAB_STATUS: Record<Exclude<TicketTab, "all">, TicketStatus> = {
  open: "Open",
  progress: "In progress",
  resolved: "Resolved",
};

function shortDate(isoDate: string) {
  return new Date(isoDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const EMPTY_NEW_TICKET = {
  customerName: "",
  area: "",
  issue: TICKET_ISSUES[0],
  orderNumber: "",
  refund: "",
  priority: "Medium" as TicketPriority,
  assignedTo: TICKET_HANDLERS[0],
};

export default function AdminComplaintsPage() {
  return (
    <AdminFeatureGate feature="refunds">
      <ComplaintsPage />
    </AdminFeatureGate>
  );
}

function ComplaintsPage() {
  const tickets = useComplaintTickets();
  const [today] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState(() => new Date(today.getTime() - 6 * 86400000));
  const [rangeTo, setRangeTo] = useState(today);
  const [searchText, setSearchText] = useState("");
  const [tab, setTab] = useState<TicketTab>("all");
  const [page, setPage] = useState(1);
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [newTicket, setNewTicket] = useState(EMPTY_NEW_TICKET);
  const { showToast, toast } = useAdminToast();
  // Sensitive actions only the owner can do (Roles & permissions)
  const isOwner = useIsPanelOwner();

  const ticketsInRange = useMemo(() => {
    const from = new Date(rangeFrom);
    from.setHours(0, 0, 0, 0);
    const to = new Date(rangeTo);
    to.setHours(23, 59, 59, 999);
    const words = searchText.trim().toLowerCase();
    return tickets.filter((ticket) => {
      const raisedAt = new Date(ticket.raisedAt);
      // Open tickets always show, however old they are
      if (ticket.status === "Resolved" && (raisedAt < from || raisedAt > to)) return false;
      return !words || `${ticket.customerName} ${ticket.id} ${ticket.orderNumber} ${ticket.issue}`.toLowerCase().includes(words);
    });
  }, [tickets, rangeFrom, rangeTo, searchText]);

  const countOf = (status: TicketStatus) => ticketsInRange.filter((ticket) => ticket.status === status).length;
  const shown = ticketsInRange.filter((ticket) => tab === "all" || ticket.status === TAB_STATUS[tab]);
  const pageItems = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const open = tickets.filter((ticket) => ticket.status === "Open");
  const highPriorityOpen = open.filter((ticket) => ticket.priority === "High").length;
  const resolved = ticketsInRange.filter((ticket) => ticket.status === "Resolved");
  const refunds = ticketsInRange.filter((ticket) => ticket.refund > 0);
  const refunded = refunds.reduce((sum, ticket) => sum + ticket.refund, 0);
  const resolutionHours = resolved.filter((ticket) => ticket.resolvedAt);
  const averageHours = resolutionHours.length
    ? resolutionHours.reduce(
        (sum, ticket) => sum + (new Date(ticket.resolvedAt as string).getTime() - new Date(ticket.raisedAt).getTime()) / 3600000,
        0,
      ) / resolutionHours.length
    : 0;

  function changeStatus(ticket: ComplaintTicket, status: TicketStatus) {
    updateTicket(ticket.id, { status });
    showToast(`${ticket.id} marked ${status.toLowerCase()}`);
  }

  function saveNewTicket() {
    if (!newTicket.customerName.trim()) {
      showToast("Enter the customer's name");
      return;
    }
    if (!isOwner && Number(newTicket.refund) > 500) {
      showToast(OWNER_ONLY_MESSAGE);
      return;
    }
    const added = addTicket({
      customerName: newTicket.customerName.trim(),
      area: newTicket.area.trim() || "—",
      issue: newTicket.issue,
      orderNumber: newTicket.orderNumber.trim() ? `#${newTicket.orderNumber.replace(/^#/, "").trim()}` : "—",
      refund: Number(newTicket.refund) || 0,
      priority: newTicket.priority,
      assignedTo: newTicket.assignedTo,
    });
    setRangeTo(today);
    setIsNewOpen(false);
    setNewTicket(EMPTY_NEW_TICKET);
    setTab("all");
    setPage(1);
    showToast(`${added.id} opened for ${added.customerName}`);
  }

  function exportTickets() {
    downloadCsv(`chiranvi-complaints-${toDateFileName(today)}.csv`, [
      ["Ticket", "Date", "Customer", "Area", "Issue", "Order", "Refund (₹)", "Priority", "Status", "Assigned to"],
      ...shown.map((ticket) => [
        ticket.id,
        shortDate(ticket.raisedAt),
        ticket.customerName,
        ticket.area,
        ticket.issue,
        ticket.orderNumber,
        ticket.refund || "",
        ticket.priority,
        ticket.status,
        ticket.assignedTo,
      ]),
    ]);
  }

  return (
    <div className={dashboardStyles["admin-dashboard"]}>
      <AdminPageTop
        title="Refunds & complaints"
        description="Customer issues, refunds and who is handling them"
        searchText={searchText}
        onSearchTextChange={(text) => {
          setSearchText(text);
          setPage(1);
        }}
        searchPlaceholder="Search customer, ticket or order..."
        actionLabel="New ticket"
        onAction={() => setIsNewOpen(true)}
        today={today}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        onRangeChange={(from, to) => {
          setRangeFrom(from);
          setRangeTo(to);
          setPage(1);
        }}
        onExport={exportTickets}
      />

      <AdminStatCards
        stats={[
          {
            label: "Open complaints",
            value: String(open.length),
            note: `${highPriorityOpen} high priority`,
            trend: highPriorityOpen ? "bad" : "plain",
            icon: ["M12 4l9 16H3L12 4Z", "M12 10v4", "M12 17h.01"],
          },
          {
            label: "Resolved",
            value: String(resolved.length),
            note: "↑ 5 vs last week",
            trend: "up",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M8.5 12.2l2.4 2.4 4.8-4.8"],
          },
          {
            label: "Refunded",
            value: `₹${refunded.toLocaleString("en-IN")}`,
            note: `${refunds.length} refunds`,
            trend: "plain",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M16 12H8.5", "M11.5 9l-3 3 3 3"],
          },
          {
            label: "Avg resolution time",
            value: `${averageHours.toFixed(1)} h`,
            note: "↓ 1.1 h vs last week",
            trend: "up",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7.5V12l3 2"],
          },
        ]}
      />

      <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-complaints-heading">
        <div className={dashboardStyles["admin-card-heading-row"]}>
          <div>
            <h2 id="admin-complaints-heading" className={dashboardStyles["admin-card-title"]}>
              Complaints & refunds
            </h2>
            <p className={dashboardStyles["admin-card-subtitle"]}>
              Refunds go back to the customer&rsquo;s payment method
            </p>
          </div>
          <AdminFilterTabs
            label="Show tickets"
            selected={tab}
            onSelect={(newTab) => {
              setTab(newTab);
              setPage(1);
            }}
            tabs={[
              { key: "all", label: "All" },
              { key: "open", label: `Open ${countOf("Open")}` },
              { key: "progress", label: "In progress" },
              { key: "resolved", label: "Resolved" },
            ]}
          />
        </div>

        <div className={dashboardStyles["admin-table-scroll"]}>
          <table className={dashboardStyles["admin-orders-table"]}>
            <thead>
              <tr>
                <th scope="col">Ticket</th>
                <th scope="col">Customer</th>
                <th scope="col">Issue</th>
                <th scope="col">Order</th>
                <th scope="col">Refund</th>
                <th scope="col">Priority</th>
                <th scope="col">Status</th>
                <th scope="col">Assigned to</th>
                <th scope="col" className={dashboardStyles["admin-orders-actions"]}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((ticket) => (
                <tr key={ticket.id}>
                  <td>
                    <span className={dashboardStyles["admin-orders-customer"]}>{ticket.id}</span>
                    <span className={dashboardStyles["admin-orders-area"]}>{shortDate(ticket.raisedAt)}</span>
                  </td>
                  <td>
                    <span className={dashboardStyles["admin-orders-customer"]}>{ticket.customerName}</span>
                    <span className={dashboardStyles["admin-orders-area"]}>{ticket.area}</span>
                  </td>
                  <td>{ticket.issue}</td>
                  <td className={dashboardStyles["admin-orders-muted"]}>{ticket.orderNumber}</td>
                  <td className={dashboardStyles["admin-orders-amount"]}>{ticket.refund ? `₹${ticket.refund}` : "—"}</td>
                  <td>
                    <span className={`${dashboardStyles["admin-status"]} ${PRIORITY_CLASS_NAMES[ticket.priority]}`}>
                      {ticket.priority}
                    </span>
                  </td>
                  <td>
                    <span className={`${dashboardStyles["admin-status"]} ${STATUS_CLASS_NAMES[ticket.status]}`}>{ticket.status}</span>
                  </td>
                  <td className={dashboardStyles["admin-orders-muted"]}>{ticket.assignedTo}</td>
                  <td className={dashboardStyles["admin-orders-actions"]}>
                    <AdminRowMenu
                      label={`Actions for ${ticket.id}`}
                      title="Ticket"
                      options={[
                        ...(["Open", "In progress", "Resolved"] as TicketStatus[]).map((status) => ({
                          label: status === "Open" ? "Reopen" : `Mark ${status.toLowerCase()}`,
                          isDisabled: status === ticket.status,
                          onSelect: () => changeStatus(ticket, status),
                        })),
                        ...TICKET_HANDLERS.filter((handler) => handler !== ticket.assignedTo).map((handler) => ({
                          label: `Give to ${handler}`,
                          onSelect: () => {
                            updateTicket(ticket.id, { assignedTo: handler });
                            showToast(`${ticket.id} given to ${handler}`);
                          },
                        })),
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={9} className={dashboardStyles["admin-orders-empty"]}>
                    No tickets match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <AdminPagination page={page} pageSize={PAGE_SIZE} total={shown.length} onPageChange={setPage} itemName="tickets" />
      </section>

      {isNewOpen && (
        <AdminDialog title="New ticket" submitLabel="Open ticket" onClose={() => setIsNewOpen(false)} onSubmit={saveNewTicket}>
          <AdminDialogField label="Customer name">
            <input
              className={adminInputClassName}
              value={newTicket.customerName}
              onChange={(changeEvent) => setNewTicket({ ...newTicket, customerName: changeEvent.target.value })}
              autoFocus
            />
          </AdminDialogField>
          <AdminDialogField label="Area">
            <input
              className={adminInputClassName}
              value={newTicket.area}
              onChange={(changeEvent) => setNewTicket({ ...newTicket, area: changeEvent.target.value })}
            />
          </AdminDialogField>
          <AdminDialogField label="Issue">
            <select
              className={adminInputClassName}
              value={newTicket.issue}
              onChange={(changeEvent) => setNewTicket({ ...newTicket, issue: changeEvent.target.value })}
            >
              {TICKET_ISSUES.map((issue) => (
                <option key={issue}>{issue}</option>
              ))}
            </select>
          </AdminDialogField>
          <AdminDialogField label="Order number">
            <input
              className={adminInputClassName}
              placeholder="CF-2041"
              value={newTicket.orderNumber}
              onChange={(changeEvent) => setNewTicket({ ...newTicket, orderNumber: changeEvent.target.value })}
            />
          </AdminDialogField>
          <AdminDialogField label="Refund (₹, optional)">
            <input
              className={adminInputClassName}
              inputMode="numeric"
              value={newTicket.refund}
              onChange={(changeEvent) => setNewTicket({ ...newTicket, refund: changeEvent.target.value.replace(/\D/g, "") })}
            />
          </AdminDialogField>
          <AdminDialogField label="Priority">
            <select
              className={adminInputClassName}
              value={newTicket.priority}
              onChange={(changeEvent) => setNewTicket({ ...newTicket, priority: changeEvent.target.value as TicketPriority })}
            >
              {TICKET_PRIORITIES.map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </select>
          </AdminDialogField>
          <AdminDialogField label="Assign to" isWide>
            <select
              className={adminInputClassName}
              value={newTicket.assignedTo}
              onChange={(changeEvent) => setNewTicket({ ...newTicket, assignedTo: changeEvent.target.value })}
            >
              {TICKET_HANDLERS.map((handler) => (
                <option key={handler}>{handler}</option>
              ))}
            </select>
          </AdminDialogField>
        </AdminDialog>
      )}

      {toast}
    </div>
  );
}
