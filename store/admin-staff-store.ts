import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { refreshTeam } from "./staff-access-store";

/*
  The farm's staff for the Chiranvi Panel's Staff section (and the Staff attendance report), saved in the
  database's staff_members table (supabase/migrations/0021_staff_section.sql): the one staff list. People
  are added here; Roles & permissions gives one of them a login role (owner, manager, staff, delivery agent),
  picked from the people added here. Job, phone, shift, today's attendance, days absent this month, salary.
  - The database's rules: the owner adds anyone; Staff → Create adds people without a role; Staff → Edit
    edits; only the owner changes a salary or a role.
  - Each new day (start_staff_day(), run when the list is read) everyone starts as present, except people on
    leave; whoever wasn't present the day before has that day added to their days absent this month (a new
    month starts from zero).
  The owner isn't on this list (the owner is shown on Roles & permissions).
*/

export type StaffGroup = "Delivery" | "Farm" | "Managers";
export type TodayStatus = "Present" | "Absent" | "On leave";

export type StaffPerson = {
  id: string;
  name: string;
  job: string; // "Delivery agent", "Farm worker", "Manager", ...
  group: StaffGroup;
  phone: string; // 10 digits (their login number if they get a role)
  shift: string; // "5 AM – 1 PM"
  salary: number; // a month
  today: TodayStatus;
  daysAbsentThisMonth: number; // before today
  roleId: string | null; // their login role on Roles & permissions (null: none)
  joinedOn: string; // ISO: when they joined the staff list
};

export const STAFF_JOBS: { job: string; group: StaffGroup }[] = [
  { job: "Delivery agent", group: "Delivery" },
  { job: "Driver", group: "Delivery" },
  { job: "Farm worker", group: "Farm" },
  { job: "Milking", group: "Farm" },
  { job: "Cattle care", group: "Farm" },
  { job: "Packing", group: "Farm" },
  { job: "Cleaner", group: "Farm" },
  { job: "Manager", group: "Managers" },
];

export const STAFF_SHIFTS = ["4 AM – 12 PM", "5 AM – 1 PM", "9 AM – 6 PM", "2 PM – 10 PM"];

// The row as the database keeps it
type StaffRow = {
  id: string;
  mobile_number: string;
  name: string;
  role_id: string | null;
  job: string;
  staff_group: StaffGroup;
  shift: string;
  salary_paise: number;
  today_status: TodayStatus;
  days_absent_this_month: number;
  is_active: boolean;
  created_at: string;
};

const EMPTY: StaffPerson[] = [];
let staff: StaffPerson[] = EMPTY;
let isFollowing = false;
const listeners = new Set<() => void>();

function announce() {
  listeners.forEach((onChange) => onChange());
}

async function loadStaff() {
  const supabase = createClient();
  // The staff list is for the team: nobody logged in → nothing to read
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return;
  // A new day first (counts yesterday's absences); it does nothing without Staff → View
  await supabase.rpc("start_staff_day");
  const { data, error } = await supabase
    .from("staff_members")
    .select("id, mobile_number, name, role_id, job, staff_group, shift, salary_paise, today_status, days_absent_this_month, is_active, created_at")
    .order("created_at");
  if (error) {
    console.error("Could not read the staff:", error.message || error.code);
    return;
  }
  staff = ((data ?? []) as StaffRow[])
    .filter((row) => row.is_active && row.role_id !== "owner")
    .map((row) => ({
      id: row.id,
      name: row.name,
      job: row.job,
      group: row.staff_group,
      phone: row.mobile_number,
      shift: row.shift,
      salary: row.salary_paise / 100,
      today: row.today_status,
      daysAbsentThisMonth: row.days_absent_this_month,
      roleId: row.role_id,
      joinedOn: row.created_at,
    }));
  announce();
}

function startFollowingStaff() {
  if (isFollowing || typeof window === "undefined") return;
  isFollowing = true;
  void loadStaff();
  window.addEventListener("focus", () => void loadStaff());
  createClient().auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") window.setTimeout(() => void loadStaff(), 0);
  });
}

// After a change: shown at once, saved, and read again (Roles & permissions too); if refused, read again
async function saveThenCheck(change: () => void, write: () => PromiseLike<{ error: { message?: string } | null }>) {
  change();
  announce();
  const { error } = await write();
  if (error) console.error("The database did not accept the staff change", error);
  void loadStaff();
  refreshTeam();
  return error;
}

export function setTodayStatus(id: string, today: TodayStatus) {
  void saveThenCheck(
    () => (staff = staff.map((person) => (person.id === id ? { ...person, today } : person))),
    () => createClient().from("staff_members").update({ today_status: today }).eq("id", id),
  );
}

export function updateStaffPerson(id: string, changes: Partial<Pick<StaffPerson, "name" | "job" | "group" | "phone" | "shift" | "salary">>) {
  const row: Partial<StaffRow> = {};
  if (changes.name !== undefined) row.name = changes.name;
  if (changes.job !== undefined) row.job = changes.job;
  if (changes.group !== undefined) row.staff_group = changes.group;
  if (changes.phone !== undefined) row.mobile_number = changes.phone;
  if (changes.shift !== undefined) row.shift = changes.shift;
  if (changes.salary !== undefined) row.salary_paise = Math.round(changes.salary * 100);
  void saveThenCheck(
    () => (staff = staff.map((person) => (person.id === id ? { ...person, ...changes } : person))),
    () => createClient().from("staff_members").update(row).eq("id", id),
  );
}

// The name on this number's customer account, or null (0040_customer_name_for_staff.sql)
export async function findCustomerName(mobileNumber: string) {
  const { data, error } = await createClient().rpc("customer_name_for_staff", { p_mobile: mobileNumber });
  if (error) console.error("Could not check the number for a customer account", error);
  return (data as string | null) ?? null;
}

// Adds a person to the staff list (without a role). Answers the new person, or a problem to show.
export async function addStaffPerson(
  person: Pick<StaffPerson, "name" | "job" | "group" | "phone" | "shift" | "salary">,
): Promise<StaffPerson | { error: string }> {
  const { data, error } = await createClient()
    .from("staff_members")
    .insert({
      name: person.name,
      mobile_number: person.phone,
      job: person.job,
      staff_group: person.group,
      shift: person.shift,
      salary_paise: Math.round(person.salary * 100),
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("The database did not accept the new staff member", error);
    if (error?.code === "23505") return { error: "That number is already on the staff list" };
    return { error: "Couldn't add the staff member. You may not be allowed to (Staff → Create)." };
  }
  void loadStaff();
  refreshTeam();
  return { ...person, id: data.id, today: "Present", daysAbsentThisMonth: 0, roleId: null, joinedOn: new Date().toISOString() };
}

// Removes the person from the staff list (and their role, if they had one)
export function removeStaffPerson(id: string) {
  void saveThenCheck(
    () => (staff = staff.filter((person) => person.id !== id)),
    () => createClient().from("staff_members").delete().eq("id", id),
  );
}

// Days present this month so far, counting today if present
export function getDaysPresent(person: StaffPerson, date = new Date()) {
  const daysSoFar = date.getDate();
  return Math.max(0, daysSoFar - person.daysAbsentThisMonth - (person.today === "Present" ? 0 : 1));
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  startFollowingStaff();
  return () => {
    listeners.delete(onChange);
  };
}

export function useStaffList() {
  return useSyncExternalStore(subscribe, () => staff, () => EMPTY);
}
