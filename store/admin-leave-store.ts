import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";

/*
  Leave requests from the team, saved in the Supabase "leave_requests" table
  (supabase/migrations/0015_leave_requests_and_role_delete.sql): type, dates, reason, an attached document
  (a medical certificate, invitation, ...), and the decision. Kept by the person's login number, so they
  belong to someone on Roles & permissions. Shown on Roles & permissions → Staff (each person's leave) and
  on the Staff page (the Leave requests card and its pop-up).
  - The database's rules: the person reads and asks for their own; anyone with Staff → View reads the
    team's; deciding needs Staff → Edit.
  - Each type has a yearly allowance; approved days are taken from it (Unpaid has no limit).
  Read when first needed (only when someone is logged in), again when the window comes back into focus and
  after logging in or out. A decision shows at once and is
  then saved; if the database refuses it, the list is read again.
*/

export type LeaveType = "Casual" | "Sick" | "Earned" | "Emergency" | "Half day" | "Unpaid";
export type LeaveStatus = "Pending" | "Approved" | "Rejected";

export type LeaveAttachment = {
  fileName: string; // "medical-certificate.pdf"
  label: string; // "Medical certificate"
  issuedBy?: string; // "Dr. Ramya, Sparsh Clinic"
};

export type LeaveRequest = {
  id: string;
  staffMobile: string; // the person's login number (10 digits)
  staffName: string;
  type: LeaveType;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  reason: string;
  attachment?: LeaveAttachment;
  appliedAt: string; // ISO date and time
  status: LeaveStatus;
  decidedAt?: string;
  decidedBy?: string;
  rejectReason?: string;
};

export const LEAVE_TYPES: LeaveType[] = ["Casual", "Sick", "Earned", "Emergency", "Half day", "Unpaid"];

// Days allowed a year for each type (Unpaid: no limit)
export const LEAVE_ALLOWANCE: Record<LeaveType, number | null> = {
  Casual: 12,
  Sick: 8,
  Earned: 15,
  Emergency: 3,
  "Half day": 6,
  Unpaid: null,
};

// The row as the database keeps it, with the person's name from the team
type LeaveRow = {
  id: string;
  staff_mobile: string;
  leave_type: LeaveType;
  from_date: string;
  to_date: string;
  reason: string;
  attachment: LeaveAttachment | null;
  status: LeaveStatus;
  applied_at: string;
  decided_at: string | null;
  decided_by: string | null;
  reject_reason: string | null;
  staff_members: { name: string } | null;
};

function toRequest(row: LeaveRow): LeaveRequest {
  return {
    id: row.id,
    staffMobile: row.staff_mobile,
    staffName: row.staff_members?.name ?? row.staff_mobile,
    type: row.leave_type,
    from: row.from_date,
    to: row.to_date,
    reason: row.reason,
    attachment: row.attachment ?? undefined,
    appliedAt: row.applied_at,
    status: row.status,
    decidedAt: row.decided_at ?? undefined,
    decidedBy: row.decided_by ?? undefined,
    rejectReason: row.reject_reason ?? undefined,
  };
}

function dayKey(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const EMPTY: LeaveRequest[] = [];
let requests: LeaveRequest[] = EMPTY;
let isFollowing = false;
const listeners = new Set<() => void>();

function announce() {
  listeners.forEach((onChange) => onChange());
}

async function loadLeaveRequests() {
  const supabase = createClient();
  // Leave is private to the team: nobody logged in (or the login not read yet) → nothing to read
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    requests = EMPTY;
    announce();
    return;
  }
  const { data, error } = await supabase
    .from("leave_requests")
    .select("*, staff_members(name)")
    .order("applied_at", { ascending: false })
    .limit(500);
  if (error) {
    // Not allowed (not on the team): an empty list, not an error
    if (error.code !== "42501") console.error("Could not read the leave requests:", error.message || error.code);
    requests = EMPTY;
    announce();
    return;
  }
  requests = ((data ?? []) as LeaveRow[]).map(toRequest);
  announce();
}

function startFollowingLeaveRequests() {
  if (isFollowing || typeof window === "undefined") return;
  isFollowing = true;
  void loadLeaveRequests();
  window.addEventListener("focus", () => void loadLeaveRequests());
  // Read again after logging in or out (called from inside Supabase: the read is done just after)
  createClient().auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") window.setTimeout(() => void loadLeaveRequests(), 0);
  });
}

export function decideLeave(id: string, status: Exclude<LeaveStatus, "Pending">, decidedBy: string, rejectReason?: string) {
  const decidedAt = new Date().toISOString();
  const shownReason = status === "Rejected" ? rejectReason : undefined;
  requests = requests.map((request) => (request.id === id ? { ...request, status, decidedBy, decidedAt, rejectReason: shownReason } : request));
  announce();
  void createClient()
    .from("leave_requests")
    .update({ status, decided_by: decidedBy, decided_at: decidedAt, reject_reason: shownReason ?? null })
    .eq("id", id)
    .then(({ error }) => {
      if (error) {
        console.error("The database did not accept the leave decision", error);
        void loadLeaveRequests();
      }
    });
}

// Number of leave days (a half day counts as half)
export function getLeaveDays(request: Pick<LeaveRequest, "from" | "to" | "type">) {
  if (request.type === "Half day") return 0.5;
  const from = new Date(`${request.from}T12:00:00`);
  const to = new Date(`${request.to}T12:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
}

// Days of this type still allowed this year, after approved requests (null: no limit)
export function getLeaveLeft(staffName: string, type: LeaveType, allRequests: LeaveRequest[]) {
  const allowance = LEAVE_ALLOWANCE[type];
  if (allowance === null) return null;
  const year = String(new Date().getFullYear());
  const used = allRequests
    .filter((request) => request.staffName === staffName && request.type === type && request.status === "Approved" && request.from.startsWith(year))
    .reduce((sum, request) => sum + getLeaveDays(request), 0);
  return Math.max(0, allowance - used);
}

export function coversToday(request: Pick<LeaveRequest, "from" | "to">) {
  const today = dayKey(0);
  return request.from <= today && request.to >= today;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  startFollowingLeaveRequests();
  return () => {
    listeners.delete(onChange);
  };
}

export function useLeaveRequests() {
  return useSyncExternalStore(subscribe, () => requests, () => EMPTY);
}
