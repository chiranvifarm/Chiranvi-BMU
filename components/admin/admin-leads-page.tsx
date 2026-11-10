"use client";

import { useMemo, useState } from "react";
import {
  LEAD_KIND_LABELS,
  LEAD_SOURCES,
  LEAD_STAGES,
  addLead,
  getLeadKind,
  moveLead,
  removeLead,
  useCustomerLeads,
  useRealAdminLeads,
  type AdminLead,
  type LeadKind,
  type LeadSource,
  type LeadStage,
} from "@/store/admin-leads-store";
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
  useAdminCan,
  useAdminToast,
} from "./admin-shared";
import dashboardStyles from "./admin-dashboard.module.css";
import styles from "./admin-leads-page.module.css";

/*
  Leads (/admin/leads): people who may become customers, in a table like All orders.
    top        search (name or phone), Add lead (pop-up form), Custom range (when the lead came in), Export
    numbers    leads, contacted, converted, conversion rate (for the chosen dates)
    table      NAME (and when they came in) · PHONE · TYPE · DETAILS · STATUS (a drop-down: New, Contacted,
               Converted, Lost) · ACTIONS (⋯: Call, WhatsApp, Details, Remove). A row opens its details.
    tabs       All, and one for each type:
                 New customer         completed their Profile, no order yet
                 Bulk order           sent the website's bulk order form
                 Ordered for someone  a customer ordered for them (another name and number)
                 Location request     asked for delivery to their area
                 Added by staff       added with Add lead (social media, walk-ins ...)
  People who logged in but didn't complete their Profile are kept out of sight: once they complete it they come
  in as New customer by themselves. Leads come from store/admin-leads-store.ts (the database), real leads only.
*/

const PAGE_SIZE = 14;

type LeadType = "no-order" | "bulk" | "ordered-for" | "location" | "staff";

const LEAD_TYPE_LABELS: Record<LeadType, string> = {
  "no-order": "New customer",
  bulk: "Bulk order",
  "ordered-for": "Ordered for someone",
  location: "Location request",
  staff: "Added by staff",
};

// A lead's type in the table; null: not shown (logged in, Profile not completed yet)
function leadTypeOf(lead: AdminLead): LeadType | null {
  const kind = getLeadKind(lead);
  if (kind === "profile-incomplete") return null;
  if (kind === "no-order" || kind === "bulk" || kind === "ordered-for" || kind === "location") return kind;
  return "staff";
}

type LeadFilter = "all" | LeadType;

// The DETAILS column: what the lead is about, in one or two short lines
function leadDetails(lead: AdminLead) {
  const type = leadTypeOf(lead);
  if (type === "bulk" && lead.bulkOrderItems?.length) {
    return lead.bulkOrderItems.map((item) => `${item.productName} ${item.packLabel} × ${item.quantity}`).join(", ");
  }
  if (type === "ordered-for") return lead.note ?? "";
  if (type === "staff") return [lead.source, lead.note].filter(Boolean).join(" · ");
  return lead.address ?? lead.note ?? "";
}

