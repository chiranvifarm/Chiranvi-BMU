"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AGENT_REQUEST_KINDS,
  NOT_DELIVERED_REASONS,
  STOP_STEPS,
  callLink,
  finishStop,
  formatTime,
  messageLink,
  navigationLink,
  raiseRequest,
  rupees,
  saveStopLocation,
  setStopStep,
  photoFromVideo,
  shrinkPhoto,
  type AgentRequestKind,
  type AgentStop,
  type StopOutcome,
  type StopProof,
} from "@/store/delivery-agent-store";
import {
  DeliveryNotice,
  DeliveryPageHeading,
  DeliverySheet,
  DeliveryShiftNotices,
  deliveryButtonStyles,
  useDeliveryPanel,
} from "./delivery-panel-layout";
import styles from "./delivery-ongoing-page.module.css";

/*
  Deliveries → Ongoing (/delivery): the stops the agent is on now, one-time orders on the left and
  subscriptions (daily milk) on the right. Each column has its own stop:
  - The customer: name, phone, address, landmark, gate code; Call and Message; Navigate (Google Maps:
    the address's exact pin when it has one, else the address text); "Save this spot as the customer's
    location" at the gate.
  - What to hand over (products and quantities), empty bottles to collect, cash to collect, the customer's note.
  - Steps: Picked up → Delivered (a button for Picked up; the Finish buttons do the rest).
  - Finish: Delivered (proof: the customer's OTP or a photo), Left at door (photo), Not delivered (reason).
    The photo comes from the live camera or an upload (ProofCamera).
    The stop then moves to Completed and the next stop of that kind comes into its column.
  - Raise a request to the manager (customer unavailable, wrong address, damaged product, missing item,
    reschedule, other); the stop's requests are listed with their status.
  Off duty: everything shows, but nothing can be changed until the agent goes on duty.
*/

type OpenSheet = { kind: "finish"; outcome: StopOutcome } | { kind: "request" } | null;

// Further than this from the spot (the phone's own estimate): not saved, the agent tries again
const ROUGH_SPOT_METRES = 50;

type SpotState = { step: "idle" } | { step: "finding" } | { step: "saved" } | { step: "failed"; message: string };

