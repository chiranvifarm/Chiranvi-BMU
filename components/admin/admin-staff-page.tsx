"use client";

import { useState } from "react";
import {
  STAFF_JOBS,
  STAFF_SHIFTS,
  addStaffPerson,
  getDaysPresent,
  removeStaffPerson,
  setTodayStatus,
  updateStaffPerson,
  useStaffList,
  type StaffGroup,
  type StaffPerson,
  type TodayStatus,
} from "@/store/admin-staff-store";
import { setAgentOnLeave } from "@/store/admin-routes-store";
import { useLoggedInMobileNumber } from "@/components/login/login-status";
import { giveTeamRole, useCurrentStaffAccess, useStaffMembers } from "@/store/staff-access-store";
import { PROFILE_FIELD_LABELS, ProfileChangesDialog } from "./admin-roles-page";
import { useLeaveRequests } from "@/store/admin-leave-store";
import AdminLeaveRequests from "./admin-leave-requests";
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
import styles from "./admin-staff-page.module.css";

/*
  Staff (/admin/staff), owner only (salaries), from the design 13-staff: the team, their shifts,
  attendance and salaries.
    top        search (name, job or phone), Add staff (pop-up form), Export
    numbers    total staff (delivery / farm / managers), present today (% attendance), on leave or absent
               (who; click to show only them), payroll this month, leave requests (click: the pop-up to
               read each request and its document, then approve or reject; admin-leave-requests.tsx)
    table      All / Delivery / Farm / Managers tabs; today's status, attendance this month, salary;
               "..." marks present / absent / on leave, edits job, phone, shift and salary, or removes
  Delivery agents are the same people as on Routes & agents: marking one absent or on leave takes them
  off duty there, and a new delivery agent is added there as a spare.
  Who can open the panel is on Roles & permissions. The team comes from store/admin-staff-store.ts.
*/

const PAGE_SIZE = 14;

type GroupTab = "all" | StaffGroup;

const TODAY_CLASS_NAMES: Record<TodayStatus, string> = {
  Present: dashboardStyles["admin-status-delivered"],
  Absent: sharedStyles["admin-status-warning"],
  "On leave": sharedStyles["admin-status-cancelled"],
};

const initialsOf = (fullName: string) =>
  fullName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const formatPhone = (phone: string) => phone.replace(/(\d{5})(\d{5})/, "$1 $2");
const rupees = (amount: number) => `₹${amount.toLocaleString("en-IN")}`;

type StaffForm = { name: string; job: string; phone: string; shift: string; salary: string };
const EMPTY_FORM: StaffForm = { name: "", job: STAFF_JOBS[0].job, phone: "", shift: STAFF_SHIFTS[1], salary: "" };

export default function AdminStaffPage() {
  return (
    <AdminFeatureGate feature="staff">
      <StaffPage />
    </AdminFeatureGate>
  );
}

