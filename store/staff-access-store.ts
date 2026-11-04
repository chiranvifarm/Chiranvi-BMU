import { useEffect, useSyncExternalStore } from "react";
import { useLoggedInMobileNumber } from "@/components/login/login-status";
import { createClient } from "@/lib/supabase/client";
import { PANEL_FEATURES, type PanelFeature } from "./panel-features";

/*
  Who can open the Chiranvi Panel (/admin) and what they can do there. Managed on the Roles & permissions
  page, saved in the Supabase database (tables panel_roles and staff_members, see
  supabase/migrations/0002_people_and_login.sql), so the same team and roles apply on every laptop and
  phone, on localhost and on the live site.
  - Roles: Owner (the only admin: can do everything and is the only one who can change roles and people),
    Manager, Delivery agent (delivery app only, no panel), and any role the owner adds. (There is no
    Admin role: removed in supabase/migrations/0004_roles_owner_manager_agent.sql.) Each role has, for every
    panel page (module): View, Create, Edit, Delete, Export. View decides whether the page opens at all.
  - People: a mobile number with a role. They log in with their OTP and find "Chiranvi Panel" in their
    account.
  The team is read after login (and again when the window comes back into focus). The database's rules
  decide what each person may read and change: anyone sees their own staff row; the owner sees and changes
  everyone and every role. So a customer, or an Admin trying to change the team, is refused by the
  database itself, whatever the browser does.
*/

// Before the team has loaded (and on the server): nobody is the owner
const NO_OWNER: OwnerDetails = { name: "", mobileNumber: "" };

// passwordKind: the PIN or password the owner chose (empty: not set yet, the panel asks for it first)
export type OwnerDetails = { name: string; mobileNumber: string; passwordKind?: "pin" | "password" | null };

// Panel pages that sit in the sales / operations / business groups: store/panel-features.ts
export { PANEL_FEATURES, type PanelFeature };

// Every page of the panel a role can be given (rows of the permission grid)
export type PanelModule = "dashboard" | PanelFeature | "staff" | "roles";
export const PANEL_MODULES: { key: PanelModule; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  ...PANEL_FEATURES.map((feature) => ({ key: feature.key as PanelModule, label: feature.label as string })),
  { key: "staff", label: "Staff" },
  { key: "roles", label: "Roles & permissions" },
];