/*
  At the gate: the agent's GPS becomes the customer's location. The database changes only the pin (on the
  stop, its order and the customer's address), so the next delivery here, by anyone, goes straight to the gate.
*/
function SaveStopSpot({ stop, canWork }: { stop: AgentStop; canWork: boolean }) {
  const [spotState, setSpotState] = useState<SpotState>({ step: "idle" });

  function saveSpot() {
    if (!("geolocation" in navigator)) {
      setSpotState({ step: "failed", message: "This phone can't share its location." });
      return;
    }
    setSpotState({ step: "finding" });
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (position.coords.accuracy > ROUGH_SPOT_METRES) {
          setSpotState({
            step: "failed",
            message: `Not exact enough yet (about ${Math.round(position.coords.accuracy)} m). Wait a few seconds in the open and try again.`,
          });
          return;
        }
        const problem = await saveStopLocation(stop.id, { latitude: position.coords.latitude, longitude: position.coords.longitude });
        setSpotState(problem ? { step: "failed", message: problem } : { step: "saved" });
      },
      (problem) => {
        setSpotState({
          step: "failed",
          message:
            problem.code === problem.PERMISSION_DENIED
              ? "Location is blocked. Allow location for this website in your phone's settings."
              : "Couldn't find your location. Try again in the open.",
        });
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  return (
    <div className={styles["ongoing-location"]}>
      <p className={styles["ongoing-location-text"]}>
        {stop.hasExactPin ? "Exact location saved: Maps goes to the gate." : "No exact location yet: Maps searches the address."}
      </p>
      <button
        type="button"
        className={`${deliveryButtonStyles.outlined} ${deliveryButtonStyles.small}`}
        disabled={!canWork || spotState.step === "finding"}
        onClick={saveSpot}
      >
        {spotState.step === "finding" ? "Finding your location…" : "Save this spot as the customer's location"}
      </button>
      {spotState.step === "saved" && (
        <p role="status" className={styles["ongoing-location-saved"]}>
          Saved. The next delivery here goes straight to this spot.
        </p>
      )}
      {spotState.step === "failed" && (
        <p role="alert" className={styles["ongoing-form-error"]}>
          {spotState.message}
        </p>
      )}
    </div>
  );
}

export default function DeliveryOngoingPage() {
  const { login, stops } = useDeliveryPanel();

  return (
    <>
      <DeliveryPageHeading
        title="Ongoing"
        description="The stops you're on now. Finish one to move on: the next one comes here by itself."
      />
      <DeliveryShiftNotices />

      {login.route && stops.ongoing.length === 0 && (
        <DeliveryNotice title="All stops done for today" text="Well done! Every stop on your list is finished.">
          <Link href="/delivery/completed" className={deliveryButtonStyles.filled}>
            See completed stops
          </Link>
        </DeliveryNotice>
      )}

      {stops.ongoing.length > 0 && (
        <div className={styles["ongoing-columns"]}>
          <OngoingColumn columnId="one-time" title="One-time orders" emptyText="No one-time orders left today." isSubscription={false} />
          <OngoingColumn columnId="subscription" title="Subscriptions" emptyText="No subscription deliveries left today." isSubscription />
        </div>
      )}
    </>
  );
}

// One kind of stop: its ongoing stop's customer, what to hand over and status
function OngoingColumn({
  columnId,
  title,
  emptyText,
  isSubscription,
}: {
  columnId: string;
  title: string;
  emptyText: string;
  isSubscription: boolean;
}) {
  const { login, stops } = useDeliveryPanel();
  const [openSheet, setOpenSheet] = useState<OpenSheet>(null);
  const stop = stops.ongoing.find((ongoingStop) => ongoingStop.isSubscription === isSubscription);
  const finishedHere = stops.completed.filter((finished) => finished.isSubscription === isSubscription).length;
  const totalHere = finishedHere + stops.upNext.filter((next) => next.isSubscription === isSubscription).length + (stop ? 1 : 0);
  const canWork = stops.isOnDuty;

  return (
    <div className={styles["ongoing-column"]}>
      <h2 className={styles["ongoing-column-title"]}>{title}</h2>
      {!stop && <p className={`${styles["ongoing-card"]} ${styles["ongoing-column-empty"]}`}>{emptyText}</p>}

      {stop && (
        <>
          {/* The customer and how to reach them */}
          <section className={styles["ongoing-card"]} aria-labelledby={`${columnId}-customer-name`}>
            <div className={styles["ongoing-stop-tags"]}>
              <span className={styles["ongoing-stop-number"]}>
                Stop {finishedHere + 1} of {totalHere}
              </span>
              <span className={styles["ongoing-slot"]}>{stop.slot}</span>
              {stop.changedByDispatch && <span className={styles["ongoing-dispatch-tag"]}>Changed by dispatch</span>}
            </div>
            <h3 id={`${columnId}-customer-name`} className={styles["ongoing-customer-name"]}>
              {stop.customerName}
            </h3>
            <p className={styles["ongoing-customer-phone"]}>+91 {stop.phone}</p>

            <dl className={styles["ongoing-address-list"]}>
              <div>
                <dt>Address</dt>
                <dd>{/bengaluru/i.test(stop.address) ? stop.address : `${stop.address}, Bengaluru`}</dd>
              </div>
              {stop.landmark && (
                <div>
                  <dt>Landmark</dt>
                  <dd>{stop.landmark}</dd>
                </div>
              )}
              {stop.gateCode && (
                <div>
                  <dt>Gate code</dt>
                  <dd className={styles["ongoing-gate-code"]}>{stop.gateCode}</dd>
                </div>
              )}
            </dl>

            <div className={styles["ongoing-contact-buttons"]}>
              <a href={callLink(stop.phone)} className={styles["ongoing-contact-button"]}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
                </svg>
                Call
              </a>
              <a href={messageLink(stop.phone)} className={styles["ongoing-contact-button"]}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 5h16v11H8l-4 4V5Z" />
                </svg>
                Message
              </a>
            </div>
            <a href={navigationLink(stop)} target="_blank" rel="noreferrer" className={`${deliveryButtonStyles.filled} ${styles["ongoing-navigate-button"]}`}>
              <svg viewBox="0 0 24 24" aria-hidden="true" className={styles["ongoing-navigate-icon"]}>
                <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" />
                <path d="M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
              </svg>
              Navigate in Google Maps
            </a>
            {/* A new stop starts the location box again */}
            <SaveStopSpot key={stop.id} stop={stop} canWork={canWork} />
          </section>

          {/* What to hand over and collect */}
          <section className={styles["ongoing-card"]} aria-labelledby={`${columnId}-items-title`}>
            <h3 id={`${columnId}-items-title`} className={styles["ongoing-card-title"]}>
              Hand over
            </h3>
            <ul className={styles["ongoing-item-list"]}>
              {stop.items.map((item) => (
                <li key={`${item.name}-${item.packSize}`} className={styles["ongoing-item"]}>
                  <span>
                    <span className={styles["ongoing-item-name"]}>{item.name}</span>
                    <span className={styles["ongoing-item-pack"]}>{item.packSize}</span>
                  </span>
                  <span className={styles["ongoing-item-quantity"]}>× {item.quantity}</span>
                </li>
              ))}
            </ul>
            {stop.bottlesToCollect > 0 && (
              <div className={styles["ongoing-collect-row"]}>
                <span className={styles["ongoing-collect-label"]}>Empty bottles to collect</span>
                <span className={styles["ongoing-collect-value"]}>{stop.bottlesToCollect}</span>
              </div>
            )}
            {stop.cashToCollect > 0 && (
              <div className={styles["ongoing-collect-row"]}>
                <span className={styles["ongoing-collect-label"]}>Cash to collect</span>
                <span className={styles["ongoing-collect-value"]}>{rupees(stop.cashToCollect)}</span>
              </div>
            )}
            {stop.note && (
              <p className={styles["ongoing-note"]}>
                <span className={styles["ongoing-note-label"]}>Customer note</span>
                {stop.note}
              </p>
            )}
          </section>

          {/* Steps and finishing the stop */}
          <section className={`${styles["ongoing-card"]} ${styles["ongoing-card-status"]}`} aria-labelledby={`${columnId}-status-title`}>
            <h3 id={`${columnId}-status-title`} className={styles["ongoing-card-title"]}>
              Status
            </h3>
            <StatusSteps stop={stop} />
            <NextStepButton stop={stop} mobileNumber={login.mobileNumber} canWork={canWork} />

            <div className={styles["ongoing-finish-buttons"]}>
              <button
                type="button"
                className={deliveryButtonStyles.filled}
                disabled={!canWork}
                onClick={() => setOpenSheet({ kind: "finish", outcome: "delivered" })}
              >
                Mark as delivered
              </button>
              <button
                type="button"
                className={deliveryButtonStyles.outlined}
                disabled={!canWork}
                onClick={() => setOpenSheet({ kind: "finish", outcome: "left-at-door" })}
              >
                Left at door
              </button>
              <button
                type="button"
                className={deliveryButtonStyles.danger}
                disabled={!canWork}
                onClick={() => setOpenSheet({ kind: "finish", outcome: "not-delivered" })}
              >
                Not delivered
              </button>
            </div>

            <div className={styles["ongoing-request-row"]}>
              <p className={styles["ongoing-request-text"]}>A problem at this stop?</p>
              <div className={styles["ongoing-request-buttons"]}>
                <button
                  type="button"
                  className={`${deliveryButtonStyles.outlined} ${deliveryButtonStyles.small}`}
                  disabled={!canWork}
                  onClick={() => setOpenSheet({ kind: "request" })}
                >
                  Raise a request to the manager
                </button>
              </div>
            </div>
            {stop.requests.length > 0 && (
              <ul className={styles["ongoing-request-list"]}>
                {stop.requests.map((request) => (
                  <li key={request.id} className={styles["ongoing-request"]}>
                    <span>
                      <span className={styles["ongoing-request-kind"]}>{request.kind}</span>
                      {request.note && <span className={styles["ongoing-request-note"]}>{request.note}</span>}
                    </span>
                    <span
                      className={`${styles["ongoing-request-status"]} ${
                        request.status === "Resolved" ? styles["ongoing-request-status-resolved"] : ""
                      }`}
                    >
                      {request.status} · {formatTime(request.raisedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {stop && openSheet?.kind === "finish" && (
        <FinishStopSheet stop={stop} outcome={openSheet.outcome} mobileNumber={login.mobileNumber} onClose={() => setOpenSheet(null)} />
      )}
      {stop && openSheet?.kind === "request" && (
        <RequestSheet stop={stop} mobileNumber={login.mobileNumber} onClose={() => setOpenSheet(null)} />
      )}
    </div>
  );
}

// Picked up → Delivered, the reached ones ticked. Any saved step counts as picked up (stops started
// before On the way and Reached were removed keep theirs until the day ends)
function StatusSteps({ stop }: { stop: AgentStop }) {
  const reachedIndex = stop.step ? 0 : -1;
  const steps = [...STOP_STEPS.map((step) => step.label), "Delivered"];
  return (
    <ol className={styles["ongoing-steps"]}>
      {steps.map((label, index) => {
        const state = index <= reachedIndex ? "done" : index === reachedIndex + 1 ? "current" : "later";
        return (
          <li key={label} className={`${styles["ongoing-step"]} ${styles[`ongoing-step-${state}`]}`} aria-current={state === "current" ? "step" : undefined}>
            <span className={styles["ongoing-step-circle"]} aria-hidden="true">
              {state === "done" ? (
                <svg viewBox="0 0 24 24">
                  <path d="M6 12.5l4 4 8-8" />
                </svg>
              ) : (
                index + 1
              )}
            </span>
            <span className={styles["ongoing-step-label"]}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

// The button for Picked up (after it, the stop is finished with the buttons below)
function NextStepButton({ stop, mobileNumber, canWork }: { stop: AgentStop; mobileNumber: string; canWork: boolean }) {
  const nextStep = STOP_STEPS[0];
  if (stop.step) return <p className={styles["ongoing-step-hint"]}>Picked up. Finish the stop below.</p>;
  return (
    <button
      type="button"
      className={`${deliveryButtonStyles.outlined} ${styles["ongoing-next-step-button"]}`}
      disabled={!canWork}
      onClick={() => setStopStep(mobileNumber, stop.id, nextStep.key)}
    >
      Mark as {nextStep.label.toLowerCase()}
    </button>
  );
}

/*
  The proof photo: Open camera shows the live camera (the back one on a phone) and Take photo keeps the picture;
  Upload photo picks one from the phone or laptop. If the live camera won't open here (permission refused, or
  a browser without it), a note points to Upload photo.
*/
function ProofCamera({
  label,
  photo,
  onPhoto,
  onPhotoFile,
}: {
  label: string;
  photo: string;
  onPhoto: (photo: string) => void;
  onPhotoFile: (file: File | undefined) => void;
}) {
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isCameraBlocked, setIsCameraBlocked] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // Shows the camera; closing it (or the pop-up) switches the camera off
  useEffect(() => {
    if (!cameraStream) return;
    if (videoRef.current) videoRef.current.srcObject = cameraStream;
    return () => cameraStream.getTracks().forEach((track) => track.stop());
  }, [cameraStream]);

  async function openCamera() {
    try {
      setCameraStream(await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }));
      setIsCameraBlocked(false);
    } catch {
      setIsCameraBlocked(true);
    }
  }

  function keepPicture() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    onPhoto(photoFromVideo(video));
    setCameraStream(null);
  }

  return (
    <div className={styles["ongoing-field"]}>
      <span className={styles["ongoing-field-label"]}>{label}</span>
      {cameraStream ? (
        <>
          <video ref={videoRef} autoPlay playsInline muted className={styles["ongoing-photo-preview"]} />
          <div className={styles["ongoing-camera-buttons"]}>
            <button type="button" className={deliveryButtonStyles.filled} onClick={keepPicture}>
              Take photo
            </button>
            <button type="button" className={deliveryButtonStyles.outlined} onClick={() => setCameraStream(null)}>
              Close camera
            </button>
          </div>
        </>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- a photo just taken, not a site image */}
          {photo && <img src={photo} alt="The delivery" className={styles["ongoing-photo-preview"]} />}
          <div className={styles["ongoing-camera-buttons"]}>
            <button type="button" className={deliveryButtonStyles.outlined} onClick={() => void openCamera()}>
              {photo ? "Retake photo" : "Open camera"}
            </button>
            <button type="button" className={deliveryButtonStyles.outlined} onClick={() => uploadInputRef.current?.click()}>
              Upload photo
            </button>
          </div>
        </>
      )}
      <input
        ref={uploadInputRef}
        hidden
        type="file"
        accept="image/*"
        aria-label={label}
        onChange={(event) => {
          onPhotoFile(event.target.files?.[0]);
          // The same picture can be chosen again
          event.target.value = "";
        }}
      />
      {isCameraBlocked && !cameraStream && (
        <p className={styles["ongoing-camera-problem"]}>The camera couldn&apos;t open. Allow the camera for this site, or use Upload photo.</p>
      )}
    </div>
  );
}

/*
  Finishing the stop:
  - Delivered: proof by the customer's OTP (4 digits) or a photo; bottles and cash collected.
  - Left at door: a photo of what was left; bottles collected.
  - Not delivered: why.
*/
function FinishStopSheet({
  stop,
  outcome,
  mobileNumber,
  onClose,
}: {
  stop: AgentStop;
  outcome: StopOutcome;
  mobileNumber: string;
  onClose: () => void;
}) {
  const [proofKind, setProofKind] = useState<"otp" | "photo">(outcome === "left-at-door" ? "photo" : "otp");
  const [otp, setOtp] = useState("");
  const [photo, setPhoto] = useState("");
  const [bottlesCollected, setBottlesCollected] = useState(String(stop.bottlesToCollect));
  const [cashCollected, setCashCollected] = useState(String(stop.cashToCollect));
  const [reason, setReason] = useState(NOT_DELIVERED_REASONS[0]);
  const [error, setError] = useState("");
  const isNotDelivered = outcome === "not-delivered";

  async function takePhoto(file: File | undefined) {
    if (!file) return;
    try {
      setPhoto(await shrinkPhoto(file));
      setError("");
    } catch {
      setError("That photo couldn't be used. Please take it again.");
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (isNotDelivered) {
      finishStop(mobileNumber, stop.id, outcome, { notDeliveredReason: reason });
      onClose();
      return;
    }
    let proof: StopProof;
    if (proofKind === "otp") {
      if (!/^\d{4}$/.test(otp)) {
        setError("Enter the 4-digit OTP the customer reads out.");
        return;
      }
      proof = { kind: "otp", code: otp };
    } else {
      if (!photo) {
        setError("Take a photo of the delivery first.");
        return;
      }
      proof = { kind: "photo", photo };
    }
    finishStop(mobileNumber, stop.id, outcome, {
      proof,
      bottlesCollected: Math.max(0, Number(bottlesCollected) || 0),
      cashCollected: outcome === "delivered" ? Math.max(0, Number(cashCollected) || 0) : 0,
    });
    onClose();
  }

  const title = isNotDelivered ? "Not delivered" : outcome === "left-at-door" ? "Left at door" : "Mark as delivered";

  return (
    <DeliverySheet title={title} onClose={onClose}>
      <form onSubmit={submit} className={styles["ongoing-form"]}>
        <p className={styles["ongoing-form-stop"]}>
          {stop.customerName} · {stop.address}
        </p>

        {isNotDelivered ? (
          <label className={styles["ongoing-field"]}>
            <span className={styles["ongoing-field-label"]}>Why wasn&apos;t it delivered?</span>
            <select className={styles["ongoing-input"]} value={reason} onChange={(event) => setReason(event.target.value)}>
              {NOT_DELIVERED_REASONS.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
        ) : (
          <>
            {outcome === "delivered" && (
              <fieldset className={styles["ongoing-field"]}>
                <legend className={styles["ongoing-field-label"]}>Proof of delivery</legend>
                <div className={styles["ongoing-proof-options"]}>
                  {(["otp", "photo"] as const).map((kind) => (
                    <label
                      key={kind}
                      className={`${styles["ongoing-proof-option"]} ${proofKind === kind ? styles["ongoing-proof-option-chosen"] : ""}`}
                    >
                      <input type="radio" name="proof-kind" checked={proofKind === kind} onChange={() => setProofKind(kind)} />
                      {kind === "otp" ? "Customer's OTP" : "Photo"}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {/* Two different boxes (keys), so switching OTP ↔ photo doesn't reuse one input for the other */}
            {proofKind === "otp" && outcome === "delivered" ? (
              <label key="proof-otp" className={styles["ongoing-field"]}>
                <span className={styles["ongoing-field-label"]}>OTP from the customer</span>
                <input
                  className={styles["ongoing-input"]}
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="one-time-code"
                  placeholder="4 digits"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
                />
              </label>
            ) : (
              <ProofCamera
                key="proof-photo"
                label={outcome === "left-at-door" ? "Photo of what you left at the door" : "Photo of the delivery"}
                photo={photo}
                onPhoto={setPhoto}
                onPhotoFile={(file) => void takePhoto(file)}
              />
            )}
            <label className={styles["ongoing-field"]}>
              <span className={styles["ongoing-field-label"]}>Empty bottles collected</span>
              <input
                className={styles["ongoing-input"]}
                inputMode="numeric"
                value={bottlesCollected}
                onChange={(event) => setBottlesCollected(event.target.value.replace(/\D/g, ""))}
              />
            </label>
            {outcome === "delivered" && stop.cashToCollect > 0 && (
              <label className={styles["ongoing-field"]}>
                <span className={styles["ongoing-field-label"]}>Cash collected (₹)</span>
                <input
                  className={styles["ongoing-input"]}
                  inputMode="numeric"
                  value={cashCollected}
                  onChange={(event) => setCashCollected(event.target.value.replace(/\D/g, ""))}
                />
              </label>
            )}
          </>
        )}

        {error && (
          <p className={styles["ongoing-form-error"]} role="alert">
            {error}
          </p>
        )}
        <button type="submit" className={isNotDelivered ? deliveryButtonStyles.danger : deliveryButtonStyles.filled}>
          {isNotDelivered ? "Mark as not delivered" : "Finish this stop"}
        </button>
      </form>
    </DeliverySheet>
  );
}

// A request to the manager about this stop
function RequestSheet({ stop, mobileNumber, onClose }: { stop: AgentStop; mobileNumber: string; onClose: () => void }) {
  const [kind, setKind] = useState<AgentRequestKind>(AGENT_REQUEST_KINDS[0]);
  const [note, setNote] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    raiseRequest(mobileNumber, stop, kind, note);
    onClose();
  }

  return (
    <DeliverySheet title="Raise a request" onClose={onClose}>
      <form onSubmit={submit} className={styles["ongoing-form"]}>
        <p className={styles["ongoing-form-stop"]}>
          {stop.customerName} · {stop.address}
        </p>
        <label className={styles["ongoing-field"]}>
          <span className={styles["ongoing-field-label"]}>What&apos;s wrong?</span>
          <select className={styles["ongoing-input"]} value={kind} onChange={(event) => setKind(event.target.value as AgentRequestKind)}>
            {AGENT_REQUEST_KINDS.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className={styles["ongoing-field"]}>
          <span className={styles["ongoing-field-label"]}>Details for the manager</span>
          <textarea
            className={styles["ongoing-textarea"]}
            rows={3}
            placeholder="E.g. called twice, no answer"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <button type="submit" className={deliveryButtonStyles.filled}>
          Send to the manager
        </button>
      </form>
    </DeliverySheet>
  );
}
