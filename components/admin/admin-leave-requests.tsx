"use client";

import { useEffect, useState } from "react";
import {
  LEAVE_ALLOWANCE,
  LEAVE_TYPES,
  coversToday,
  decideLeave,
  getLeaveDays,
  getLeaveLeft,
  leaveDocumentLink,
  useLeaveRequests,
  type LeaveRequest,
  type LeaveStatus,
  type LeaveType,
} from "@/store/admin-leave-store";
import { setTodayStatus, type StaffPerson } from "@/store/admin-staff-store";
import { setAgentOnLeave } from "@/store/admin-routes-store";
import { useCurrentStaffAccess } from "@/store/staff-access-store";
import { AdminFilterTabs } from "./admin-shared";
import dashboardStyles from "./admin-dashboard.module.css";
import sharedStyles from "./admin-shared.module.css";
import styles from "./admin-leave-requests.module.css";

/*
  Leave requests pop-up on the Staff page (opened from the Leave requests card), over the blurred page.
    tabs       Pending / Approved / Rejected, and the leave type (Casual, Sick, Earned, Emergency,
               Half day, Unpaid)
    each       who, type, dates and days, reason, the attached document (View opens it), how many days
               of that type are left, Approve / Reject (rejecting can say why)
  Approving leave that covers today marks the person on leave on the Staff page (and, for delivery
  agents, off duty on Routes & agents). Requests come from store/admin-leave-store.ts.
*/

type StatusTab = "Pending" | "Approved" | "Rejected";
type TypeTab = "all" | LeaveType;

const TYPE_CLASS_NAMES: Record<LeaveType, string> = {
  Casual: dashboardStyles["admin-status-out-for-delivery"],
  Sick: dashboardStyles["admin-status-pending"],
  Earned: dashboardStyles["admin-status-delivered"],
  Emergency: sharedStyles["admin-status-warning"],
  "Half day": sharedStyles["admin-priority-low"],
  Unpaid: sharedStyles["admin-status-cancelled"],
};

const STATUS_CLASS_NAMES: Record<LeaveStatus, string> = {
  Pending: dashboardStyles["admin-status-pending"],
  Approved: dashboardStyles["admin-status-delivered"],
  Rejected: sharedStyles["admin-status-warning"],
};