export type PermissionAction = "view" | "create" | "edit" | "delete" | "export";
export const PERMISSION_ACTIONS: { key: PermissionAction; label: string }[] = [
  { key: "view", label: "View" },
  { key: "create", label: "Create" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Delete" },
  { key: "export", label: "Export" },
];

export type ActionSet = Record<PermissionAction, boolean>;
export type RolePermissions = Record<PanelModule, ActionSet>;

export type PanelRole = {
  id: string; // "owner", "manager", "delivery-agent", or made by the owner
  name: string;
  isBuiltIn: boolean;
  // false: no panel at all (delivery agents use the delivery app)
  hasPanelAccess: boolean;
  permissions: RolePermissions;
};

export type StaffMember = {
  mobileNumber: string; // 10 digits
  name: string;
  roleId: string | null; // null: on the Staff section without a login role (a farm worker …)
  title?: string; // "Hub manager"
  deleteRequestedAt?: string; // they asked the admin to delete their account (Profile → Delete account → Request)
  profileChange?: ProfileChangeRequest; // asking to change their Profile (supabase/migrations/0031_one_profile_request.sql)
};

// What changed, by the Profile's field names (primaryMobile: the new login number)
export type ProfileChangeRequest = {
  status: "Pending" | "Accepted" | "Rejected";
  changes: Record<string, { from: string; to: string }>;
  reason: string;
  requestedAt: string;
  decidedBy?: string;
  rejectReason?: string;
};

export type StaffAccess = {
  roleId: string;
  roleName: string;
  name: string;
  isOwner: boolean;
  // Whether an action is allowed on a page (the owner: always)
  can: (module: PanelModule, action: PermissionAction) => boolean;
  // What the person can open in the panel (View)
  canOpenFeature: (feature: PanelFeature) => boolean;
  // Roles and people can only be changed by the owner
  canManageTeam: boolean;
};

// ---------- Permissions ----------

const NONE: ActionSet = { view: false, create: false, edit: false, delete: false, export: false };
const ALL: ActionSet = { view: true, create: true, edit: true, delete: true, export: true };

// "VCEDX" letters: View, Create, Edit, Delete, eXport
function actions(letters: string): ActionSet {
  return {
    view: letters.includes("V"),
    create: letters.includes("C"),
    edit: letters.includes("E"),
    delete: letters.includes("D"),
    export: letters.includes("X"),
  };
}

function permissionsFor(letters: Partial<Record<PanelModule, string>>): RolePermissions {
  return Object.fromEntries(PANEL_MODULES.map((module) => [module.key, actions(letters[module.key] ?? "")])) as RolePermissions;
}

const ALL_PERMISSIONS = Object.fromEntries(PANEL_MODULES.map((module) => [module.key, ALL])) as RolePermissions;

export const OWNER_ROLE: PanelRole = { id: "owner", name: "Owner", isBuiltIn: true, hasPanelAccess: true, permissions: ALL_PERMISSIONS };

// A permission grid with every module filled in (roles saved before a module existed get it unticked)
function completePermissions(permissions: Partial<RolePermissions> | undefined): RolePermissions {
  return Object.fromEntries(
    PANEL_MODULES.map((module) => [module.key, { ...NONE, ...(permissions?.[module.key] ?? {}) }]),
  ) as RolePermissions;
}

// ---------- The team, roles and owner, from the database ----------

// The rows as the database keeps them
type RoleRow = { id: string; name: string; is_built_in: boolean; has_panel_access: boolean; permissions: Partial<RolePermissions> };
type StaffRow = {
  mobile_number: string;
  name: string;
  role_id: string | null;
  title: string | null;
  is_active: boolean;
  password_kind: "pin" | "password" | null;
  delete_requested_at: string | null;
  profile_change: ProfileChangeRequest | null;
};

const NO_ROLES: PanelRole[] = [];
const NO_TEAM: StaffMember[] = [];

let roles: PanelRole[] = NO_ROLES; // every role except Owner (the owner is shown on its own)
let staffMembers: StaffMember[] = NO_TEAM; // everyone except the owner
let ownerDetails: OwnerDetails = NO_OWNER;
// Whose team this is (the logged-in number it was read for), and whether a read is under way
let loadedForMobile: string | null | undefined = undefined;
let loadingForMobile: string | null | undefined = undefined;
const staffListeners = new Set<() => void>();

function announceTeamChange() {
  staffListeners.forEach((onChange) => onChange());
}

/*
  Reads the roles and the team the logged-in person may see (the database's rules decide: their own row,
  or everyone for the owner and people with Staff → View). Logged out: no team.
*/
async function loadTeam(mobileNumber: string | null) {
  loadingForMobile = mobileNumber;
  if (!mobileNumber) {
    roles = NO_ROLES;
    staffMembers = NO_TEAM;
    ownerDetails = NO_OWNER;
  } else {
    const supabase = createClient();
    const [roleAnswer, staffAnswer] = await Promise.all([
      supabase.from("panel_roles").select("id, name, is_built_in, has_panel_access, permissions").order("created_at"),
      supabase.from("staff_members").select("mobile_number, name, role_id, title, is_active, password_kind, delete_requested_at, profile_change").order("created_at"),
    ]);
    // A newer login started meanwhile: its own read wins
    if (loadingForMobile !== mobileNumber) return;
    if (roleAnswer.error || staffAnswer.error) console.error("Could not read the team", roleAnswer.error ?? staffAnswer.error);
    const roleRows = (roleAnswer.data ?? []) as RoleRow[];
    const staffRows = ((staffAnswer.data ?? []) as StaffRow[]).filter((row) => row.is_active);
    // Built-in roles from highest to lowest (Owner, Manager, Staff, Delivery agent), then roles the owner added
    const builtInOrder = ["owner", "manager", "staff", "delivery-agent"];
    const rank = (id: string) => (builtInOrder.includes(id) ? builtInOrder.indexOf(id) : builtInOrder.length);
    roles = roleRows
      .filter((row) => row.id !== "owner")
      .sort((first, second) => rank(first.id) - rank(second.id))
      .map((row) => ({ id: row.id, name: row.name, isBuiltIn: row.is_built_in, hasPanelAccess: row.has_panel_access, permissions: completePermissions(row.permissions) }));
    const ownerRow = staffRows.find((row) => row.role_id === "owner");
    ownerDetails = ownerRow ? { name: ownerRow.name, mobileNumber: ownerRow.mobile_number, passwordKind: ownerRow.password_kind } : NO_OWNER;
    staffMembers = staffRows
      .filter((row) => row.role_id !== "owner")
      .map((row) => ({
        mobileNumber: row.mobile_number,
        name: row.name,
        roleId: row.role_id,
        title: row.title ?? undefined,
        deleteRequestedAt: row.delete_requested_at ?? undefined,
        profileChange: row.profile_change ?? undefined,
      }));
  }
  loadedForMobile = mobileNumber;
  announceTeamChange();
}

// Reads the team for this login once (again after a change, or when asked to refresh)
function ensureTeamFor(mobileNumber: string | null, refresh = false) {
  if (!refresh && (loadedForMobile === mobileNumber || loadingForMobile === mobileNumber)) return;
  void loadTeam(mobileNumber);
}

// Reads the team again (the Staff section added, changed or removed someone)
export function refreshTeam() {
  ensureTeamFor(loadedForMobile ?? null, true);
}

// After a change: show it at once, save it, and read the team again if the database refused it
async function saveThenCheck(change: () => void, write: () => PromiseLike<{ error: unknown }>) {
  change();
  announceTeamChange();
  const { error } = await write();
  if (error) {
    console.error("The database did not accept the change", error);
    ensureTeamFor(loadedForMobile ?? null, true);
  }
}

// Adds a person, or replaces them if the number is already on the team (owner only).
export function saveStaffMember(member: StaffMember) {
  void saveThenCheck(
    () => {
      staffMembers = [...staffMembers.filter((existing) => existing.mobileNumber !== member.mobileNumber), member];
    },
    () =>
      createClient()
        .from("staff_members")
        .upsert(
          { mobile_number: member.mobileNumber, name: member.name, role_id: member.roleId, title: member.title ?? null, is_active: true },
          { onConflict: "mobile_number" },
        ),
  );
}

export function removeStaffMember(mobileNumber: string) {
  void saveThenCheck(
    () => {
      staffMembers = staffMembers.filter((member) => member.mobileNumber !== mobileNumber);
    },
    () => createClient().from("staff_members").delete().eq("mobile_number", mobileNumber),
  );
}

export function saveRolePermissions(roleId: string, permissions: RolePermissions) {
  void saveThenCheck(
    () => {
      roles = roles.map((role) => (role.id === roleId ? { ...role, permissions } : role));
    },
    () => createClient().from("panel_roles").update({ permissions }).eq("id", roleId),
  );
}

// A new role starts with nothing ticked except the dashboard
export function addRole(name: string) {
  const baseId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "role";
  let id = baseId;
  for (let copy = 2; [OWNER_ROLE, ...roles].some((role) => role.id === id); copy++) id = `${baseId}-${copy}`;
  const newRole: PanelRole = { id, name, isBuiltIn: false, hasPanelAccess: true, permissions: permissionsFor({ dashboard: "V" }) };
  void saveThenCheck(
    () => {
      roles = [...roles, newRole];
    },
    () =>
      createClient()
        .from("panel_roles")
        .insert({ id, name, is_built_in: false, has_panel_access: true, permissions: newRole.permissions }),
  );
  return newRole;
}

export function renameRole(roleId: string, name: string) {
  void saveThenCheck(
    () => {
      roles = roles.map((role) => (role.id === roleId ? { ...role, name } : role));
    },
    () => createClient().from("panel_roles").update({ name }).eq("id", roleId),
  );
}

// Only roles nobody has can be deleted (the built-in ones never)
export function deleteRole(roleId: string) {
  void saveThenCheck(
    () => {
      roles = roles.filter((role) => role.id !== roleId || role.isBuiltIn);
    },
    () => createClient().from("panel_roles").delete().eq("id", roleId).eq("is_built_in", false),
  );
}

// The owner changes their name (no password needed; the number changes through changeOwnerNumber)
export function saveOwnerName(name: string) {
  void saveThenCheck(
    () => {
      ownerDetails = { ...ownerDetails, name };
    },
    () => createClient().from("staff_members").update({ name }).eq("role_id", "owner"),
  );
}

/*
  The owner's PIN (6 digits) or password (at least 8 characters). Supabase Auth keeps it scrambled; nobody
  can read it back. The team row only notes which kind they chose, so the panel knows it is set.
  Returns a problem to show, or null when saved.
*/
export async function saveOwnPassword(secret: string, kind: "pin" | "password"): Promise<string | null> {
  if (kind === "pin" && !/^\d{6}$/.test(secret)) return "A PIN is exactly 6 digits";
  if (kind === "password" && secret.length < 8) return "Use at least 8 characters";
  const supabase = createClient();
  const { error } = await supabase.auth.updateUser({ password: secret });
  if (error) return `Couldn't save the ${kind === "pin" ? "PIN" : "password"}. Please try again.`;
  const marked = await supabase.from("staff_members").update({ password_kind: kind }).eq("role_id", "owner");
  if (marked.error) return "Saved, but the panel couldn't note it. Please try again.";
  ownerDetails = { ...ownerDetails, passwordKind: kind };
  announceTeamChange();
  return null;
}

// Supabase checks the owner's PIN or password and marks this login "password confirmed" for 10 minutes
async function confirmOwnerSecret(secret: string): Promise<string | null> {
  const ownerMobile = ownerDetails.mobileNumber;
  if (!ownerMobile) return "Only the owner can do this";
  const { error } = await createClient().auth.signInWithPassword({ phone: `+91${ownerMobile}`, password: secret });
  return error ? "That PIN or password isn't right" : null;
}

/*
  Reject a team member's request to delete their account (Roles & permissions → Staff): the database's
  decline_account_deletion() clears it (the owner, or a manager for anyone who isn't a manager). Shown at
  once; answers an error message, or null.
*/
export async function declineAccountDeletion(mobileNumber: string): Promise<string | null> {
  const { error } = await createClient().rpc("decline_account_deletion", { staff_mobile: mobileNumber });
  if (error) return error.message || "Couldn't reject the request. Please try again.";
  staffMembers = staffMembers.map((member) => (member.mobileNumber === mobileNumber ? { ...member, deleteRequestedAt: undefined } : member));
  announceTeamChange();
  return null;
}

// The logged-in person's own row on the staff list (not the owner, who changes their details in their own way)
export function useMyTeamRecord() {
  const mobileNumber = useLoggedInMobileNumber();
  return useStaffMembers().find((member) => member.mobileNumber === mobileNumber);
}

// The owner or a manager makes someone on the staff list Staff (Staff section) or a Delivery agent (Routes &
// agents); the database checks it. Answers a problem to show, or null.
export async function giveTeamRole(mobileNumber: string, role: "staff" | "delivery-agent", bike?: string): Promise<string | null> {
  const { error } = await createClient().rpc("give_team_role", { staff_mobile: mobileNumber, new_role: role, bike: bike ?? null });
  if (error) return error.message || "Couldn't give the role. Please try again.";
  refreshTeam();
  return null;
}

/*
  A team member changing their Profile (any detail): they ask with a reason, anyone with Staff → Edit answers
  on the Staff section or Roles & permissions (never for themselves), then they press Save and the accepted
  values are saved. All checked by the database (0031_…sql). Each answers a problem to show, or null.
*/
async function afterStaffRequest(error: { message?: string } | null, fallback: string) {
  if (error) return error.message || fallback;
  refreshTeam();
  return null;
}

export async function requestProfileChange(details: Record<string, string>, reason: string) {
  const { error } = await createClient().rpc("request_profile_change", { details, reason });
  return afterStaffRequest(error, "Couldn't send the request. Please try again.");
}

// Takes back a waiting request, or clears a rejected one
export async function clearMyProfileChange() {
  const { error } = await createClient().rpc("clear_my_profile_change");
  return afterStaffRequest(error, "Please try again.");
}

export async function decideProfileChange(mobileNumber: string, accept: boolean, rejectReason?: string) {
  const { error } = await createClient().rpc("decide_profile_change", { staff_mobile: mobileNumber, accept, reject_reason: rejectReason ?? null });
  return afterStaffRequest(error, "Couldn't save the answer. Please try again.");
}

// Save after it was accepted: "saved", "confirm-number" (a new number still needs its OTP), or a problem
export async function applyMyProfileChange(): Promise<{ result: "saved" | "confirm-number" } | { problem: string }> {
  const { data, error } = await createClient().rpc("apply_my_profile_change");
  if (error) return { problem: error.message || "Couldn't save. Please try again." };
  refreshTeam();
  return { result: data as "saved" | "confirm-number" };
}

/*
  Changing the login number: an OTP goes to the new number; once it is confirmed the login has that number and
  finish_my_number_change() moves everything to it. (A team member's new number must be accepted first.)
*/
export async function sendNewNumberOtp(newNumber: string) {
  const { error } = await createClient().auth.updateUser({ phone: `+91${newNumber}` });
  return error ? error.message || "Couldn't send the OTP. Please try again." : null;
}

export async function confirmNewNumberOtp(newNumber: string, code: string) {
  const supabase = createClient();
  const { error } = await supabase.auth.verifyOtp({ phone: `+91${newNumber}`, token: code, type: "phone_change" });
  if (error) return error.message || "That OTP didn't work. Please try again.";
  const moved = await supabase.rpc("finish_my_number_change");
  return moved.error ? moved.error.message || "Couldn't move your account. Please contact the farm." : null;
}

/*
  Delete a role (Roles & permissions → Delete role): after the owner's PIN / password check, the database
  function delete_panel_role() deletes it, only when nobody has it (Owner and Delivery agent never;
  supabase/migrations/0015_…sql). Answers an error message, or null.
*/
export async function deleteRoleWithSecret(roleId: string, secret: string): Promise<string | null> {
  const problem = await confirmOwnerSecret(secret);
  if (problem) return problem;
  const { error } = await createClient().rpc("delete_panel_role", { role_to_delete: roleId });
  if (error) return error.message || "Couldn't delete the role. Please try again.";
  roles = roles.filter((role) => role.id !== roleId);
  ensureTeamFor(loadedForMobile ?? null, true);
  return null;
}

/*
  Transfer ownership: after the PIN / password check, the database function transfer_ownership() makes
  the new number the Owner and this owner a Manager, in one step (supabase/migrations/0007_…sql).
*/
export async function transferOwnership(newOwnerMobile: string, newOwnerName: string, secret: string): Promise<string | null> {
  const problem = await confirmOwnerSecret(secret);
  if (problem) return problem;
  const { error } = await createClient().rpc("transfer_ownership", { new_owner_mobile: newOwnerMobile, new_owner_name: newOwnerName });
  if (error) return error.message || "Couldn't transfer ownership. Please try again.";
  ensureTeamFor(loadedForMobile ?? null, true);
  return null;
}

/*
  The owner moves to a new mobile number (still the owner). After the PIN / password check, the database
  function change_owner_mobile() changes it. The new number is their login from then on: they log in with
  it and its OTP, and set a PIN or password again there.
*/
export async function changeOwnerNumber(newMobile: string, secret: string): Promise<string | null> {
  const problem = await confirmOwnerSecret(secret);
  if (problem) return problem;
  const { error } = await createClient().rpc("change_owner_mobile", { new_mobile: newMobile });
  if (error) return error.message || "Couldn't change the number. Please try again.";
  ensureTeamFor(loadedForMobile ?? null, true);
  return null;
}

// Forgot PIN / password: an OTP to the owner's login number …
export async function sendOwnerResetCode(): Promise<string | null> {
  const { error } = await createClient().auth.signInWithOtp({ phone: `+91${ownerDetails.mobileNumber}` });
  return error ? "Couldn't send the OTP. Please try again in a moment." : null;
}

// … and the code typed back; then a new PIN / password can be saved with saveOwnPassword
export async function checkOwnerResetCode(code: string): Promise<string | null> {
  const { error } = await createClient().auth.verifyOtp({ phone: `+91${ownerDetails.mobileNumber}`, token: code, type: "sms" });
  return error ? "Wrong code. Check it and try again." : null;
}

// ---------- Hooks ----------

// Back to this window (e.g. after the owner changed the team on another laptop): read the team again.
// One listener for the whole page, not one per component, so a focus is one read, not one per hook.
let isFollowingFocus = false;

function startRefreshingOnFocus() {
  if (isFollowingFocus || typeof window === "undefined") return;
  isFollowingFocus = true;
  window.addEventListener("focus", () => {
    if (loadedForMobile) ensureTeamFor(loadedForMobile, true);
  });
}

function subscribeToTeam(onChange: () => void) {
  staffListeners.add(onChange);
  startRefreshingOnFocus();
  return () => {
    staffListeners.delete(onChange);
  };
}

// Reads the team for whoever is logged in now (and again when someone else logs in)
function useTeamForLogin() {
  const mobileNumber = useLoggedInMobileNumber();
  useEffect(() => {
    ensureTeamFor(mobileNumber);
  }, [mobileNumber]);
  return mobileNumber;
}

export function useOwnerDetails() {
  useTeamForLogin();
  return useSyncExternalStore(subscribeToTeam, () => ownerDetails, () => NO_OWNER);
}

export function useStaffMembers() {
  useTeamForLogin();
  return useSyncExternalStore(subscribeToTeam, () => staffMembers, () => NO_TEAM);
}

export function usePanelRoles() {
  useTeamForLogin();
  return useSyncExternalStore(subscribeToTeam, () => roles, () => NO_ROLES);
}

/*
  True once the team has been read for the person logged in now (or nobody is logged in). The panel waits
  for this before deciding "staff or customer", so nobody is sent away while it is still loading.
*/
export function useIsStaffAccessKnown() {
  const mobileNumber = useTeamForLogin();
  const loadedFor = useSyncExternalStore(subscribeToTeam, () => loadedForMobile, () => undefined);
  return mobileNumber === null || loadedFor === mobileNumber;
}

// What a mobile number can do in the panel, or null (customers, and people whose role has no panel).
export function getStaffAccess(
  mobileNumber: string | null,
  team: StaffMember[],
  owner: OwnerDetails,
  allRoles: PanelRole[] = roles,
): StaffAccess | null {
  if (!mobileNumber) return null;
  if (owner.mobileNumber && mobileNumber === owner.mobileNumber) {
    return {
      roleId: "owner",
      roleName: "Owner",
      name: owner.name,
      isOwner: true,
      can: () => true,
      canOpenFeature: () => true,
      canManageTeam: true,
    };
  }
  const member = team.find((existing) => existing.mobileNumber === mobileNumber);
  const role = member && allRoles.find((existing) => existing.id === member.roleId);
  if (!member || !role || !role.hasPanelAccess) return null;
  const can = (module: PanelModule, action: PermissionAction) => {
    const allowed = role.permissions[module];
    // Any action needs View first
    return Boolean(allowed?.view && allowed[action]);
  };
  return {
    roleId: role.id,
    roleName: role.name,
    name: member.name,
    isOwner: false,
    can,
    canOpenFeature: (feature) => can(feature, "view"),
    canManageTeam: false,
  };
}

// The logged-in person's panel access, or null (customers, logged-out visitors, and on the server).
export function useCurrentStaffAccess() {
  const mobileNumber = useLoggedInMobileNumber();
  const team = useStaffMembers();
  const owner = useOwnerDetails();
  const allRoles = usePanelRoles();
  return getStaffAccess(mobileNumber, team, owner, allRoles);
}
