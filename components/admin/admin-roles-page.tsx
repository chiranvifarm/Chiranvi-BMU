"use client";

import { useEffect, useRef, useState } from "react";
import { formatIndianMobileNumber } from "@/components/account/account-profile";
import {
  OWNER_ROLE,
  PANEL_MODULES,
  PERMISSION_ACTIONS,
  addRole,
  declineAccountDeletion,
  deleteRoleWithSecret,
  decideProfileChange,
  removeStaffMember,
  renameRole,
  changeOwnerNumber,
  checkOwnerResetCode,
  saveOwnerName,
  saveOwnPassword,
  saveManagerPermissions,
  saveRolePermissions,
  saveStaffMember,
  sendOwnerResetCode,
  transferOwnership,
  useCurrentStaffAccess,
  useOwnerDetails,
  usePanelRoles,
  useStaffMembers,
  type PanelModule,
  type PanelRole,
  type PermissionAction,
  type RolePermissions,
  type StaffMember,
} from "@/store/staff-access-store";
import { useLoggedInMobileNumber } from "@/components/login/login-status";
import { decideLeave, getLeaveDays, useLeaveRequests, type LeaveRequest } from "@/store/admin-leave-store";
import { saveCustomerProfile, useCustomerProfile } from "@/store/customer-profiles-store";
import { AdminFeatureGate } from "./admin-panel-layout";
import {
  AdminDialog,
  AdminDialogField,
  AdminPageTop,
  adminInputClassName,
  useAdminToast,
  useIsPanelOwner,
} from "./admin-shared";
import dashboardStyles from "./admin-dashboard.module.css";
import sharedStyles from "./admin-shared.module.css";
import styles from "./admin-roles-page.module.css";

/*
  Roles & permissions (/admin/roles), from the design 15-roles-permissions: who in the team can see and
  change what.
    left       the roles (Owner, Manager, Delivery agent, and any added) with how many people
               have each; "Add new role"; the people with the chosen role ("Invite person" gives a
               mobile number that role; the owner can change their own name and number; a red "!" marks
               someone who asked to delete their account); what each role can do
    right      the chosen role's permissions: for every panel page, View / Create / Edit / Delete /
               Export. View opens the page; Create shows its New / Add button, Export its Export button,
               Edit and Delete the changes in its row menus and delete buttons. Reset / Save.
               Manager: "Responsibilities for" chooses one manager, who gets their own ticks ("Use default"
               puts them back on the Manager role's); the role's own ticks are for managers without any.
               The owner can always do everything; delivery agents only use the delivery app.
               Staff (chosen on the left): the whole team instead (everyone but the owner, from the
               database): name, number, leave (Approve / Reject), delete request (the tag opens Accept /
               Reject), and Actions: ⋮ opens the Edit pop-up (promote / demote with its Role box, and
               "Remove from team"). Its card on the left counts the leave and delete requests waiting.
               The owner or a manager removes people (a manager not the owner or other managers);
               only the owner promotes / demotes.
    roles      "Add new role" and "Delete role" (the owner, after their PIN / password; only a role nobody
               has; Owner and Delivery agent never).
    note       sensitive actions (prices, salaries, deleting customers, refunds above ₹500) always need
               the owner.
  Only the owner changes anything here; anyone else with View on this page can only look.
  Roles and people come from store/staff-access-store.ts (staff_members). People are added in the Staff
  section; "Invite person" gives a role to one of them (picked from a drop-down of everyone on the list,
  with their mobile number filled in).
  The Staff card lists everyone on the staff list; Invite can also change someone's role (a promotion).
*/

const ROLE_ICONS: Record<string, string[]> = {
  owner: ["M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z", "M8.5 12l2.5 2.5L16 9.5"],
  "delivery-agent": ["M2.5 6.5h11v9.5h-11z", "M13.5 9.5h4l3.5 3.5v3h-7.5", "M6.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"],
};
const PEOPLE_ICON = ["M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z", "M3 20a6 6 0 0 1 12 0", "M16 4.5a3.5 3.5 0 0 1 0 6.5", "M18 14.5a6 6 0 0 1 3 5.5"];

const initialsOf = (fullName: string) =>
  fullName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

// "managers", "admins", "delivery agents"
const pluralOf = (roleName: string) => (roleName.endsWith("s") ? roleName.toLowerCase() : `${roleName.toLowerCase()}s`);

// What a role can do, in one short line
function summaryOf(role: PanelRole) {
  if (role.id === "owner") return "Everything, including prices, staff salaries and roles";
  if (!role.hasPanelAccess) return "Only the delivery app: route, assigned customers and proof of delivery";
  const pages = PANEL_MODULES.filter((module) => role.permissions[module.key].view).map((module) => module.label);
  if (pages.length === 0) return "Nothing yet: tick the pages they can see";
  if (pages.length === PANEL_MODULES.length) return "Every page";
  const shown = pages.slice(0, 4).join(", ");
  return pages.length > 4 ? `${shown} and ${pages.length - 4} more` : shown;
}

const samePermissions = (first: RolePermissions, second: RolePermissions) => JSON.stringify(first) === JSON.stringify(second);

// isInvite: giving a role to someone from the Staff section (picked from the drop-down); otherwise editing
type PersonForm = { name: string; mobileNumber: string; roleId: string; title: string; isInvite?: boolean };

export default function AdminRolesPage() {
  return (
    <AdminFeatureGate feature="roles">
      <RolesPage />
    </AdminFeatureGate>
  );
}

