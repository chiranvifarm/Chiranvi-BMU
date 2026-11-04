"use client";

import { useMemo, useState } from "react";
import { getNameInitials } from "@/components/account/account-profile";
import {
  LEAD_KIND_LABELS,
  LEAD_SOURCES,
  LEAD_STAGES,
  SOCIAL_SOURCES,
  addLead,
  getLeadKind,
  moveLead,
  removeLead,
  useAdminLeads,
  useCustomerLeads,
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
  Leads (/admin/leads), from the design 06-leads: enquiries from social media, the website, referrals,
  Google and walk-ins, and people who logged in but haven't bought yet, on a board with five columns: New,
  Contacted, Free trial, Converted, Lost.
    top        search (name or phone), Add lead (pop-up form), Custom range (when the lead came in), Export
    numbers    new leads, contacted, converted, conversion rate (for the chosen dates)
    tabs       All, Profile not completed, No order yet, Location request, Bulk order, Social media
    board      each column shows 6 cards and "+ N more" to open the rest; drag a card to another
               column to move it, or use its "..." menu (also removes a lead)
  Source tags use only Chiranvi colours (greens and yellows), each with its name written on it.
  Leads come from store/admin-leads-store.ts (the database).
*/

const CARDS_SHOWN_PER_COLUMN = 6;

type LeadFilter = "all" | LeadKind | "social";

function isInFilter(lead: AdminLead, filter: LeadFilter) {
  if (filter === "all") return true;
  if (filter === "social") return SOCIAL_SOURCES.includes(lead.source);
  return getLeadKind(lead) === filter;
}

function cardNote(lead: AdminLead) {
  if (lead.stage === "new") {
    const daysAgo = Math.max(1, Math.round((Date.now() - new Date(lead.createdAt).getTime()) / 86400000));
    // Why they are a lead, while new
    const kind = getLeadKind(lead);
    return kind ? `${LEAD_KIND_LABELS[kind]} · ${daysAgo}d ago` : `${daysAgo}d ago`;
  }
  if (lead.stage === "trial" && lead.trialEndsAt) {
    const daysLeft = Math.max(0, Math.ceil((new Date(lead.trialEndsAt).getTime() - Date.now()) / 86400000));
    return daysLeft === 1 ? "1 day left" : `${daysLeft} days left`;
  }
  return lead.note ?? "";
}

const EMPTY_NEW_LEAD = { name: "", phone: "", source: "Instagram" as LeadSource };

export default function AdminLeadsPage() {
  return (
    <AdminFeatureGate feature="leads">
      <LeadsPage />
    </AdminFeatureGate>
  );
}

function LeadsPage() {
  const leads = useAdminLeads();
  useCustomerLeads(useAdminCan("create"));
  const [today] = useState(() => new Date());
  const [rangeFrom, setRangeFrom] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [rangeTo, setRangeTo] = useState(today);
  const [searchText, setSearchText] = useState("");
  const [leadFilter, setLeadFilter] = useState<LeadFilter>("all");
  const [openColumns, setOpenColumns] = useState<Set<LeadStage>>(new Set());
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<LeadStage | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newLead, setNewLead] = useState(EMPTY_NEW_LEAD);
  // Clicking a card opens its details (address, email and the products of a bulk order request)
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const openLead = leads.find((lead) => lead.id === openLeadId);
  const { showToast, toast } = useAdminToast();

  const leadsInRange = useMemo(() => {
    const from = new Date(rangeFrom);
    from.setHours(0, 0, 0, 0);
    const to = new Date(rangeTo);
    to.setHours(23, 59, 59, 999);
    const words = searchText.trim().toLowerCase();
    const digits = words.replace(/\D/g, "");
    return leads.filter((lead) => {
      const createdAt = new Date(lead.createdAt);
      if (createdAt < from || createdAt > to) return false;
      if (!words) return true;
      return lead.name.toLowerCase().includes(words) || (digits.length >= 3 && lead.phone.replace(/\D/g, "").includes(digits));
    });
  }, [leads, rangeFrom, rangeTo, searchText]);
  const shownLeads = leadsInRange.filter((lead) => isInFilter(lead, leadFilter));
  const tabLabel = (label: string, filter: LeadFilter) => `${label} ${leadsInRange.filter((lead) => isInFilter(lead, filter)).length}`;

  const count = (stage: LeadStage) => shownLeads.filter((lead) => lead.stage === stage).length;
  const contactedOrLater = shownLeads.filter((lead) => lead.stage !== "new" && lead.stage !== "lost").length;
  const converted = count("converted");
  const conversionRate = shownLeads.length ? Math.round((converted / shownLeads.length) * 100) : 0;

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
    showToast(`${added.name} added to New`);
  }

  function exportLeads() {
    downloadCsv(`chiranvi-leads-${toDateFileName(today)}.csv`, [
      ["Name", "Phone", "Source", "Reason", "Stage", "Note", "Came in", "Address", "Email", "Bulk order"],
      ...shownLeads.map((lead) => [
        lead.name,
        lead.phone,
        lead.source,
        LEAD_KIND_LABELS[getLeadKind(lead) as LeadKind] ?? "",
        LEAD_STAGES.find((stage) => stage.key === lead.stage)?.label ?? lead.stage,
        cardNote(lead),
        new Date(lead.createdAt).toLocaleDateString("en-GB"),
        lead.address ?? "",
        lead.email ?? "",
        (lead.bulkOrderItems ?? []).map((item) => `${item.productName} ${item.packLabel} × ${item.quantity}`).join("; "),
      ]),
    ]);
  }

  return (
    <div className={dashboardStyles["admin-dashboard"]}>
      <AdminPageTop
        title="Leads"
        description="Enquiries from social media, website, referrals and walk-ins, and people who haven't bought yet"
        searchText={searchText}
        onSearchTextChange={setSearchText}
        searchPlaceholder="Search name or phone..."
        actionLabel="Add lead"
        onAction={() => setIsAddOpen(true)}
        today={today}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        onRangeChange={(from, to) => {
          setRangeFrom(from);
          setRangeTo(to);
        }}
        onExport={exportLeads}
      />

      <AdminStatCards
        stats={[
          {
            label: "New leads",
            value: String(shownLeads.length),
            note: "↑ 12 vs last month",
            trend: "up",
            icon: ["M10 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M3 20.5a7 7 0 0 1 14 0", "M19 8v6", "M16 11h6"],
          },
          {
            label: "Contacted",
            value: String(contactedOrLater),
            note: "Avg reply in 3.2 h",
            trend: "plain",
            icon: [
              "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z",
            ],
          },
          {
            label: "Converted",
            value: String(converted),
            note: `₹${(converted * 1217).toLocaleString("en-IN")} first-month value`,
            trend: "plain",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M8.5 12.2l2.4 2.4 4.8-4.8"],
          },
          {
            label: "Conversion rate",
            value: `${conversionRate}%`,
            note: "↑ 4 pts vs last month",
            trend: "up",
            icon: ["M19 5L5 19", "M7 8.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z", "M17 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"],
          },
        ]}
      />

      <AdminFilterTabs
        label="Show leads"
        selected={leadFilter}
        onSelect={setLeadFilter}
        tabs={[
          { key: "all", label: tabLabel("All", "all") },
          { key: "profile-incomplete", label: tabLabel(LEAD_KIND_LABELS["profile-incomplete"], "profile-incomplete") },
          { key: "no-order", label: tabLabel(LEAD_KIND_LABELS["no-order"], "no-order") },
          { key: "location", label: tabLabel(LEAD_KIND_LABELS.location, "location") },
          { key: "bulk", label: tabLabel(LEAD_KIND_LABELS.bulk, "bulk") },
          { key: "social", label: tabLabel("Social media", "social") },
        ]}
      />

      <div className={styles["admin-leads-board"]}>
        {LEAD_STAGES.map((stage) => {
          const columnLeads = shownLeads.filter((lead) => lead.stage === stage.key);
          const isOpen = openColumns.has(stage.key);
          const visibleLeads = isOpen ? columnLeads : columnLeads.slice(0, CARDS_SHOWN_PER_COLUMN);
          const hiddenCount = columnLeads.length - visibleLeads.length;
          return (
            <section
              key={stage.key}
              aria-label={`${stage.label} leads`}
              className={`${styles["admin-leads-column"]} ${dropColumn === stage.key ? styles["admin-leads-column-drop"] : ""}`}
              onDragOver={(dragEvent) => {
                if (!draggedLeadId) return;
                dragEvent.preventDefault();
                setDropColumn(stage.key);
              }}
              onDragLeave={() => setDropColumn((current) => (current === stage.key ? null : current))}
              onDrop={(dropEvent) => {
                dropEvent.preventDefault();
                const lead = leads.find((existing) => existing.id === draggedLeadId);
                if (lead) moveTo(lead, stage.key);
                setDraggedLeadId(null);
                setDropColumn(null);
              }}
            >
              <h2 className={styles["admin-leads-column-title"]}>
                <span className={`${styles["admin-leads-column-dot"]} ${styles[`admin-leads-column-dot-${stage.key}`]}`} />
                {stage.label}
                <span className={styles["admin-leads-column-count"]}>{count(stage.key)}</span>
              </h2>

              <ul className={styles["admin-leads-cards"]}>
                {visibleLeads.map((lead) => (
                  <li
                    key={lead.id}
                    draggable
                    className={`${styles["admin-lead-card"]} ${draggedLeadId === lead.id ? styles["admin-lead-card-dragging"] : ""}`}
                    onDragStart={(dragEvent) => {
                      dragEvent.dataTransfer.effectAllowed = "move";
                      setDraggedLeadId(lead.id);
                    }}
                    onDragEnd={() => {
                      setDraggedLeadId(null);
                      setDropColumn(null);
                    }}
                    onClick={(clickEvent) => {
                      if (!(clickEvent.target as HTMLElement).closest("a, button")) setOpenLeadId(lead.id);
                    }}
                  >
                    <div className={styles["admin-lead-card-top"]}>
                      <span className={styles["admin-lead-initials"]} aria-hidden="true">
                        {getNameInitials(lead.name)}
                      </span>
                      <span className={styles["admin-lead-name"]}>{lead.name}</span>
                      <AdminRowMenu
                        label={`Move ${lead.name}`}
                        title="Move to"
                        options={[
                          ...LEAD_STAGES.filter((option) => option.key !== lead.stage).map((option) => ({
                            label: option.label,
                            onSelect: () => moveTo(lead, option.key),
                          })),
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
                    </div>
                    <a href={`tel:+91${lead.phone.replace(/\D/g, "")}`} className={styles["admin-lead-phone"]}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />
                      </svg>
                      {lead.phone}
                    </a>
                    <div className={styles["admin-lead-card-bottom"]}>
                      <span className={`${styles["admin-lead-source"]} ${styles[`admin-lead-source-${lead.source.toLowerCase().replace(/\W/g, "")}`]}`}>
                        {lead.source}
                      </span>
                      <span className={styles["admin-lead-note"]}>{cardNote(lead)}</span>
                    </div>
                  </li>
                ))}
              </ul>

              {(hiddenCount > 0 || isOpen) && columnLeads.length > CARDS_SHOWN_PER_COLUMN && (
                <button
                  type="button"
                  className={styles["admin-leads-more"]}
                  onClick={() =>
                    setOpenColumns((current) => {
                      const next = new Set(current);
                      if (next.has(stage.key)) next.delete(stage.key);
                      else next.add(stage.key);
                      return next;
                    })
                  }
                >
                  {isOpen ? "Show less" : `+ ${hiddenCount} more`}
                </button>
              )}
              {columnLeads.length === 0 && <p className={styles["admin-leads-empty"]}>Drop a lead here</p>}
            </section>
          );
        })}
      </div>

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
                <a href={`tel:+91${openLead.phone.replace(/\D/g, "")}`}>{openLead.phone}</a>
              </dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{openLead.source}</dd>
            </div>
            {getLeadKind(openLead) && (
              <div>
                <dt>Reason</dt>
                <dd>{LEAD_KIND_LABELS[getLeadKind(openLead) as LeadKind]}</dd>
              </div>
            )}
            <div>
              <dt>Stage</dt>
              <dd>{LEAD_STAGES.find((stage) => stage.key === openLead.stage)?.label}</dd>
            </div>
            <div>
              <dt>Came in</dt>
              <dd>{new Date(openLead.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</dd>
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