function StaffPage() {
  const access = useCurrentStaffAccess();
  const canGiveRoles = Boolean(access?.isOwner || access?.roleId === "manager");
  // Profile requests from the team
  const myMobileNumber = useLoggedInMobileNumber();
  const team = useStaffMembers();
  const [profileChangesOf, setProfileChangesOf] = useState<string | null>(null);
  const memberWithChanges = team.find((member) => member.mobileNumber === profileChangesOf);
  const [isProfileRequestsOpen, setIsProfileRequestsOpen] = useState(false);
  const membersWaiting = team.filter((member) => member.profileChange?.status === "Pending");
  const staff = useStaffList();
  const [today] = useState(() => new Date());
  const [searchText, setSearchText] = useState("");
  const [tab, setTab] = useState<GroupTab>("all");
  const [isAwayOnly, setIsAwayOnly] = useState(false);
  const [page, setPage] = useState(1);
  // null: no form; "new": Add staff; otherwise the person being edited
  const [editing, setEditing] = useState<StaffPerson | "new" | null>(null);
  const [form, setForm] = useState<StaffForm>(EMPTY_FORM);
  const [personToRemove, setPersonToRemove] = useState<StaffPerson | null>(null);
  const [isLeaveOpen, setIsLeaveOpen] = useState(false);
  const waitingLeave = useLeaveRequests().filter((request) => request.status === "Pending");
  const sickWaiting = waitingLeave.filter((request) => request.type === "Sick" || request.type === "Emergency").length;
  const { showToast, toast } = useAdminToast();
  // Sensitive actions only the owner can do (Roles & permissions)
  const isOwner = useIsPanelOwner();

  const monthName = today.toLocaleDateString("en-IN", { month: "short" });
  const words = searchText.trim().toLowerCase();
  const matching = staff.filter(
    (person) => !words || `${person.name} ${person.job} ${person.phone}`.toLowerCase().includes(words),
  );
  const shown = matching.filter(
    (person) => (tab === "all" || person.group === tab) && (!isAwayOnly || person.today !== "Present"),
  );
  const pageItems = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const countIn = (group: StaffGroup) => staff.filter((person) => person.group === group).length;

  const present = staff.filter((person) => person.today === "Present").length;
  const away = staff.filter((person) => person.today !== "Present");
  const payroll = staff.reduce((sum, person) => sum + person.salary, 0);
  const payday = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  function changeToday(person: StaffPerson, status: TodayStatus) {
    setTodayStatus(person.id, status);
    // Delivery agents: off duty on Routes & agents too
    if (person.group === "Delivery") setAgentOnLeave(person.name, status !== "Present");
    showToast(`${person.name} marked ${status.toLowerCase()}`);
  }

  function openForm(person: StaffPerson | "new") {
    setEditing(person);
    setForm(
      person === "new"
        ? EMPTY_FORM
        : { name: person.name, job: person.job, phone: person.phone, shift: person.shift, salary: String(person.salary) },
    );
  }

  async function makeStaff(person: StaffPerson) {
    const problem = await giveTeamRole(person.phone, "staff");
    showToast(problem ?? `${person.name} is now Staff`);
  }

  async function saveForm() {
    const phone = form.phone.replace(/\D/g, "");
    const salary = Number(form.salary);
    if ((editing === "new" && !form.name.trim()) || phone.length !== 10 || !salary) {
      showToast(editing === "new" ? "Enter the name, a 10-digit phone and the salary" : "Enter a 10-digit phone and the salary");
      return;
    }
    const group = STAFF_JOBS.find((staffJob) => staffJob.job === form.job)?.group ?? "Farm";
    if (editing === "new") {
      const added = await addStaffPerson({ name: form.name.trim(), job: form.job, group, phone, shift: form.shift, salary });
      if ("error" in added) {
        showToast(added.error);
        return;
      }
      setTab("all");
      setIsAwayOnly(false);
      setPage(Math.ceil((staff.length + 1) / PAGE_SIZE));
      showToast(`${added.name} added to the team${group === "Delivery" ? " · also on Routes & agents" : ""}`);
    } else if (editing) {
      if (!isOwner && salary !== editing.salary) {
        showToast(OWNER_ONLY_MESSAGE);
        return;
      }
      updateStaffPerson(editing.id, { job: form.job, group, phone, shift: form.shift, salary });
      showToast(`${editing.name} saved`);
    }
    setEditing(null);
  }

  function exportStaff() {
    downloadCsv(`chiranvi-staff-${toDateFileName(today)}.csv`, [
      ["Name", "Job", "Team", "Phone", "Shift", "Today", `Days present (${monthName})`, `Days so far`, "Salary (₹ a month)"],
      ...shown.map((person) => [
        person.name,
        person.job,
        person.group,
        person.phone,
        person.shift,
        person.today,
        getDaysPresent(person, today),
        today.getDate(),
        person.salary,
      ]),
    ]);
  }

  return (
    <div className={dashboardStyles["admin-dashboard"]}>
      <AdminPageTop
        title="Staff"
        description="Your team, shifts, attendance and salaries"
        searchText={searchText}
        onSearchTextChange={(text) => {
          setSearchText(text);
          setPage(1);
        }}
        searchPlaceholder="Search name, job or phone..."
        actionLabel="Add staff"
        onAction={() => openForm("new")}
        beforeExport={
          <button type="button" className={dashboardStyles["admin-export-button"]} onClick={() => setIsProfileRequestsOpen(true)}>
            Profile requests
            {membersWaiting.length > 0 && <span className={styles["admin-staff-requests-count"]}>{membersWaiting.length}</span>}
          </button>
        }
        onExport={exportStaff}
      />

      <AdminStatCards
        stats={[
          {
            label: "Total staff",
            value: String(staff.length),
            note: `${countIn("Delivery")} delivery · ${countIn("Farm")} farm · ${countIn("Managers")} managers`,
            trend: "plain",
            icon: ["M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z", "M3 20a6 6 0 0 1 12 0", "M16 4.5a3.5 3.5 0 0 1 0 6.5", "M18 14.5a6 6 0 0 1 3 5.5"],
          },
          {
            label: "Present today",
            value: String(present),
            note: `${staff.length ? Math.round((present / staff.length) * 100) : 0}% attendance`,
            trend: "up",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M8.5 12.2l2.4 2.4 4.8-4.8"],
          },
          {
            label: "On leave / absent",
            value: String(away.length),
            note: away.length ? away.map((person) => person.name).join(", ") : "Everyone is in",
            trend: "plain",
            icon: ["M4 6h16v14H4z", "M4 10h16M8 3.5v4M16 3.5v4"],
            onClick: () => {
              setIsAwayOnly(!isAwayOnly);
              setPage(1);
            },
            isSelected: isAwayOnly,
            clickLabel: "Show who is on leave or absent",
          },
          {
            label: "Payroll this month",
            value: rupees(payroll),
            note: `Paid on ${payday.getDate()} ${payday.toLocaleDateString("en-IN", { month: "short" })}`,
            trend: "plain",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M9 8h6M9 11h6M13 8c2 0 2 6-4 6l5 3"],
          },
          {
            label: "Leave requests",
            value: String(waitingLeave.length),
            note: waitingLeave.length ? `Waiting for you${sickWaiting ? ` · ${sickWaiting} urgent` : ""}` : "All decided",
            // Priority: red while requests are waiting
            trend: waitingLeave.length ? "bad" : "plain",
            icon: ["M6 3.5h9l3.5 3.5v13.5h-12.5z", "M15 3.5V7h3.5", "M9 12h6M9 15.5h4"],
            onClick: () => setIsLeaveOpen(true),
            clickLabel: "Open leave requests",
          },
        ]}
      />

      <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-staff-heading">
        <div className={dashboardStyles["admin-card-heading-row"]}>
          <div>
            <h2 id="admin-staff-heading" className={dashboardStyles["admin-card-title"]}>
              Team
            </h2>
            <p className={dashboardStyles["admin-card-subtitle"]}>
              {isAwayOnly ? "Showing who is on leave or absent today" : "Attendance is marked from the staff app at shift start"}
            </p>
          </div>
          <AdminFilterTabs
            label="Show team"
            selected={tab}
            onSelect={(newTab) => {
              setTab(newTab);
              setPage(1);
            }}
            tabs={[
              { key: "all", label: `All ${staff.length}` },
              { key: "Delivery", label: "Delivery" },
              { key: "Farm", label: "Farm" },
              { key: "Managers", label: "Managers" },
            ]}
          />
        </div>

        <div className={dashboardStyles["admin-table-scroll"]}>
          <table className={dashboardStyles["admin-orders-table"]}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Phone</th>
                <th scope="col">Shift</th>
                <th scope="col">Today</th>
                <th scope="col">Attendance ({monthName})</th>
                <th scope="col">Salary</th>
                <th scope="col" className={dashboardStyles["admin-orders-actions"]}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((person, index) => {
                const daysPresent = getDaysPresent(person, today);
                return (
                  <tr key={person.id}>
                    <td>
                      <span className={sharedStyles["admin-person-cell"]}>
                        <span className={`${sharedStyles["admin-initials"]} ${index % 2 ? sharedStyles["admin-initials-yellow"] : ""}`} aria-hidden="true">
                          {initialsOf(person.name)}
                        </span>
                        <span>
                          <span className={dashboardStyles["admin-orders-customer"]}>{person.name}</span>
                          <span className={dashboardStyles["admin-orders-area"]}>{person.job}</span>
                        </span>
                      </span>
                    </td>
                    <td className={dashboardStyles["admin-orders-muted"]}>
                      <a href={`tel:+91${person.phone}`} className={sharedStyles["admin-phone-link"]}>
                        {formatPhone(person.phone)}
                      </a>
                    </td>
                    <td className={dashboardStyles["admin-orders-muted"]}>{person.shift}</td>
                    <td>
                      <span className={`${dashboardStyles["admin-status"]} ${TODAY_CLASS_NAMES[person.today]}`}>{person.today}</span>
                    </td>
                    <td>
                      <span className={styles["admin-attendance-cell"]}>
                        <span className={styles["admin-attendance-bar"]} aria-hidden="true">
                          <span style={{ width: `${(daysPresent / today.getDate()) * 100}%` }} />
                        </span>
                        <span className={styles["admin-attendance-days"]}>
                          {daysPresent} / {today.getDate()} days
                        </span>
                      </span>
                    </td>
                    <td className={dashboardStyles["admin-orders-amount"]}>{rupees(person.salary)}</td>
                    <td className={dashboardStyles["admin-orders-actions"]}>
                      <AdminRowMenu
                        label={`Actions for ${person.name}`}
                        title={person.name}
                        options={[
                          ...(["Present", "Absent", "On leave"] as TodayStatus[]).map((status) => ({
                            label: `Mark ${status.toLowerCase()}`,
                            isDisabled: person.today === status,
                            onSelect: () => changeToday(person, status),
                          })),
                          { label: "Edit job, shift & salary", onSelect: () => openForm(person) },
                          // The owner or a manager; shown on Roles & permissions too
                          ...(canGiveRoles && (person.roleId === null || person.roleId === "delivery-agent")
                            ? [{ label: "Make Staff", onSelect: () => void makeStaff(person) }]
                            : []),
                          { label: "Remove from team", isDanger: true, permission: "delete", onSelect: () => setPersonToRemove(person) },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={7} className={dashboardStyles["admin-orders-empty"]}>
                    {isAwayOnly ? "Everyone is in today." : "No one matches this search."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <AdminPagination page={page} pageSize={PAGE_SIZE} total={shown.length} onPageChange={setPage} itemName="staff" />
      </section>

      {editing && (
        <AdminDialog
          title={editing === "new" ? "Add staff" : `Edit ${editing.name}`}
          submitLabel={editing === "new" ? "Add staff" : "Save"}
          onClose={() => setEditing(null)}
          onSubmit={saveForm}
        >
          {editing === "new" && (
            <AdminDialogField label="Name">
              <input
                className={adminInputClassName}
                value={form.name}
                onChange={(changeEvent) => setForm({ ...form, name: changeEvent.target.value })}
                autoFocus
              />
            </AdminDialogField>
          )}
          <AdminDialogField label="Job">
            <select className={adminInputClassName} value={form.job} onChange={(changeEvent) => setForm({ ...form, job: changeEvent.target.value })}>
              {STAFF_JOBS.map((staffJob) => (
                <option key={staffJob.job} value={staffJob.job}>
                  {staffJob.job} ({staffJob.group})
                </option>
              ))}
            </select>
          </AdminDialogField>
          <AdminDialogField label="Phone">
            <input
              className={adminInputClassName}
              inputMode="numeric"
              placeholder="10 digits"
              value={form.phone}
              onChange={(changeEvent) => setForm({ ...form, phone: changeEvent.target.value.replace(/\D/g, "").slice(0, 10) })}
            />
          </AdminDialogField>
          <AdminDialogField label="Shift">
            <select className={adminInputClassName} value={form.shift} onChange={(changeEvent) => setForm({ ...form, shift: changeEvent.target.value })}>
              {STAFF_SHIFTS.map((shift) => (
                <option key={shift}>{shift}</option>
              ))}
            </select>
          </AdminDialogField>
          <AdminDialogField label="Salary (₹ a month)" isWide={editing !== "new"}>
            <input
              className={adminInputClassName}
              inputMode="numeric"
              value={form.salary}
              onChange={(changeEvent) => setForm({ ...form, salary: changeEvent.target.value.replace(/\D/g, "") })}
            />
          </AdminDialogField>
        </AdminDialog>
      )}

      {personToRemove && (
        <AdminDialog
          title={`Remove ${personToRemove.name}?`}
          submitLabel="Remove"
          onClose={() => setPersonToRemove(null)}
          onSubmit={() => {
            removeStaffPerson(personToRemove.id);
            showToast(`${personToRemove.name} removed from the team`);
            setPersonToRemove(null);
          }}
        >
          <p className={styles["admin-staff-dialog-note"]}>
            {personToRemove.name} ({personToRemove.job}) will be taken off the team list and payroll.
            {personToRemove.group === "Delivery" ? " Their route on Routes & agents stays until you give it to someone else." : ""}
          </p>
        </AdminDialog>
      )}

      {isProfileRequestsOpen && (
        <AdminDialog
          title="Profile requests"
          submitLabel="Close"
          hasOnlyCloseButton
          onClose={() => setIsProfileRequestsOpen(false)}
          onSubmit={() => setIsProfileRequestsOpen(false)}
        >
          {membersWaiting.length === 0 ? (
            <p className={styles["admin-staff-requests-empty"]}>No profile requests waiting.</p>
          ) : (
            <ul className={styles["admin-staff-requests-list"]}>
              {membersWaiting.map((member) => (
                <li key={member.mobileNumber}>
                  <button
                    type="button"
                    className={styles["admin-staff-request-person"]}
                    onClick={() => {
                      setIsProfileRequestsOpen(false);
                      setProfileChangesOf(member.mobileNumber);
                    }}
                  >
                    <span className={styles["admin-staff-request-top-row"]}>
                      <span>{member.name}</span>
                      <span className={styles["admin-staff-request-phone"]}>{formatPhone(member.mobileNumber)}</span>
                    </span>
                    <span className={styles["admin-staff-request-fields"]}>
                      {Object.keys(member.profileChange?.changes ?? {})
                        .map((field) => PROFILE_FIELD_LABELS[field] ?? field)
                        .join(", ")}
                    </span>
                    <span className={styles["admin-staff-request-reason"]}>{member.profileChange?.reason}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </AdminDialog>
      )}

      {memberWithChanges && (
        <ProfileChangesDialog
          member={memberWithChanges}
          canDecide={Boolean(access?.can("staff", "edit")) && memberWithChanges.mobileNumber !== myMobileNumber}
          // Back to the list of cards
          onClose={() => {
            setProfileChangesOf(null);
            setIsProfileRequestsOpen(true);
          }}
          onDone={showToast}
        />
      )}

      {isLeaveOpen && <AdminLeaveRequests staff={staff} onClose={() => setIsLeaveOpen(false)} showToast={showToast} />}

      {toast}
    </div>
  );
}