const initialsOf = (fullName: string) =>
  fullName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function shortDay(dayKey: string) {
  const date = new Date(`${dayKey}T12:00:00`);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function datesText(request: LeaveRequest) {
  const days = getLeaveDays(request);
  const dayCount = days === 0.5 ? "half a day" : `${days} ${days === 1 ? "day" : "days"}`;
  return request.from === request.to ? `${shortDay(request.from)} · ${dayCount}` : `${shortDay(request.from)} – ${shortDay(request.to)} · ${dayCount}`;
}

function timeAgo(isoDate: string) {
  const hours = Math.round((Date.now() - new Date(isoDate).getTime()) / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

export default function AdminLeaveRequests({
  staff,
  onClose,
  showToast,
}: {
  staff: StaffPerson[];
  onClose: () => void;
  showToast: (message: string) => void;
}) {
  const requests = useLeaveRequests();
  const decidedBy = useCurrentStaffAccess()?.name ?? "Chiranvi Panel";
  const [statusTab, setStatusTab] = useState<StatusTab>("Pending");
  const [typeTab, setTypeTab] = useState<TypeTab>("all");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [viewing, setViewing] = useState<LeaveRequest | null>(null);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // The document closes first, then the pop-up
      if (viewing) setViewing(null);
      else onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, viewing]);

  const inStatus = requests.filter((request) => request.status === statusTab);
  const shown = inStatus
    .filter((request) => typeTab === "all" || request.type === typeTab)
    // Waiting: soonest leave first; decided: latest decision first
    .sort((first, second) =>
      statusTab === "Pending" ? first.from.localeCompare(second.from) : (second.decidedAt ?? "").localeCompare(first.decidedAt ?? ""),
    );
  const countOf = (status: LeaveStatus) => requests.filter((request) => request.status === status).length;
  const personOf = (name: string) => staff.find((person) => person.name === name);

  function approve(request: LeaveRequest) {
    decideLeave(request.id, "Approved", decidedBy);
    const person = personOf(request.staffName);
    if (person && coversToday(request) && request.type !== "Half day") {
      setTodayStatus(person.id, "On leave");
      if (person.group === "Delivery") setAgentOnLeave(person.name, true);
    }
    showToast(
      `${request.type} leave approved for ${request.staffName}${coversToday(request) && request.type !== "Half day" ? " · marked on leave today" : ""}`,
    );
  }

  function reject(request: LeaveRequest) {
    decideLeave(request.id, "Rejected", decidedBy, rejectReason.trim() || undefined);
    setRejectingId(null);
    setRejectReason("");
    showToast(`Leave rejected for ${request.staffName}`);
  }

  return (
    <div className={styles["admin-leave-backdrop"]} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Leave requests" className={styles["admin-leave-popup"]}>
        <div className={styles["admin-leave-heading"]}>
          <div>
            <h2 className={styles["admin-leave-title"]}>Leave requests</h2>
            <p className={styles["admin-leave-subtitle"]}>
              {countOf("Pending")
                ? `${countOf("Pending")} waiting for you · read the reason and document, then approve or reject`
                : "No requests waiting"}
            </p>
          </div>
          <button type="button" className={styles["admin-leave-close"]} aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className={styles["admin-leave-tabs"]}>
          <AdminFilterTabs
            label="Show requests"
            selected={statusTab}
            onSelect={(tab) => {
              setStatusTab(tab);
              setRejectingId(null);
            }}
            tabs={[
              { key: "Pending", label: `Pending ${countOf("Pending")}` },
              { key: "Approved", label: `Approved ${countOf("Approved")}` },
              { key: "Rejected", label: `Rejected ${countOf("Rejected")}` },
            ]}
          />
          <AdminFilterTabs
            label="Leave type"
            selected={typeTab}
            onSelect={setTypeTab}
            tabs={[
              { key: "all", label: "All types" },
              ...LEAVE_TYPES.map((type) => {
                const count = inStatus.filter((request) => request.type === type).length;
                return { key: type as TypeTab, label: count ? `${type} ${count}` : type };
              }),
            ]}
          />
        </div>

        <ul className={styles["admin-leave-list"]}>
          {shown.map((request) => {
            const person = personOf(request.staffName);
            const days = getLeaveDays(request);
            const left = getLeaveLeft(request.staffName, request.type, requests);
            const allowance = LEAVE_ALLOWANCE[request.type];
            const isOverLimit = request.status === "Pending" && left !== null && days > left;
            return (
              <li key={request.id} className={styles["admin-leave-card"]}>
                <div className={styles["admin-leave-card-top"]}>
                  <span className={sharedStyles["admin-person-cell"]}>
                    <span className={sharedStyles["admin-initials"]} aria-hidden="true">
                      {initialsOf(request.staffName)}
                    </span>
                    <span>
                      <span className={styles["admin-leave-name"]}>{request.staffName}</span>
                      <span className={styles["admin-leave-job"]}>
                        {person?.job ?? "Team"} · applied {timeAgo(request.appliedAt)}
                      </span>
                    </span>
                  </span>
                  <span className={`${dashboardStyles["admin-status"]} ${TYPE_CLASS_NAMES[request.type]}`}>{request.type}</span>
                </div>

                <p className={styles["admin-leave-dates"]}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 6h16v14H4z" />
                    <path d="M4 10h16M8 3.5v4M16 3.5v4" />
                  </svg>
                  {datesText(request)}
                  {request.status === "Pending" && coversToday(request) && <span className={styles["admin-leave-today"]}>Starts today</span>}
                </p>

                <p className={styles["admin-leave-reason"]}>{request.reason}</p>

                <div className={styles["admin-leave-details-row"]}>
                  {request.attachment ? (
                    <button type="button" className={styles["admin-leave-attachment"]} onClick={() => setViewing(request)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M15.5 7.5 9 14a2 2 0 0 0 2.8 2.8l7-7a4 4 0 0 0-5.6-5.6l-7 7a6 6 0 0 0 8.5 8.5l6-6" />
                      </svg>
                      <span>
                        <span className={styles["admin-leave-attachment-label"]}>{request.attachment.label}</span>
                        <span className={styles["admin-leave-attachment-file"]}>{request.attachment.fileName}</span>
                      </span>
                      <span className={styles["admin-leave-attachment-view"]}>View</span>
                    </button>
                  ) : (
                    <span className={styles["admin-leave-no-attachment"]}>No document attached</span>
                  )}
                  <span className={`${styles["admin-leave-balance"]} ${isOverLimit ? styles["admin-leave-balance-over"] : ""}`}>
                    {left === null
                      ? "Unpaid: no limit, salary cut for these days"
                      : isOverLimit
                        ? `Asks for ${days} ${days === 1 ? "day" : "days"}, only ${left} ${request.type.toLowerCase()} left`
                        : `${request.type} left: ${left} of ${allowance} days`}
                  </span>
                </div>

                {request.status === "Pending" ? (
                  rejectingId === request.id ? (
                    <div className={styles["admin-leave-reject-box"]}>
                      <label className={styles["admin-leave-reject-label"]}>
                        Reason for rejecting (optional, {request.staffName.split(" ")[0]} sees it)
                        <textarea
                          rows={2}
                          className={styles["admin-leave-reject-input"]}
                          value={rejectReason}
                          onChange={(changeEvent) => setRejectReason(changeEvent.target.value)}
                          autoFocus
                        />
                      </label>
                      <div className={styles["admin-leave-actions"]}>
                        <button type="button" className={styles["admin-leave-cancel"]} onClick={() => setRejectingId(null)}>
                          Cancel
                        </button>
                        <button type="button" className={styles["admin-leave-reject-confirm"]} onClick={() => reject(request)}>
                          Reject leave
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={styles["admin-leave-actions"]}>
                      <button
                        type="button"
                        className={styles["admin-leave-reject"]}
                        onClick={() => {
                          setRejectingId(request.id);
                          setRejectReason("");
                        }}
                      >
                        Reject
                      </button>
                      <button type="button" className={styles["admin-leave-approve"]} onClick={() => approve(request)}>
                        Approve
                      </button>
                    </div>
                  )
                ) : (
                  <p className={styles["admin-leave-decision"]}>
                    <span className={`${dashboardStyles["admin-status"]} ${STATUS_CLASS_NAMES[request.status]}`}>{request.status}</span>
                    by {request.decidedBy}
                    {request.decidedAt ? `, ${new Date(request.decidedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
                    {request.rejectReason && <span className={styles["admin-leave-decision-reason"]}>“{request.rejectReason}”</span>}
                  </p>
                )}
              </li>
            );
          })}
          {shown.length === 0 && (
            <li className={styles["admin-leave-empty"]}>
              {statusTab === "Pending" ? "No requests waiting." : `No ${statusTab.toLowerCase()} requests.`}
            </li>
          )}
        </ul>
      </div>

      {viewing?.attachment && <LeaveDocument request={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/*
  The attached document: the real file (a picture, or a PDF), through a link that soon stops working. Requests
  saved with only the document's details show a sample page with them.
*/
function LeaveDocument({ request, onClose }: { request: LeaveRequest; onClose: () => void }) {
  const attachment = request.attachment!;
  const path = attachment.path;
  // undefined: still being fetched; null: it couldn't be opened
  const [fileLink, setFileLink] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!path) return;
    let isStillOpen = true;
    void leaveDocumentLink(path).then((link) => {
      if (isStillOpen) setFileLink(link);
    });
    return () => {
      isStillOpen = false;
    };
  }, [path]);

  return (
    <div className={styles["admin-leave-document-backdrop"]} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={attachment.label} className={styles["admin-leave-document"]}>
        <div className={styles["admin-leave-document-bar"]}>
          <span>
            <span className={styles["admin-leave-attachment-label"]}>{attachment.label}</span>
            <span className={styles["admin-leave-attachment-file"]}>{attachment.fileName}</span>
          </span>
          <button type="button" className={styles["admin-leave-close"]} aria-label="Close document" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {path ? (
          <LeaveDocumentFile fileLink={fileLink} fileName={attachment.fileName} />
        ) : (
          <>
            <div className={styles["admin-leave-paper"]}>
              <p className={styles["admin-leave-paper-issuer"]}>{attachment.issuedBy ?? request.staffName}</p>
              <h3 className={styles["admin-leave-paper-title"]}>{attachment.label}</h3>
              <dl className={styles["admin-leave-paper-details"]}>
                <dt>Name</dt>
                <dd>{request.staffName}</dd>
                <dt>Dates</dt>
                <dd>{datesText(request)}</dd>
                <dt>Details</dt>
                <dd>{request.reason}</dd>
              </dl>
              <p className={styles["admin-leave-paper-sign"]}>Signature & stamp</p>
            </div>
            <p className={styles["admin-leave-document-note"]}>Sample preview. No file was uploaded with this request.</p>
          </>
        )}
      </div>
    </div>
  );
}

function LeaveDocumentFile({ fileLink, fileName }: { fileLink: string | null | undefined; fileName: string }) {
  if (fileLink === undefined) return <p className={styles["admin-leave-document-note"]}>Opening the document…</p>;
  if (fileLink === null) return <p className={styles["admin-leave-document-note"]}>The document couldn&apos;t be opened. Close this and try again.</p>;
  return (
    <>
      {/\.pdf$/i.test(fileName) ? (
        <iframe src={fileLink} title={fileName} className={styles["admin-leave-file-frame"]} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a private file behind a short-lived link, not a site image
        <img src={fileLink} alt={fileName} className={styles["admin-leave-file-picture"]} />
      )}
      <a href={fileLink} target="_blank" rel="noreferrer" className={styles["admin-leave-file-link"]}>
        Open in a new tab
      </a>
    </>
  );
}