function RolesPage() {
  const roles = usePanelRoles();
  const team = useStaffMembers();
  const owner = useOwnerDetails();
  const isOwner = useIsPanelOwner();
  const [searchText, setSearchText] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("manager");
  // The manager whose own responsibilities are shown (empty: the Manager role's defaults)
  const [chosenManagerMobile, setChosenManagerMobile] = useState("");
  // Unsaved ticks, per role or manager, until Save or Reset
  const [drafts, setDrafts] = useState<Record<string, RolePermissions>>({});
  const [isAddRoleOpen, setIsAddRoleOpen] = useState(false);
  const [roleName, setRoleName] = useState("");
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [personForm, setPersonForm] = useState<PersonForm | null>(null);
  // The owner's profile pop-up (details, password, transfer ownership), from the chip at the top right
  const [isOwnerPanelOpen, setIsOwnerPanelOpen] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<StaffMember | null>(null);
  // "Delete role": the role chosen and the owner's PIN / password
  const [isDeleteRoleOpen, setIsDeleteRoleOpen] = useState(false);
  const [roleToDeleteId, setRoleToDeleteId] = useState("");
  const [deleteRoleSecret, setDeleteRoleSecret] = useState("");
  const [deleteRoleProblem, setDeleteRoleProblem] = useState("");
  const [isDeletingRole, setIsDeletingRole] = useState(false);
  // Staff: the person whose leave requests are open
  const [leaveOf, setLeaveOf] = useState<StaffMember | null>(null);
  // Whose Profile request is open
  const [profileChangesOf, setProfileChangesOf] = useState<string | null>(null);
  const memberWithChanges = team.find((member) => member.mobileNumber === profileChangesOf);
  const leaveRequests = useLeaveRequests();
  const myAccess = useCurrentStaffAccess();
  const myMobileNumber = useLoggedInMobileNumber();
  const { showToast, toast } = useAdminToast();

  const allRoles = [OWNER_ROLE, ...roles];
  const selectedRole = allRoles.find((role) => role.id === selectedRoleId) ?? allRoles[0];
  const isLocked = !isOwner || selectedRole.id === "owner" || !selectedRole.hasPanelAccess;
  const managers = team.filter((member) => member.roleId === "manager");
  const chosenManager = selectedRole.id === "manager" ? managers.find((member) => member.mobileNumber === chosenManagerMobile) : undefined;
  const draftKey = chosenManager ? `manager:${chosenManager.mobileNumber}` : selectedRole.id;
  const savedPermissions = chosenManager?.permissions ?? selectedRole.permissions;
  const shownPermissions = drafts[draftKey] ?? savedPermissions;
  const hasUnsavedChanges = Boolean(drafts[draftKey]) && !samePermissions(drafts[draftKey], savedPermissions);
  const gridName = chosenManager?.name ?? selectedRole.name;

  // The Staff card counts everyone on the staff list (managers and delivery agents too); the others their own
  const peopleIn = (role: PanelRole) =>
    role.id === "owner" ? 1 : role.id === "staff" ? team.length : team.filter((member) => member.roleId === role.id).length;
  const totalPeople = 1 + team.length;

  // People shown on the left: the chosen role's (Staff: everyone on the staff list), or everyone matching the search
  const words = searchText.trim().toLowerCase();
  type PersonRow = { key: string; name: string; detail: string; member?: StaffMember; isOwnerRow?: boolean; roleName?: string };
  const everyone: (PersonRow & { roleId: string | null })[] = [
    { key: owner.mobileNumber, name: owner.name, detail: `Owner · ${formatIndianMobileNumber(owner.mobileNumber)}`, isOwnerRow: true, roleId: "owner" },
    ...team.map((member) => ({
      key: member.mobileNumber,
      name: member.name,
      detail: `${member.title ? `${member.title} · ` : ""}${formatIndianMobileNumber(member.mobileNumber)}`,
      member,
      roleId: member.roleId,
    })),
  ];
  const shownPeople = (words
    ? everyone.filter((person) => `${person.name} ${person.detail}`.toLowerCase().includes(words))
    : selectedRole.id === "staff"
      ? everyone.filter((person) => !person.isOwnerRow)
      : everyone.filter((person) => person.roleId === selectedRole.id)
  ).map((person) => ({ ...person, roleName: allRoles.find((role) => role.id === person.roleId)?.name ?? "No role" }));

  // Ticking any action ticks View; unticking View unticks the rest
  function toggle(module: PanelModule, action: PermissionAction) {
    const current = shownPermissions[module];
    const isOn = !current[action];
    const next =
      action === "view" && !isOn
        ? { view: false, create: false, edit: false, delete: false, export: false }
        : { ...current, [action]: isOn, view: current.view || isOn };
    setDrafts({ ...drafts, [draftKey]: { ...shownPermissions, [module]: next } });
  }

  function toggleColumn(action: PermissionAction) {
    const isAllOn = PANEL_MODULES.every((module) => shownPermissions[module.key][action]);
    const next = Object.fromEntries(
      PANEL_MODULES.map((module) => {
        const current = shownPermissions[module.key];
        const value = !isAllOn;
        return [
          module.key,
          action === "view" && !value
            ? { view: false, create: false, edit: false, delete: false, export: false }
            : { ...current, [action]: value, view: current.view || value },
        ];
      }),
    ) as RolePermissions;
    setDrafts({ ...drafts, [draftKey]: next });
  }

  function resetDraft() {
    const rest = { ...drafts };
    delete rest[draftKey];
    setDrafts(rest);
  }

  async function savePermissions() {
    if (chosenManager) {
      const problem = await saveManagerPermissions(chosenManager.mobileNumber, shownPermissions);
      if (problem) {
        showToast(problem);
        return;
      }
    } else {
      saveRolePermissions(selectedRole.id, shownPermissions);
    }
    resetDraft();
    showToast(`${gridName} permissions saved`);
  }

  // The chosen manager follows the Manager role again
  async function followManagerDefaults() {
    if (!chosenManager) return;
    const problem = await saveManagerPermissions(chosenManager.mobileNumber, null);
    if (problem) {
      showToast(problem);
      return;
    }
    resetDraft();
    showToast(`${chosenManager.name} now follows the Manager defaults`);
  }

  function saveNewRole() {
    const name = roleName.trim();
    if (!name) {
      showToast("Enter a name for the role");
      return;
    }
    if (allRoles.some((role) => role.name.toLowerCase() === name.toLowerCase())) {
      showToast(`There is already a ${name} role`);
      return;
    }
    const added = addRole(name);
    setIsAddRoleOpen(false);
    setRoleName("");
    setSelectedRoleId(added.id);
    showToast(`${added.name} added. Tick what they can do, then Save`);
  }

  function saveRename() {
    const name = roleName.trim();
    if (!name) return;
    renameRole(selectedRole.id, name);
    setIsRenameOpen(false);
    showToast(`Role renamed to ${name}`);
  }

  function savePerson() {
    if (!personForm) return;
    if (personForm.isInvite && !personForm.mobileNumber) {
      showToast("Choose a person from the Staff section");
      return;
    }
    const mobileNumber = personForm.mobileNumber.replace(/\D/g, "");
    if (!personForm.name.trim() || mobileNumber.length !== 10) {
      showToast("Enter the name and a 10-digit mobile number");
      return;
    }
    if (mobileNumber === owner.mobileNumber) {
      showToast("That is the owner's number");
      return;
    }
    const existing = team.find((member) => member.mobileNumber === mobileNumber);
    const hadRole = Boolean(existing?.roleId);
    saveStaffMember({ name: personForm.name.trim(), mobileNumber, roleId: personForm.roleId, title: personForm.title.trim() || existing?.title });
    const role = allRoles.find((item) => item.id === personForm.roleId);
    setPersonForm(null);
    setSelectedRoleId(personForm.roleId);
    showToast(
      hadRole
        ? `${personForm.name.trim()} is now ${role?.name}`
        : `${personForm.name.trim()} can now log in with ${formatIndianMobileNumber(mobileNumber)} as ${role?.name}`,
    );
  }

  // Invite person: everyone on the staff list; giving someone who has a role another one changes it (a promotion)
  const roleNameOf = (member: StaffMember) => allRoles.find((role) => role.id === member.roleId)?.name ?? "No role";

  // Staff: what waits for the admin (shown as a count on the Staff card)
  const isOnTeam = (mobileNumber: string) => team.some((member) => member.mobileNumber === mobileNumber);
  const pendingLeaveOf = (mobileNumber: string) => leaveRequests.filter((request) => request.staffMobile === mobileNumber && request.status === "Pending");
  const waitingChangesOf = (member: StaffMember) => (member.profileChange?.status === "Pending" ? 1 : 0);
  const staffAlertCount =
    leaveRequests.filter((request) => request.status === "Pending" && isOnTeam(request.staffMobile)).length +
    team.filter((member) => member.deleteRequestedAt).length +
    team.reduce((sum, member) => sum + waitingChangesOf(member), 0);
  // The owner removes anyone; a manager removes anyone who isn't a manager (the database checks it too)
  const canRemove = (member: StaffMember) => isOwner || (myAccess?.roleId === "manager" && member.roleId !== "manager");
  const canDecideLeave = Boolean(myAccess?.can("staff", "edit"));

  // Roles that can be deleted: not Owner or Delivery agent (the delivery app needs it)
  const deletableRoles = roles.filter((role) => role.id !== "delivery-agent");

  async function deleteChosenRole() {
    const role = deletableRoles.find((item) => item.id === roleToDeleteId);
    if (!role) {
      setDeleteRoleProblem("Choose the role to delete");
      return;
    }
    if (peopleIn(role) > 0) {
      setDeleteRoleProblem(`Move the ${peopleIn(role)} ${peopleIn(role) === 1 ? "person" : "people"} with ${role.name} to another role first`);
      return;
    }
    if (!deleteRoleSecret) {
      setDeleteRoleProblem("Enter your PIN or password");
      return;
    }
    setIsDeletingRole(true);
    const problem = await deleteRoleWithSecret(role.id, deleteRoleSecret);
    setIsDeletingRole(false);
    if (problem) {
      setDeleteRoleProblem(problem);
      return;
    }
    setIsDeleteRoleOpen(false);
    if (selectedRoleId === role.id) setSelectedRoleId("manager");
    showToast(`${role.name} role deleted`);
  }

  // Reject a request to delete an account: it is cleared (the person can ask again)
  async function rejectDeleteRequest(member: StaffMember) {
    const problem = await declineAccountDeletion(member.mobileNumber);
    showToast(problem ?? `${member.name}'s request to delete their account was rejected`);
  }

  function decideLeaveRequest(request: LeaveRequest, status: "Approved" | "Rejected") {
    decideLeave(request.id, status, myAccess?.name ?? "Admin");
    showToast(`${request.type} leave ${status.toLowerCase()} for ${request.staffName}`);
  }

  return (
    <div className={dashboardStyles["admin-dashboard"]}>
      <AdminPageTop
        title="Roles & permissions"
        description={isOwner ? "Control who in your team can see and change what" : "Who in the team can see and change what (only the owner can change this)"}
        searchText={searchText}
        onSearchTextChange={setSearchText}
        searchPlaceholder="Search people..."
        isBellFirst
        headerEnd={
          isOwner && owner.name ? (
            <button
              type="button"
              className={styles["admin-owner-chip"]}
              onClick={() => setIsOwnerPanelOpen(true)}
              aria-haspopup="dialog"
              aria-label={`Your owner profile: ${owner.name}`}
              title={`${owner.name} · Owner`}
            >
              {initialsOf(owner.name)}
            </button>
          ) : null
        }
      />

      <div className={styles["admin-roles-columns"]}>
        {/* ---------- Left: roles, people, what each role can do ---------- */}
        <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-roles-list-heading">
          <h2 id="admin-roles-list-heading" className={dashboardStyles["admin-card-title"]}>
            Roles
          </h2>
          <p className={dashboardStyles["admin-card-subtitle"]}>
            {allRoles.length} roles · {totalPeople} people
          </p>

          <ul className={styles["admin-role-list"]}>
            {allRoles.map((role) => {
              const count = peopleIn(role);
              return (
                <li key={role.id}>
                  <button
                    type="button"
                    aria-pressed={role.id === selectedRole.id}
                    className={`${styles["admin-role-button"]} ${role.id === selectedRole.id ? styles["admin-role-button-selected"] : ""}`}
                    onClick={() => {
                      setSelectedRoleId(role.id);
                      setSearchText("");
                    }}
                  >
                    <span className={styles["admin-role-icon"]} aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        {(ROLE_ICONS[role.id] ?? PEOPLE_ICON).map((path) => (
                          <path key={path} d={path} />
                        ))}
                      </svg>
                    </span>
                    <span className={styles["admin-role-text"]}>
                      <span className={styles["admin-role-name"]}>{role.name}</span>
                      <span className={styles["admin-role-count"]}>
                        {count} {count === 1 ? "person" : "people"}
                        {role.id === "owner" ? " · full access" : role.hasPanelAccess ? "" : " · delivery app only"}
                        {drafts[role.id] && !samePermissions(drafts[role.id], role.permissions) ? " · not saved" : ""}
                      </span>
                    </span>
                    {/* Staff: leave and delete requests waiting for the admin */}
                    {role.id === "staff" && staffAlertCount > 0 && (
                      <span className={styles["admin-role-alert-count"]} aria-label={`${staffAlertCount} requests waiting`}>
                        {staffAlertCount}
                      </span>
                    )}
                    <svg viewBox="0 0 24 24" className={styles["admin-role-arrow"]} aria-hidden="true">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>

          {isOwner && (
            <div className={styles["admin-role-add-row"]}>
              <button
                type="button"
                className={styles["admin-role-add"]}
                onClick={() => {
                  setRoleName("");
                  setIsAddRoleOpen(true);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add new role
              </button>
              <button
                type="button"
                className={`${styles["admin-role-add"]} ${styles["admin-role-delete"]}`}
                onClick={() => {
                  setRoleToDeleteId("");
                  setDeleteRoleSecret("");
                  setDeleteRoleProblem("");
                  setIsDeleteRoleOpen(true);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12h14" />
                </svg>
                Delete role
              </button>
            </div>
          )}

          <h3 className={styles["admin-roles-section-title"]}>{words ? "People matching the search" : "People with this role"}</h3>
          <ul className={styles["admin-person-list"]}>
            {shownPeople.map((person, index) => (
              <li key={person.key} className={styles["admin-person-row"]}>
                <span className={`${sharedStyles["admin-initials"]} ${index % 2 ? sharedStyles["admin-initials-yellow"] : ""}`} aria-hidden="true">
                  {initialsOf(person.name)}
                </span>
                <span className={styles["admin-person-text"]}>
                  <span className={styles["admin-person-name"]}>
                    {person.name}
                    {person.isOwnerRow && isOwner ? " (You)" : ""}
                    {/* They asked (Profile → Delete account → Request): Staff on the right accepts or rejects it */}
                    {person.member?.deleteRequestedAt && (
                      <span className={styles["admin-person-delete-mark"]} title="Requested account deletion" aria-label="Requested account deletion">
                        !
                      </span>
                    )}
                    {person.member && waitingChangesOf(person.member) > 0 && (
                      <span className={styles["admin-person-delete-mark"]} title="Asked to change their Profile" aria-label="Asked to change their Profile">
                        !
                      </span>
                    )}
                  </span>
                  <span className={styles["admin-person-detail"]}>
                    {words || selectedRole.id === "staff" ? `${person.roleName} · ` : ""}
                    {person.detail}
                    {person.roleId === "manager" ? (person.member?.permissions ? " · Own responsibilities" : " · Default") : ""}
                  </span>
                </span>
                {isOwner && person.roleId === "manager" && (
                  <button
                    type="button"
                    className={styles["admin-roles-text-button"]}
                    onClick={() => {
                      setSelectedRoleId("manager");
                      setChosenManagerMobile(person.key);
                    }}
                  >
                    Set
                  </button>
                )}
                {isOwner && person.isOwnerRow && (
                  <button type="button" className={styles["admin-roles-text-button"]} onClick={() => setIsOwnerPanelOpen(true)}>
                    Edit
                  </button>
                )}
              </li>
            ))}
            {shownPeople.length === 0 && <li className={styles["admin-person-empty"]}>{words ? "No one matches this search." : "No one has this role yet."}</li>}
          </ul>

          {isOwner && selectedRole.id !== "owner" && !words && (
            <>
              <button
                type="button"
                className={styles["admin-person-invite"]}
                onClick={() => setPersonForm({ name: "", mobileNumber: "", roleId: selectedRole.id, title: "", isInvite: true })}
              >
                + Invite person
              </button>
              <p className={styles["admin-roles-hint"]}>People are added in the Staff section; Invite gives one of them this role.</p>
            </>
          )}

          <h3 className={styles["admin-roles-section-title"]}>What each role can do</h3>
          <ul className={styles["admin-role-summaries"]}>
            {allRoles.map((role) => (
              <li key={role.id}>
                <span className={styles["admin-role-summary-name"]}>{role.name}</span>
                <span className={styles["admin-role-summary-text"]}>{summaryOf(role)}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ---------- Right: Staff → the whole team; any other role → its permissions ---------- */}
        {selectedRole.id === "staff" && !words ? (
          <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-team-heading">
            <h2 id="admin-team-heading" className={dashboardStyles["admin-card-title"]}>
              Staff
            </h2>
            <p className={dashboardStyles["admin-card-subtitle"]}>Everyone on the team: leave, delete requests and roles</p>
            <div className={dashboardStyles["admin-table-scroll"]}>
              <table className={`${dashboardStyles["admin-orders-table"]} ${styles["admin-team-table"]}`}>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Number</th>
                    <th scope="col">Leave</th>
                    <th scope="col">Delete request</th>
                    <th scope="col">Profile change</th>
                    <th scope="col" className={styles["admin-team-actions-column"]}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {team.map((member) => {
                    const roleName = allRoles.find((role) => role.id === member.roleId)?.name ?? "No role";
                    const pendingLeave = pendingLeaveOf(member.mobileNumber).length;
                    const allLeave = leaveRequests.filter((request) => request.staffMobile === member.mobileNumber).length;
                    return (
                      <tr key={member.mobileNumber}>
                        <td className={dashboardStyles["admin-orders-customer"]}>
                          <span className={styles["admin-team-name"]}>{member.name}</span>
                          <span className={styles["admin-team-role"]}>{roleName}</span>
                        </td>
                        <td>{formatIndianMobileNumber(member.mobileNumber)}</td>
                        <td>
                          {allLeave === 0 ? (
                            <span className={styles["admin-team-none"]}>None</span>
                          ) : (
                            <button
                              type="button"
                              className={`${styles["admin-team-leave-button"]} ${pendingLeave > 0 ? styles["admin-team-leave-button-waiting"] : ""}`}
                              onClick={() => setLeaveOf(member)}
                            >
                              {pendingLeave > 0 ? `${pendingLeave} waiting` : `View (${allLeave})`}
                            </button>
                          )}
                        </td>
                        <td>
                          {member.deleteRequestedAt ? (
                            <DeleteRequestMenu
                              member={member}
                              canAct={canRemove(member)}
                              onAccept={() => setMemberToRemove(member)}
                              onReject={() => void rejectDeleteRequest(member)}
                            />
                          ) : (
                            <span className={styles["admin-team-none"]}>None</span>
                          )}
                        </td>
                        <td>
                          {waitingChangesOf(member) > 0 ? (
                            <button
                              type="button"
                              className={`${styles["admin-team-leave-button"]} ${styles["admin-team-leave-button-waiting"]}`}
                              onClick={() => setProfileChangesOf(member.mobileNumber)}
                            >
                              {waitingChangesOf(member)} waiting
                            </button>
                          ) : (
                            <span className={styles["admin-team-none"]}>None</span>
                          )}
                        </td>
                        <td className={styles["admin-team-actions-column"]}>
                          {isOwner && (
                            <span className={styles["admin-team-actions"]}>
                              {/* ⋮ : the "Edit" pop-up (name, number, title, and Role: promote / demote there) */}
                              <button
                                type="button"
                                className={styles["admin-team-more-button"]}
                                aria-label={`Edit ${member.name}`}
                                title={`Edit ${member.name}`}
                                onClick={() =>
                                  setPersonForm({ name: member.name, mobileNumber: member.mobileNumber, roleId: member.roleId ?? (roles[0]?.id ?? ""), title: member.title ?? "" })
                                }
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <circle cx="12" cy="5" r="1.6" />
                                  <circle cx="12" cy="12" r="1.6" />
                                  <circle cx="12" cy="19" r="1.6" />
                                </svg>
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {team.length === 0 && (
                    <tr>
                      <td colSpan={6} className={styles["admin-team-none"]}>
                        No one on the team yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
        <section className={dashboardStyles["admin-card"]} aria-labelledby="admin-permissions-heading">
          <div className={dashboardStyles["admin-card-heading-row"]}>
            <div>
              <h2 id="admin-permissions-heading" className={dashboardStyles["admin-card-title"]}>
                {chosenManager ? `${chosenManager.name}'s responsibilities` : `${selectedRole.name} permissions`}
                {hasUnsavedChanges && <span className={styles["admin-permissions-unsaved"]}>Not saved</span>}
              </h2>
              <p className={dashboardStyles["admin-card-subtitle"]}>
                {chosenManager
                  ? chosenManager.permissions
                    ? `What ${chosenManager.name} can see and change`
                    : `${chosenManager.name} follows the Manager defaults. Change the ticks and save to give them their own`
                  : selectedRole.id === "manager"
                    ? "The defaults, for managers without their own responsibilities"
                  : selectedRole.id === "owner"
                  ? "The owner can always see and change everything"
                  : !selectedRole.hasPanelAccess
                    ? "Delivery agents can't open the panel"
                    : isOwner
                      ? `Choose what ${pluralOf(selectedRole.name)} can see and change`
                      : `What ${pluralOf(selectedRole.name)} can see and change`}
              </p>
            </div>
            {!isLocked && (
              <div className={styles["admin-permissions-buttons"]}>
                {!selectedRole.isBuiltIn && (
                  <>
                    <button
                      type="button"
                      className={styles["admin-roles-text-button"]}
                      onClick={() => {
                        setRoleName(selectedRole.name);
                        setIsRenameOpen(true);
                      }}
                    >
                      Rename
                    </button>
                  </>
                )}
                {chosenManager?.permissions && (
                  <button type="button" className={styles["admin-roles-text-button"]} onClick={() => void followManagerDefaults()}>
                    Use default
                  </button>
                )}
                <button type="button" className={styles["admin-permissions-reset"]} disabled={!hasUnsavedChanges} onClick={resetDraft}>
                  Reset
                </button>
                <button type="button" className={styles["admin-permissions-save"]} disabled={!hasUnsavedChanges} onClick={() => void savePermissions()}>
                  Save
                </button>
              </div>
            )}
          </div>

          {selectedRole.id === "manager" && managers.length > 0 && (
            <label className={styles["admin-permissions-person"]}>
              <span>Responsibilities for</span>
              <select className={adminInputClassName} value={chosenManager?.mobileNumber ?? ""} onChange={(changeEvent) => setChosenManagerMobile(changeEvent.target.value)}>
                <option value="">Manager defaults</option>
                {managers.map((manager) => (
                  <option key={manager.mobileNumber} value={manager.mobileNumber}>
                    {manager.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className={dashboardStyles["admin-table-scroll"]}>
            <table className={`${dashboardStyles["admin-orders-table"]} ${styles["admin-permissions-table"]}`}>
              <thead>
                <tr>
                  <th scope="col">Module</th>
                  {PERMISSION_ACTIONS.map((action) => (
                    <th key={action.key} scope="col" className={styles["admin-permissions-column"]}>
                      {isLocked ? (
                        action.label
                      ) : (
                        <button
                          type="button"
                          className={styles["admin-permissions-column-button"]}
                          title={`Tick or untick ${action.label} for every page`}
                          onClick={() => toggleColumn(action.key)}
                        >
                          {action.label}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PANEL_MODULES.map((module) => (
                  <tr key={module.key}>
                    <td className={dashboardStyles["admin-orders-customer"]}>{module.label}</td>
                    {PERMISSION_ACTIONS.map((action) => {
                      const isOn = shownPermissions[module.key][action.key];
                      return (
                        <td key={action.key} className={styles["admin-permissions-column"]}>
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={isOn}
                            aria-label={`${gridName}: ${action.label} ${module.label}`}
                            disabled={isLocked}
                            className={`${styles["admin-permission-box"]} ${isOn ? styles["admin-permission-box-on"] : ""}`}
                            onClick={() => toggle(module.key, action.key)}
                          >
                            {isOn && (
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M6 12.5l4 4 8-9" />
                              </svg>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles["admin-sensitive-note"]}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 11h12v9.5H6z" />
              <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
            </svg>
            <div>
              <p className={styles["admin-sensitive-title"]}>Sensitive actions always need the owner</p>
              <p className={styles["admin-sensitive-text"]}>
                Changing prices, deleting customers, refunds above ₹500 and editing salaries can only be done by the owner, whatever
                is ticked here. Later this will send a one-time code to the owner&rsquo;s phone.
              </p>
            </div>
          </div>
        </section>
        )}
      </div>

      {isAddRoleOpen && (
        <AdminDialog title="Add new role" submitLabel="Add role" onClose={() => setIsAddRoleOpen(false)} onSubmit={saveNewRole}>
          <AdminDialogField label="Role name" isWide>
            <input
              className={adminInputClassName}
              placeholder="e.g. Accountant"
              value={roleName}
              onChange={(changeEvent) => setRoleName(changeEvent.target.value.slice(0, 30))}
              autoFocus
            />
          </AdminDialogField>
          <p className={styles["admin-roles-dialog-note"]}>It starts with only the dashboard. Tick what this role can do, then Save.</p>
        </AdminDialog>
      )}

      {isRenameOpen && (
        <AdminDialog title={`Rename ${selectedRole.name}`} submitLabel="Save" onClose={() => setIsRenameOpen(false)} onSubmit={saveRename}>
          <AdminDialogField label="Role name" isWide>
            <input className={adminInputClassName} value={roleName} onChange={(changeEvent) => setRoleName(changeEvent.target.value.slice(0, 30))} autoFocus />
          </AdminDialogField>
        </AdminDialog>
      )}

      {personForm && (
        <AdminDialog
          title={personForm.isInvite ? "Invite person" : `Edit ${personForm.name}`}
          submitLabel={personForm.isInvite ? "Give access" : "Save"}
          onClose={() => setPersonForm(null)}
          onSubmit={savePerson}
        >
          <AdminDialogField label="Name">
            {personForm.isInvite ? (
              // Everyone on the staff list, with their role now; picking one fills in their number
              <select
                className={adminInputClassName}
                value={personForm.mobileNumber}
                autoFocus
                onChange={(changeEvent) => {
                  const picked = team.find((member) => member.mobileNumber === changeEvent.target.value);
                  setPersonForm({ ...personForm, name: picked?.name ?? "", mobileNumber: picked?.mobileNumber ?? "", title: picked?.title ?? "" });
                }}
              >
                <option value="">{team.length > 0 ? "Choose a staff member" : "No one in the Staff section yet"}</option>
                {team.map((member) => (
                  <option key={member.mobileNumber} value={member.mobileNumber}>
                    {member.name} · {roleNameOf(member)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={adminInputClassName}
                value={personForm.name}
                onChange={(changeEvent) => setPersonForm({ ...personForm, name: changeEvent.target.value })}
                autoFocus
              />
            )}
          </AdminDialogField>
          <AdminDialogField label="Mobile number">
            <input
              className={adminInputClassName}
              placeholder={personForm.isInvite ? "Filled in when you choose a name" : ""}
              disabled
              value={personForm.mobileNumber ? formatIndianMobileNumber(personForm.mobileNumber) : ""}
            />
          </AdminDialogField>
          <AdminDialogField label="Role">
            <select className={adminInputClassName} value={personForm.roleId} onChange={(changeEvent) => setPersonForm({ ...personForm, roleId: changeEvent.target.value })}>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </AdminDialogField>
          <AdminDialogField label="Title (optional)">
            <input
              className={adminInputClassName}
              placeholder="e.g. Hub manager"
              value={personForm.title}
              onChange={(changeEvent) => setPersonForm({ ...personForm, title: changeEvent.target.value })}
            />
          </AdminDialogField>
          <p className={styles["admin-roles-dialog-note"]}>
            {personForm.isInvite && team.length === 0
              ? "No one in the Staff section yet. Add the person there first."
              : `They log in on the website with this number as usual and find “${personForm.roleId === "delivery-agent" ? "Delivery Panel" : "Chiranvi Panel"}” in their account.`}
          </p>
          {/* Someone already on the team: remove them (asks "Remove … from the team?" first) */}
          {(() => {
            const member = team.find((existing) => existing.mobileNumber === personForm.mobileNumber);
            return member && canRemove(member) && !personForm.isInvite ? (
              <button
                type="button"
                className={styles["admin-roles-remove-from-team"]}
                onClick={() => {
                  setPersonForm(null);
                  setMemberToRemove(member);
                }}
              >
                Remove from team
              </button>
            ) : null;
          })()}
        </AdminDialog>
      )}

      {isOwnerPanelOpen && <OwnerProfileDialog onClose={() => setIsOwnerPanelOpen(false)} showToast={showToast} />}

      {isDeleteRoleOpen && (
        <AdminDialog
          title="Delete role"
          submitLabel={isDeletingRole ? "Deleting…" : "Delete role"}
          isDanger
          onClose={() => setIsDeleteRoleOpen(false)}
          onSubmit={() => void deleteChosenRole()}
        >
          <AdminDialogField label="Role" isWide>
            <select
              className={adminInputClassName}
              value={roleToDeleteId}
              onChange={(changeEvent) => {
                setRoleToDeleteId(changeEvent.target.value);
                setDeleteRoleProblem("");
              }}
            >
              <option value="">Choose a role</option>
              {deletableRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name} ({peopleIn(role)} {peopleIn(role) === 1 ? "person" : "people"})
                </option>
              ))}
            </select>
          </AdminDialogField>
          <AdminDialogField label={owner.passwordKind === "password" ? "Your password" : "Your PIN"} isWide>
            <input
              type="password"
              className={adminInputClassName}
              inputMode={owner.passwordKind === "password" ? undefined : "numeric"}
              autoComplete="current-password"
              value={deleteRoleSecret}
              onChange={(changeEvent) => {
                setDeleteRoleSecret(changeEvent.target.value);
                setDeleteRoleProblem("");
              }}
            />
          </AdminDialogField>
          {deleteRoleProblem && (
            <p className={styles["admin-roles-dialog-problem"]} role="alert">
              {deleteRoleProblem}
            </p>
          )}
          <p className={styles["admin-roles-dialog-note"]}>
            The same PIN / password as Transfer ownership. A role with people in it can&rsquo;t be deleted: move them first. Owner and
            Delivery agent can&rsquo;t be deleted.
          </p>
        </AdminDialog>
      )}

      {memberWithChanges && (
        <ProfileChangesDialog
          member={memberWithChanges}
          canDecide={canDecideLeave && memberWithChanges.mobileNumber !== myMobileNumber}
          onClose={() => setProfileChangesOf(null)}
          onDone={showToast}
        />
      )}

      {leaveOf && (
        <AdminDialog title={`${leaveOf.name}'s leave`} submitLabel="Close" onClose={() => setLeaveOf(null)} onSubmit={() => setLeaveOf(null)}>
          <ul className={styles["admin-team-leave-list"]}>
            {leaveRequests
              .filter((request) => request.staffMobile === leaveOf.mobileNumber)
              .sort((first, second) => Number(second.status === "Pending") - Number(first.status === "Pending"))
              .map((request) => (
                <li key={request.id} className={styles["admin-team-leave-row"]}>
                  <span className={styles["admin-team-leave-words"]}>
                    <strong>
                      {request.type} · {getLeaveDays(request)} {getLeaveDays(request) === 1 ? "day" : "days"}
                    </strong>
                    <span>
                      {request.from === request.to ? request.from.split("-").reverse().join("/") : `${request.from.split("-").reverse().join("/")} – ${request.to.split("-").reverse().join("/")}`}
                      {request.reason ? ` · ${request.reason}` : ""}
                    </span>
                  </span>
                  {request.status === "Pending" && canDecideLeave ? (
                    <span className={styles["admin-team-leave-actions"]}>
                      <button type="button" className={styles["admin-team-leave-reject"]} onClick={() => decideLeaveRequest(request, "Rejected")}>
                        Reject
                      </button>
                      <button type="button" className={styles["admin-team-leave-approve"]} onClick={() => decideLeaveRequest(request, "Approved")}>
                        Approve
                      </button>
                    </span>
                  ) : (
                    <span className={`${styles["admin-team-leave-status"]} ${styles[`admin-team-leave-status-${request.status.toLowerCase()}`]}`}>
                      {request.status === "Pending" ? "Waiting" : request.status}
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </AdminDialog>
      )}

      {memberToRemove && (
        <AdminDialog
          title={`Remove ${memberToRemove.name} from the team?`}
          submitLabel="Remove from team"
          isDanger
          onClose={() => setMemberToRemove(null)}
          onSubmit={() => {
            removeStaffMember(memberToRemove.mobileNumber);
            showToast(`${memberToRemove.name} is removed from the team`);
            setMemberToRemove(null);
          }}
        >
          <p className={styles["admin-roles-dialog-note"]}>
            {formatIndianMobileNumber(memberToRemove.mobileNumber)} loses their access and is deleted from the Staff section too.
          </p>
        </AdminDialog>
      )}

      {toast}
    </div>
  );
}

/*
  The owner's profile (the round icon at the top right). The owner's admin profile and their user Profile
  are one person: the name and email come from their Profile page, and saving the name updates both.
  Steps inside the one pop-up:
    set-secret      first time only: choose a 6-digit PIN or a password (8+ characters), typed twice;
                    the profile opens only after this
    profile         name (edit freely), mobile number with "Change number", email; "Forgot PIN / password?"
    number-question "Are you transferring ownership?" Yes / No, just my number
    transfer        new owner's name and number + the owner's PIN / password: they become the Owner, this
                    owner stays as a Manager
    own-number      the owner's new number + PIN / password: still the owner, logs in with the new number
    forgot          an OTP to the login number, then a new PIN / password
  While someone is the owner, their name and number can be changed but not removed (the business always
  has one owner); the database enforces the PIN / password checks (supabase/migrations/0007_…sql).
*/
type OwnerStep = "set-secret" | "profile" | "number-question" | "transfer" | "own-number" | "forgot";

function OwnerProfileDialog({ onClose, showToast }: { onClose: () => void; showToast: (message: string) => void }) {
  const owner = useOwnerDetails();
  const profile = useCustomerProfile(owner.mobileNumber || null);
  const profileName = profile ? `${profile.firstName} ${profile.lastName}`.trim() : "";
  const [step, setStep] = useState<OwnerStep>(owner.passwordKind ? "profile" : "set-secret");
  const [name, setName] = useState(profileName || owner.name);
  // New PIN / password (set-secret, forgot)
  const [secretKind, setSecretKind] = useState<"pin" | "password">(owner.passwordKind ?? "pin");
  const [secret, setSecret] = useState("");
  const [secretAgain, setSecretAgain] = useState("");
  // Change number (transfer, own-number)
  const [newMobile, setNewMobile] = useState("");
  const [newOwnerName, setNewOwnerName] = useState("");
  const [confirmSecret, setConfirmSecret] = useState("");
  // Forgot: the OTP step
  const [isCodeSent, setIsCodeSent] = useState(false);
  const [isCodeChecked, setIsCodeChecked] = useState(false);
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const kindWord = (kind: "pin" | "password" | null | undefined) => (kind === "password" ? "password" : "PIN");

  function goTo(nextStep: OwnerStep) {
    setProblem("");
    setStep(nextStep);
  }

  // Runs a step's action; shows its problem, or calls done
  async function run(action: () => Promise<string | null>, done: () => void) {
    setProblem("");
    setIsWorking(true);
    const result = await action();
    setIsWorking(false);
    if (result) setProblem(result);
    else done();
  }

  function saveNewSecret(after: () => void) {
    if (secret !== secretAgain) {
      setProblem(`The two ${secretKind === "pin" ? "PINs" : "passwords"} don't match`);
      return;
    }
    void run(
      () => saveOwnPassword(secret, secretKind),
      () => {
        setSecret("");
        setSecretAgain("");
        showToast(`${secretKind === "pin" ? "PIN" : "Password"} saved`);
        after();
      },
    );
  }

  function saveName() {
    if (!name.trim()) {
      setProblem("Your name can't be empty while you are the owner");
      return;
    }
    saveOwnerName(name.trim());
    if (profile) {
      const [firstName, ...rest] = name.trim().split(/\s+/);
      saveCustomerProfile({ ...profile, firstName, lastName: rest.join(" ") || profile.lastName });
    }
    onClose();
    showToast("Your name is saved");
  }

  function checkNewMobile() {
    const digits = newMobile.replace(/\D/g, "");
    if (digits.length !== 10) return "Enter a 10-digit mobile number";
    if (digits === owner.mobileNumber) return "That's your current number";
    if (!confirmSecret) return `Enter your ${kindWord(owner.passwordKind)} to confirm`;
    return null;
  }

  function submit() {
    if (step === "set-secret") saveNewSecret(() => goTo("profile"));
    else if (step === "profile") saveName();
    else if (step === "number-question") goTo("profile");
    else if (step === "transfer") {
      const found = checkNewMobile() ?? (newOwnerName.trim() ? null : "Enter the new owner's name");
      if (found) return setProblem(found);
      void run(
        () => transferOwnership(newMobile, newOwnerName.trim(), confirmSecret),
        () => {
          onClose();
          showToast(`${newOwnerName.trim()} is now the owner. You stay on the team as a Manager.`);
        },
      );
    } else if (step === "own-number") {
      const found = checkNewMobile();
      if (found) return setProblem(found);
      void run(
        () => changeOwnerNumber(newMobile, confirmSecret),
        () => {
          onClose();
          showToast(`Saved. Log in with ${formatIndianMobileNumber(newMobile)} and its OTP from now on`);
        },
      );
    } else if (step === "forgot") {
      if (!isCodeSent) void run(sendOwnerResetCode, () => setIsCodeSent(true));
      else if (!isCodeChecked) void run(() => checkOwnerResetCode(code), () => setIsCodeChecked(true));
      else saveNewSecret(() => goTo("profile"));
    }
  }

  const titles: Record<OwnerStep, string> = {
    "set-secret": "Set your PIN or password first",
    profile: "Your owner profile",
    "number-question": "Are you transferring ownership?",
    transfer: "Transfer ownership",
    "own-number": "Update your number",
    forgot: `Forgot ${kindWord(owner.passwordKind)}?`,
  };
  const submitLabels: Record<OwnerStep, string> = {
    "set-secret": "Save and open profile",
    profile: "Save name",
    "number-question": "Back",
    transfer: "Transfer ownership",
    "own-number": "Update my number",
    forgot: !isCodeSent ? "Send OTP" : !isCodeChecked ? "Check OTP" : `Save new ${secretKind === "pin" ? "PIN" : "password"}`,
  };

  // Choose PIN or password, then type it twice (first time, and after Forgot)
  const newSecretFields = (
    <>
      <div className={styles["admin-owner-kind-choice"]} role="radiogroup" aria-label="PIN or password">
        {(["pin", "password"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={secretKind === kind}
            className={`${styles["admin-owner-kind-option"]} ${secretKind === kind ? styles["admin-owner-kind-option-chosen"] : ""}`}
            onClick={() => {
              setSecretKind(kind);
              setSecret("");
              setSecretAgain("");
            }}
          >
            <strong>{kind === "pin" ? "PIN" : "Password"}</strong>
            <span>{kind === "pin" ? "6 digits" : "At least 8 characters"}</span>
          </button>
        ))}
      </div>
      <AdminDialogField label={secretKind === "pin" ? "New PIN" : "New password"}>
        <input
          className={adminInputClassName}
          type="password"
          autoComplete="new-password"
          inputMode={secretKind === "pin" ? "numeric" : undefined}
          maxLength={secretKind === "pin" ? 6 : undefined}
          value={secret}
          onChange={(changeEvent) => setSecret(secretKind === "pin" ? changeEvent.target.value.replace(/\D/g, "") : changeEvent.target.value)}
          autoFocus
        />
      </AdminDialogField>
      <AdminDialogField label="Type it again">
        <input
          className={adminInputClassName}
          type="password"
          autoComplete="new-password"
          inputMode={secretKind === "pin" ? "numeric" : undefined}
          maxLength={secretKind === "pin" ? 6 : undefined}
          value={secretAgain}
          onChange={(changeEvent) => setSecretAgain(secretKind === "pin" ? changeEvent.target.value.replace(/\D/g, "") : changeEvent.target.value)}
        />
      </AdminDialogField>
    </>
  );

  // The owner's PIN / password, to confirm a number change
  const confirmField = (
    <AdminDialogField label={`Your ${kindWord(owner.passwordKind)}, to confirm`} isWide>
      <input
        className={adminInputClassName}
        type="password"
        autoComplete="current-password"
        inputMode={owner.passwordKind === "pin" ? "numeric" : undefined}
        value={confirmSecret}
        onChange={(changeEvent) => setConfirmSecret(changeEvent.target.value)}
      />
    </AdminDialogField>
  );

  return (
    <AdminDialog title={titles[step]} submitLabel={isWorking ? "Please wait…" : submitLabels[step]} onClose={onClose} onSubmit={() => !isWorking && submit()}>
      {step === "set-secret" && (
        <>
          <p className={styles["admin-roles-dialog-note"]}>
            Before your profile opens, choose a PIN or a password. You&apos;ll use it to confirm big changes, like changing the
            owner&apos;s number.
          </p>
          {newSecretFields}
        </>
      )}

      {step === "profile" && (
        <>
          <AdminDialogField label="Name" isWide>
            <input className={adminInputClassName} value={name} onChange={(changeEvent) => setName(changeEvent.target.value)} autoFocus />
          </AdminDialogField>
          <AdminDialogField label="Mobile number" isWide>
            <span className={styles["admin-owner-number-row"]}>
              <input className={adminInputClassName} value={formatIndianMobileNumber(owner.mobileNumber)} readOnly />
              <button type="button" className={styles["admin-owner-secondary-button"]} onClick={() => goTo("number-question")}>
                Change number
              </button>
            </span>
          </AdminDialogField>
          <AdminDialogField label="Email (from your Profile)" isWide>
            <input className={adminInputClassName} value={profile?.email || "Not added yet: add it on your Profile page"} readOnly />
          </AdminDialogField>
          <p className={styles["admin-roles-dialog-note"]}>
            Your name is the same on your Profile. While you are the owner, your name and number can be changed but not removed.{" "}
            <button type="button" className={styles["admin-roles-text-button"]} onClick={() => goTo("forgot")}>
              Forgot {kindWord(owner.passwordKind)}?
            </button>
          </p>
        </>
      )}

      {step === "number-question" && (
        <div className={styles["admin-owner-question"]}>
          <button type="button" className={styles["admin-owner-question-option"]} onClick={() => goTo("transfer")}>
            <strong>Yes, transfer ownership</strong>
            <span>Someone else becomes the owner. You stay on the team as a Manager.</span>
          </button>
          <button type="button" className={styles["admin-owner-question-option"]} onClick={() => goTo("own-number")}>
            <strong>No, just update my number</strong>
            <span>You stay the owner and log in with your new number.</span>
          </button>
        </div>
      )}

      {step === "transfer" && (
        <>
          <AdminDialogField label="New owner's name">
            <input className={adminInputClassName} value={newOwnerName} onChange={(changeEvent) => setNewOwnerName(changeEvent.target.value)} autoFocus />
          </AdminDialogField>
          <AdminDialogField label="New owner's mobile number">
            <input
              className={adminInputClassName}
              inputMode="numeric"
              placeholder="10 digits"
              value={newMobile}
              onChange={(changeEvent) => setNewMobile(changeEvent.target.value.replace(/\D/g, "").slice(0, 10))}
            />
          </AdminDialogField>
          {confirmField}
          <p className={styles["admin-roles-dialog-note"]}>They become the Owner straight away and set their own PIN or password. You stay on the team as a Manager.</p>
        </>
      )}

      {step === "own-number" && (
        <>
          <AdminDialogField label="Your new mobile number" isWide>
            <input
              className={adminInputClassName}
              inputMode="numeric"
              placeholder="10 digits"
              value={newMobile}
              onChange={(changeEvent) => setNewMobile(changeEvent.target.value.replace(/\D/g, "").slice(0, 10))}
              autoFocus
            />
          </AdminDialogField>
          {confirmField}
          <p className={styles["admin-roles-dialog-note"]}>You stay the owner. From now on you log in with the new number and its OTP, and set your PIN or password again there.</p>
        </>
      )}

      {step === "forgot" && (
        <>
          {!isCodeSent && (
            <p className={styles["admin-roles-dialog-note"]}>We&apos;ll send an OTP to your login number, {formatIndianMobileNumber(owner.mobileNumber)}.</p>
          )}
          {isCodeSent && !isCodeChecked && (
            <AdminDialogField label={`OTP sent to ${formatIndianMobileNumber(owner.mobileNumber)}`} isWide>
              <input
                className={adminInputClassName}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(changeEvent) => setCode(changeEvent.target.value.replace(/\D/g, ""))}
                autoFocus
              />
            </AdminDialogField>
          )}
          {isCodeChecked && newSecretFields}
        </>
      )}

      {problem && (
        <p className={`${styles["admin-roles-dialog-note"]} ${styles["admin-owner-problem"]}`} role="alert">
          {problem}
        </p>
      )}
    </AdminDialog>
  );
}

/*
  Staff → Delete request: the "Requested account deletion" tag opens a small menu. Accept removes the
  person from the team (after "Remove … from the team?"); Reject clears the request (they can ask again).
  Only the owner, or a manager for anyone who isn't a manager, can act; others see the tag only.
  The menu is placed on the screen under the tag (the table scrolls sideways, which would cut it off);
  Escape, a click outside, scrolling or resizing closes it.
*/
function DeleteRequestMenu({
  member,
  canAct,
  onAccept,
  onReject,
}: {
  member: StaffMember;
  canAct: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  // Where the open menu sits on the screen (null: closed)
  const [menuPlace, setMenuPlace] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOpen = menuPlace !== null;
  useEffect(() => {
    if (!isOpen) return;
    const close = () => setMenuPlace(null);
    function closeOnOutside(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) close();
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [isOpen]);

  function toggleMenu(button: HTMLButtonElement) {
    if (isOpen) {
      setMenuPlace(null);
      return;
    }
    const place = button.getBoundingClientRect();
    // Under the tag, kept inside the screen (the menu is about 220 px wide)
    setMenuPlace({ top: place.bottom + 6, left: Math.max(8, Math.min(place.left, window.innerWidth - 228)) });
  }

  if (!canAct) return <span className={styles["admin-person-delete-request"]}>Requested account deletion</span>;
  return (
    <div ref={menuRef} className={dashboardStyles["admin-popup-anchor"]}>
      <button
        type="button"
        className={`${styles["admin-person-delete-request"]} ${styles["admin-team-delete-request-button"]}`}
        aria-label={`${member.name} requested account deletion: accept or reject`}
        aria-expanded={isOpen}
        onClick={(clickEvent) => toggleMenu(clickEvent.currentTarget)}
      >
        Requested account deletion
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {menuPlace && (
        <div
          className={`${dashboardStyles["admin-popup"]} ${dashboardStyles["admin-order-menu"]} ${styles["admin-team-request-menu"]}`}
          style={{ top: menuPlace.top, left: menuPlace.left }}
        >
          <p className={dashboardStyles["admin-popup-title"]}>{member.name}</p>
          <button
            type="button"
            className={styles["admin-team-request-accept"]}
            onClick={() => {
              setMenuPlace(null);
              onAccept();
            }}
          >
            Accept (remove from team)
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuPlace(null);
              onReject();
            }}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

// What the panel calls each detail of a Profile request
export const PROFILE_FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  primaryMobile: "Mobile number",
  secondaryMobile: "Secondary mobile number",
  email: "Email",
  primaryAddress: "Primary address",
  secondaryAddress: "Secondary address",
  location: "Location",
  pincode: "Pincode",
  dateOfBirth: "Date of birth",
  familySize: "Family size",
  preferredPlanType: "Preferred plan type",
};

/*
  A team member's request to change their Profile (here and in the Staff section, which managers can open):
  each detail, old and new, and why. Accept or Reject (with a reason they see). After Accept they press Save on
  their Profile. Nobody answers their own request (the database checks it too).
*/
export function ProfileChangesDialog({
  member,
  canDecide,
  onClose,
  onDone,
}: {
  member: StaffMember;
  canDecide: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [rejectReason, setRejectReason] = useState("");
  const [problem, setProblem] = useState("");
  const request = member.profileChange;

  async function answer(accept: boolean) {
    if (!accept && !rejectReason.trim()) {
      setProblem("Write why you are rejecting it");
      return;
    }
    const decideProblem = await decideProfileChange(member.mobileNumber, accept, rejectReason.trim());
    if (decideProblem) {
      setProblem(decideProblem);
      return;
    }
    onDone(`${member.name}'s profile change ${accept ? "accepted" : "rejected"}`);
    onClose();
  }

  return (
    <AdminDialog title={`${member.name}'s profile change`} submitLabel="Close" onClose={onClose} onSubmit={onClose} hasOnlyCloseButton>
      <ul className={styles["admin-team-leave-list"]}>
        {Object.entries(request?.changes ?? {}).map(([field, change]) => (
          <li key={field} className={styles["admin-team-change-request"]}>
            <p className={styles["admin-team-change-title"]}>{PROFILE_FIELD_LABELS[field] ?? field}</p>
            <p className={styles["admin-team-change-value"]}>
              {change.from || "(empty)"} → {change.to || "(empty)"}
            </p>
          </li>
        ))}
      </ul>
      <p className={styles["admin-team-change-reason"]}>Reason: {request?.reason}</p>
      {canDecide ? (
        <>
          <AdminDialogField label="Why, if you reject it" isWide>
            <input className={adminInputClassName} value={rejectReason} onChange={(changeEvent) => setRejectReason(changeEvent.target.value)} />
          </AdminDialogField>
          <div className={styles["admin-team-change-buttons"]}>
            <button type="button" className={styles["admin-team-change-accept"]} onClick={() => void answer(true)}>
              Accept
            </button>
            <button type="button" className={styles["admin-team-change-reject"]} onClick={() => void answer(false)}>
              Reject
            </button>
          </div>
        </>
      ) : (
        <p className={styles["admin-team-change-reason"]}>Someone else with Staff → Edit answers this.</p>
      )}
      {problem && (
        <p className={styles["admin-roles-dialog-problem"]} role="alert">
          {problem}
        </p>
      )}
    </AdminDialog>
  );
}
