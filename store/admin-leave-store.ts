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
  - A document the person attaches is kept in the private "leave-documents" Storage bucket, in a folder named
    after their number: they and anyone with Staff → View can open it, through a link that soon stops working.
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
  path?: string; // where the file is in the bucket (none: only its details were saved)
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

// What can be attached (the bucket has the same limits)
export const LEAVE_DOCUMENT_TYPES = "image/jpeg,image/png,image/webp,application/pdf";
const LEAVE_DOCUMENT_MEGABYTES = 5;
const LEAVE_DOCUMENT_BUCKET = "leave-documents";
// How long a link to a document works, in seconds
const LEAVE_DOCUMENT_LINK_SECONDS = 300;

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

// What's wrong with a file chosen to attach, or null when it can be sent
export function leaveDocumentProblem(file: File) {
  if (!LEAVE_DOCUMENT_TYPES.split(",").includes(file.type)) return "Attach a photo (JPG, PNG or WebP) or a PDF.";
  if (file.size > LEAVE_DOCUMENT_MEGABYTES * 1024 * 1024) return `That file is over ${LEAVE_DOCUMENT_MEGABYTES} MB. Attach a smaller one.`;
  return null;
}

// A short-lived link to an attached document, or null when it can't be opened
export async function leaveDocumentLink(path: string) {
  const { data, error } = await createClient().storage.from(LEAVE_DOCUMENT_BUCKET).createSignedUrl(path, LEAVE_DOCUMENT_LINK_SECONDS);
  if (error) console.error("Could not open the leave document", error);
  return data?.signedUrl ?? null;
}

// The file goes in the person's own folder, under a new name (its own name is kept on the request)
async function uploadLeaveDocument(staffMobile: string, file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const path = `${staffMobile}/${crypto.randomUUID()}.${extension}`;
  const { error } = await createClient().storage.from(LEAVE_DOCUMENT_BUCKET).upload(path, file, { contentType: file.type });
  if (error) {
    console.error("The leave document was not uploaded", error);
    return null;
  }
  return path;
}

// A team member asks for their own leave (the Delivery Panel's Leaves & attendance), with a document if they
// attach one; waits as Pending for Roles & permissions. Answers a problem to show, or null when saved.
export async function askForMyLeave(staffMobile: string, leave: Pick<LeaveRequest, "type" | "from" | "to" | "reason">, document: File | null) {
  let attachment: LeaveAttachment | null = null;
  if (document) {
    const path = await uploadLeaveDocument(staffMobile, document);
    if (!path) return "Couldn't upload the document. Try again, or send the request without it.";
    attachment = { fileName: document.name, label: "Attached document", path };
  }
  const { error } = await createClient().from("leave_requests").insert({
    staff_mobile: staffMobile,
    leave_type: leave.type,
    from_date: leave.from,
    to_date: leave.type === "Half day" ? leave.from : leave.to,
    reason: leave.reason,
    attachment,
  });
  await loadLeaveRequests();
  if (error) {
    console.error("The database did not accept the leave request", error);
    return "Couldn't send your leave request. Check the dates and try again.";
  }
  return null;
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