// "10 Nov · 17:12", as the Orders table shows when an order came in
function cameInText(iso: string) {
  const date = new Date(iso);
  return `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

// Status colours, as on the Orders table: New yellow edge, Contacted green edge, Converted green, Lost grey
const STAGE_CLASS_NAMES: Record<LeadStage, string> = {
  new: dashboardStyles["admin-status-pending"],
  contacted: dashboardStyles["admin-status-out-for-delivery"],
  converted: dashboardStyles["admin-status-delivered"],
  lost: styles["admin-lead-status-lost"],
};

const EMPTY_NEW_LEAD = { name: "", phone: "", source: "Instagram" as LeadSource };

export default function AdminLeadsPage() {
  return (
    <AdminFeatureGate feature="leads">
      <LeadsPage />
    </AdminFeatureGate>
  );
}

function LeadsPage() {
  const allLeads = useRealAdminLeads();
  useCustomerLeads(useAdminCan("create"));
  const canEdit = useAdminCan("edit");
  const [today] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [rangeTo, setRangeTo] = useState(today);
  const [searchText, setSearchText] = useState("");
  const [leadFilter, setLeadFilter] = useState<LeadFilter>("all");
  const [page, setPage] = useState(1);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newLead, setNewLead] = useState(EMPTY_NEW_LEAD);
  // A row opens its details (address, email and the products of a bulk order request)
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const openLead = allLeads.find((lead) => lead.id === openLeadId);
  const { showToast, toast } = useAdminToast();

  // Only the leads the table shows (not "logged in, Profile not completed")
  const leads = useMemo(() => allLeads.filter((lead) => leadTypeOf(lead) !== null), [allLeads]);

  const leadsInRange = useMemo(() => {
    const from = new Date(rangeFrom);
    from.setHours(0, 0, 0, 0);
    const to = new Date(rangeTo);
    to.setHours(23, 59, 59, 999);
    const words = searchText.trim().toLowerCase();
    const digits = words.replace(/\D/g, "");
    return leads
      .filter((lead) => {
        const createdAt = new Date(lead.createdAt);
        if (createdAt < from || createdAt > to) return false;
        if (!words) return true;
        return lead.name.toLowerCase().includes(words) || (digits.length >= 3 && lead.phone.replace(/\D/g, "").includes(digits));
      })
      .sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  }, [leads, rangeFrom, rangeTo, searchText]);
  const isInFilter = (lead: AdminLead, filter: LeadFilter) => filter === "all" || leadTypeOf(lead) === filter;
  const shownLeads = leadsInRange.filter((lead) => isInFilter(lead, leadFilter));
  const pageLeads = shownLeads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const tabLabel = (label: string, filter: LeadFilter) => `${label} ${leadsInRange.filter((lead) => isInFilter(lead, filter)).length}`;

  const count = (stage: LeadStage) => shownLeads.filter((lead) => lead.stage === stage).length;
  const contactedOrLater = shownLeads.filter((lead) => lead.stage !== "new" && lead.stage !== "lost").length;
  const converted = count("converted");
  const conversionRate = shownLeads.length ? Math.round((converted / shownLeads.length) * 100) : 0;

  // New leads against the same number of days just before the chosen dates
  const rangeLength = rangeTo.getTime() - rangeFrom.getTime() + 86400000;
  const leadsBefore = leads.filter((lead) => {
    const createdAt = new Date(lead.createdAt).getTime();
    const firstDay = new Date(rangeFrom).setHours(0, 0, 0, 0);
    return createdAt < firstDay && createdAt >= firstDay - rangeLength && isInFilter(lead, leadFilter);
  }).length;
  const leadsChange = shownLeads.length - leadsBefore;

  function moveTo(lead: AdminLead, stage: LeadStage) {
    if (lead.stage === stage) return;
    moveLead(lead.id, stage);
    showToast(`${lead.name} moved to ${LEAD_STAGES.find((existing) => existing.key === stage)?.label}`);
  }

  function saveNewLead() {
    const digits = newLead.phone.replace(/\D/g, "");
    if (!newLead.name.trim() || digits.length !== 10) {
      showToast("Enter the name and a 10-digit phone number");
      return;
    }
    const added = addLead({
      name: newLead.name.trim(),
      phone: `${digits.slice(0, 5)} ${digits.slice(5, 7)} ${digits.slice(7)}`,
      source: newLead.source,
    });
    setRangeTo(today);
    setIsAddOpen(false);
    setNewLead(EMPTY_NEW_LEAD);
    showToast(`${added.name} added`);
  }

  function exportLeads() {
    downloadCsv(`chiranvi-leads-${toDateFileName(today)}.csv`, [
      ["Name", "Phone", "Type", "Details", "Status", "Came in", "Source", "Address", "Email"],
      ...shownLeads.map((lead) => [
        lead.name,
        lead.phone,
        LEAD_TYPE_LABELS[leadTypeOf(lead) as LeadType],
        leadDetails(lead),
        LEAD_STAGES.find((stage) => stage.key === lead.stage)?.label ?? lead.stage,
        new Date(lead.createdAt).toLocaleDateString("en-GB"),
        lead.source,
        lead.address ?? "",
        lead.email ?? "",
      ]),
    ]);
  }

  const phoneDigits = (lead: AdminLead) => lead.phone.replace(/\D/g, "").slice(-10);

  return (
    <div className={dashboardStyles["admin-dashboard"]}>
      <AdminPageTop
        title="Leads"
        description="New customers who haven't ordered yet, bulk orders, people ordered for, and location requests"
        searchText={searchText}
        onSearchTextChange={(text) => {
          setSearchText(text);
          setPage(1);
        }}
        searchPlaceholder="Search name or phone..."
        actionLabel="Add lead"
        onAction={() => setIsAddOpen(true)}
        today={today}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        onRangeChange={(from, to) => {
          setRangeFrom(from);
          setRangeTo(to);
          setPage(1);
        }}
        onExport={exportLeads}
      />

      <AdminStatCards
        stats={[
          {
            label: "Leads",
            value: String(shownLeads.length),
            note: leadsChange === 0 ? "Same as the days before" : `${leadsChange > 0 ? "↑" : "↓"} ${Math.abs(leadsChange)} vs the days before`,
            trend: leadsChange > 0 ? "up" : "plain",
            icon: ["M10 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M3 20.5a7 7 0 0 1 14 0", "M19 8v6", "M16 11h6"],
          },
          {
            label: "Contacted",
            value: String(contactedOrLater),
            note: "Moved on from New",
            trend: "plain",
            icon: [
              "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z",
            ],
          },
          {
            label: "Converted",
            value: String(converted),
            note: "Became customers",
            trend: "plain",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M8.5 12.2l2.4 2.4 4.8-4.8"],
          },
          {
            label: "Conversion rate",
            value: `${conversionRate}%`,
            note: `${converted} of ${shownLeads.length} lead${shownLeads.length === 1 ? "" : "s"}`,
            trend: "plain",
            icon: ["M19 5L5 19", "M7 8.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z", "M17 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"],
          },
        ]}
      />

      <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-leads-heading">
        <div className={dashboardStyles["admin-card-heading-row"]}>
          <div>
            <h2 id="admin-leads-heading" className={dashboardStyles["admin-card-title"]}>
              All leads
            </h2>
            <p className={dashboardStyles["admin-card-subtitle"]}>People who may become customers, newest first</p>
          </div>
          <AdminFilterTabs
            label="Show leads"
            selected={leadFilter}
            onSelect={(filter) => {
              setLeadFilter(filter);
              setPage(1);
            }}
            tabs={[
              { key: "all", label: tabLabel("All", "all") },
              { key: "no-order", label: tabLabel(LEAD_TYPE_LABELS["no-order"], "no-order") },
              { key: "bulk", label: tabLabel(LEAD_TYPE_LABELS.bulk, "bulk") },
              { key: "ordered-for", label: tabLabel(LEAD_TYPE_LABELS["ordered-for"], "ordered-for") },
              { key: "location", label: tabLabel(LEAD_TYPE_LABELS.location, "location") },
              { key: "staff", label: tabLabel(LEAD_TYPE_LABELS.staff, "staff") },
            ]}
          />
        </div>

        <div className={dashboardStyles["admin-table-scroll"]}>
          <table className={dashboardStyles["admin-orders-table"]}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Phone</th>
                <th scope="col">Type</th>
                <th scope="col">Details</th>
                <th scope="col">Status</th>
                <th scope="col" className={dashboardStyles["admin-orders-actions"]}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {pageLeads.map((lead) => {
                const type = leadTypeOf(lead) as LeadType;
                return (
                  <tr
                    key={lead.id}
                    className={dashboardStyles["admin-orders-row-clickable"]}
                    tabIndex={0}
                    aria-label={`${lead.name}: open details`}
                    onClick={() => setOpenLeadId(lead.id)}
                    onKeyDown={(keyEvent) => {
                      if (keyEvent.key === "Enter" && keyEvent.target === keyEvent.currentTarget) setOpenLeadId(lead.id);
                    }}
                  >
                    <td>
                      <span className={dashboardStyles["admin-orders-customer"]}>{lead.name}</span>
                      <span className={dashboardStyles["admin-orders-area"]}>{cameInText(lead.createdAt)}</span>
                    </td>
                    <td className={styles["admin-lead-phone-cell"]}>{lead.phone}</td>
                    <td>
                      <span className={`${styles["admin-lead-type"]} ${styles[`admin-lead-type-${type}`]}`}>{LEAD_TYPE_LABELS[type]}</span>
                    </td>
                    <td className={`${dashboardStyles["admin-orders-muted"]} ${styles["admin-lead-details-cell"]}`}>
                      {leadDetails(lead) || "—"}
                    </td>
                    {/* The status and actions cells don't open the details */}
                    <td onClick={(clickEvent) => clickEvent.stopPropagation()} onKeyDown={(keyEvent) => keyEvent.stopPropagation()}>
                      {canEdit ? (
                        <span className={`${dashboardStyles["admin-status"]} ${STAGE_CLASS_NAMES[lead.stage]} ${dashboardStyles["admin-status-select-pill"]}`}>
                          <select
                            className={dashboardStyles["admin-status-select"]}
                            value={lead.stage}
                            aria-label={`Status of ${lead.name}`}
                            onChange={(changeEvent) => moveTo(lead, changeEvent.target.value as LeadStage)}
                          >
                            {LEAD_STAGES.map((stage) => (
                              <option key={stage.key} value={stage.key}>
                                {stage.label}
                              </option>
                            ))}
                          </select>
                          <svg className={dashboardStyles["admin-status-select-arrow"]} viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M7 10l5 5 5-5" />
                          </svg>
                        </span>
                      ) : (
                        <span className={`${dashboardStyles["admin-status"]} ${STAGE_CLASS_NAMES[lead.stage]}`}>
                          {LEAD_STAGES.find((stage) => stage.key === lead.stage)?.label}
                        </span>
                      )}
                    </td>
                    <td
                      className={dashboardStyles["admin-orders-actions"]}
                      onClick={(clickEvent) => clickEvent.stopPropagation()}
                      onKeyDown={(keyEvent) => keyEvent.stopPropagation()}
                    >
                      <AdminRowMenu
                        label={`Actions for ${lead.name}`}
                        title={lead.name}
                        options={[
                          { label: "Call", permission: "view", onSelect: () => window.open(`tel:+91${phoneDigits(lead)}`, "_self") },
                          { label: "WhatsApp", permission: "view", onSelect: () => window.open(`https://wa.me/91${phoneDigits(lead)}`, "_blank", "noopener") },
                          { label: "View details", permission: "view", onSelect: () => setOpenLeadId(lead.id) },
                          {
                            label: "Remove lead",
                            isDanger: true,
                            permission: "delete",
                            onSelect: () => {
                              removeLead(lead.id);
                              showToast(`${lead.name} removed`);
                            },
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
              {pageLeads.length === 0 && (
                <tr>
                  <td colSpan={6} className={dashboardStyles["admin-orders-empty"]}>
                    No leads match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <AdminPagination page={page} pageSize={PAGE_SIZE} total={shownLeads.length} onPageChange={setPage} itemName="leads" />
      </section>

      {isAddOpen && (
        <AdminDialog title="Add lead" submitLabel="Add lead" onClose={() => setIsAddOpen(false)} onSubmit={saveNewLead}>
          <AdminDialogField label="Name">
            <input
              className={adminInputClassName}
              value={newLead.name}
              onChange={(changeEvent) => setNewLead({ ...newLead, name: changeEvent.target.value })}
              autoFocus
            />
          </AdminDialogField>
          <AdminDialogField label="Phone">
            <input
              className={adminInputClassName}
              inputMode="numeric"
              placeholder="10-digit number"
              value={newLead.phone}
              onChange={(changeEvent) => setNewLead({ ...newLead, phone: changeEvent.target.value.replace(/\D/g, "").slice(0, 10) })}
            />
          </AdminDialogField>
          <AdminDialogField label="Where they found us" isWide>
            <select
              className={adminInputClassName}
              value={newLead.source}
              onChange={(changeEvent) => setNewLead({ ...newLead, source: changeEvent.target.value as LeadSource })}
            >
              {LEAD_SOURCES.map((source) => (
                <option key={source}>{source}</option>
              ))}
            </select>
          </AdminDialogField>
        </AdminDialog>
      )}

      {openLead && (
        <AdminDialog title={openLead.name} submitLabel="Close" onClose={() => setOpenLeadId(null)} onSubmit={() => setOpenLeadId(null)}>
          <dl className={styles["admin-lead-details"]}>
            <div>
              <dt>Phone</dt>
              <dd>
                <a href={`tel:+91${phoneDigits(openLead)}`}>{openLead.phone}</a>
              </dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{leadTypeOf(openLead) ? LEAD_TYPE_LABELS[leadTypeOf(openLead) as LeadType] : LEAD_KIND_LABELS[getLeadKind(openLead) as LeadKind]}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{LEAD_STAGES.find((stage) => stage.key === openLead.stage)?.label}</dd>
            </div>
            <div>
              <dt>Came in</dt>
              <dd>{new Date(openLead.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{openLead.source}</dd>
            </div>
            {openLead.note && (
              <div>
                <dt>Note</dt>
                <dd>{openLead.note}</dd>
              </div>
            )}
            {openLead.email && (
              <div>
                <dt>Email</dt>
                <dd>
                  <a href={`mailto:${openLead.email}`}>{openLead.email}</a>
                </dd>
              </div>
            )}
            {openLead.address && (
              <div className={styles["admin-lead-details-wide"]}>
                <dt>Address</dt>
                <dd>{openLead.address}</dd>
              </div>
            )}
          </dl>
          {openLead.bulkOrderItems && openLead.bulkOrderItems.length > 0 && (
            <div className={styles["admin-lead-bulk-order"]}>
              <h3>Bulk order request</h3>
              <ul>
                {openLead.bulkOrderItems.map((item) => (
                  <li key={`${item.productName}-${item.packLabel}`}>
                    <span>
                      {item.productName} <small>{item.packLabel}</small>
                    </span>
                    <strong>× {item.quantity}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </AdminDialog>
      )}

      {toast}
    </div>
  );
}
