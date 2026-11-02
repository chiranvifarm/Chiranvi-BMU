"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AccountPageHeading } from "../account-dashboard-layout";
import { useAccountProfile } from "../account-profile";
import { logOut, useLoggedInMobileNumber } from "@/components/login/login-status";
import {
  cancelAccountDeletionRequest,
  checkAccountDelete,
  deleteMyAccount,
  requestAccountDeletion,
  saveCustomerProfile,
  useIsCustomerProfileKnown,
  type CustomerProfile,
  type CustomerProfileDetails,
} from "@/store/customer-profiles-store";
import { useOrders, type Order } from "@/store/orders-store";
import { addProductToCart, useCartItems, useCartSubscription } from "@/store/cart-store";
import BengaluruAreaPicker, { OTHER_AREA, PincodeCheckNote, areaChoiceFor, otherAreaTextFor, pincodeForArea } from "@/components/area-picker/bengaluru-area-picker";
import styles from "./profile-details-page.module.css";

/*
  "My Profile" dashboard page (design): welcome banner, the personal details form and the notification
  switches. A new customer lands here after logging in: until they save, a note asks them to fill in
  their details (needed for smooth ordering and delivery). Required: first and last name, email,
  primary address, location and pincode (picking a location fills in its pincode; "Others" opens a box
  to type the location, which is what gets saved). The secondary
  mobile and address, and "More about you", are optional. The primary mobile is the login number.
  Saving keeps the details in this browser (store/customer-profiles-store.ts) and gives the customer
  a Customer ID; they then show on the Chiranvi Panel's Customers page.
  The banner numbers and the switches are placeholders from the design.
  "Delete account" (beside Edit details) deletes the account for good, after a confirmation; see
  DeleteAccountButton below for when it is refused.
*/

type ProfileForm = Omit<CustomerProfileDetails, "primaryMobile">;

const emptyForm: ProfileForm = {
  firstName: "",
  lastName: "",
  secondaryMobile: "",
  email: "",
  primaryAddress: "",
  secondaryAddress: "",
  location: "",
  pincode: "",
  dateOfBirth: "",
  familySize: "",
  preferredPlanType: "",
};

// Grey example text in the empty fields
const fieldExamples = {
  firstName: "Priya",
  lastName: "Sharma",
  secondaryMobile: "Optional, e.g. 98450 67890",
  email: "priya.sharma@example.com",
  primaryAddress: "House / flat no., street, landmark",
  secondaryAddress: "Optional: office or another home",
  pincode: "560011",
  dateOfBirth: "14 / 08 / 1992",
};

const familySizeOptions = ["1 – 2 members", "3 – 4 members", "5 – 6 members", "7+ members"];
const planTypeOptions = ["Daily", "Weekly", "Monthly"];

const notificationSettings = [
  {
    id: "delivery-updates",
    title: "Delivery updates on WhatsApp",
    description: "Get a message when your milk is at the door.",
    isOnAtStart: true,
  },
  {
    id: "low-wallet-balance",
    title: "Low wallet balance alerts",
    description: "We remind you before your subscription pauses.",
    isOnAtStart: true,
  },
  {
    id: "offers-and-new-products",
    title: "Offers and new products",
    description: "At most one message a week.",
    isOnAtStart: false,
  },
];

const welcomeBannerNumbers = [
  { value: "24", label: "Orders" },
  { value: "186 L", label: "Milk delivered" },
  { value: "₹1,240", label: "Saved" },
];

// The form starts from the saved details (empty for a new customer)
function toForm(profile: CustomerProfile | null): ProfileForm {
  if (!profile) return emptyForm;
  return Object.fromEntries(Object.keys(emptyForm).map((field) => [field, profile[field as keyof ProfileForm] ?? ""])) as ProfileForm;
}

export default function ProfileDetailsPage() {
  const accountProfile = useAccountProfile();
  const savedProfile = accountProfile.savedProfile;
  // The saved details come from the database: "Please fill in" waits until they have been read
  const isProfileKnown = useIsCustomerProfileKnown(useLoggedInMobileNumber());
  const [isSavedMessageShown, setIsSavedMessageShown] = useState(false);
  const [switchedOnNotifications, setSwitchedOnNotifications] = useState(
    () => new Set(notificationSettings.filter((setting) => setting.isOnAtStart).map((setting) => setting.id)),
  );

  const firstName = accountProfile.fullName.trim().split(/\s+/)[0] ?? "";
  const memberSince = savedProfile
    ? new Date(savedProfile.createdAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : "";

  function toggleNotification(settingId: string) {
    setSwitchedOnNotifications((previousSettings) => {
      const newSettings = new Set(previousSettings);
      if (newSettings.has(settingId)) newSettings.delete(settingId);
      else newSettings.add(settingId);
      return newSettings;
    });
  }

  return (
    <>
      <AccountPageHeading title="My Profile" description="Your details, used for delivery and order updates." />

      {/* A new customer who has not saved their details yet */}
      {isProfileKnown && !savedProfile && (
        <p className={styles["profile-required-notice"]} role="status">
          <strong>Please fill in your details below.</strong> They are important for a smooth experience when you buy and
          for getting your deliveries right.
        </p>
      )}

      <section className={styles["profile-welcome-banner"]} aria-label="Your account summary">
        <span className={styles["profile-welcome-banner-ring"]} aria-hidden="true" />
        <span className={styles["profile-welcome-banner-circle"]} aria-hidden="true" />
        <div className={styles["profile-welcome-banner-text"]}>
          <h2 className={styles["profile-welcome-heading"]}>
            {savedProfile ? "Welcome back, " : "Welcome, "}
            <span className={styles["profile-welcome-name"]}>{firstName}</span>
          </h2>
          <p className={styles["profile-welcome-member-details"]}>
            {savedProfile
              ? `Member since ${memberSince} · Customer ID ${savedProfile.customerId}`
              : "Save your details to get your Customer ID"}
          </p>
        </div>
        <dl className={styles["profile-welcome-numbers"]}>
          {welcomeBannerNumbers.map((bannerNumber) => (
            <div key={bannerNumber.label} className={styles["profile-welcome-number"]}>
              <dt className={styles["profile-welcome-number-label"]}>{bannerNumber.label}</dt>
              <dd className={styles["profile-welcome-number-value"]}>{bannerNumber.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Starts again from the saved details whenever they change (also once they load after a refresh) */}
      <PersonalDetailsForm
        key={savedProfile?.updatedAt ?? "new"}
        primaryMobileNumber={accountProfile.mobileNumber}
        savedProfile={savedProfile}
        isSavedMessageShown={isSavedMessageShown}
        onSaved={() => setIsSavedMessageShown(true)}
        onEdited={() => setIsSavedMessageShown(false)}
      />

      <OrderHistory />

      <section className={styles["profile-card"]} aria-labelledby="profile-notifications-heading">
        <h2 id="profile-notifications-heading" className={styles["profile-card-heading"]}>
          Notifications
        </h2>
        <ul className={styles["profile-notification-list"]}>
          {notificationSettings.map((setting) => {
            const isSwitchedOn = switchedOnNotifications.has(setting.id);
            return (
              <li key={setting.id} className={styles["profile-notification-row"]}>
                <div>
                  <p className={styles["profile-notification-title"]}>{setting.title}</p>
                  <p className={styles["profile-notification-description"]}>{setting.description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isSwitchedOn}
                  aria-label={setting.title}
                  className={`${styles["profile-notification-switch"]} ${
                    isSwitchedOn ? styles["profile-notification-switch-on"] : ""
                  }`}
                  onClick={() => toggleNotification(setting.id)}
                >
                  <span className={styles["profile-notification-switch-knob"]} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

/*
  Order history: the customer's delivered orders (kept with their account, so the Chiranvi Panel sees the
  same list on their Customers details), newest first, each with "Order again" (the same products and
  quantities go into the cart, which opens). Shown once there is at least one delivered order.
*/
function OrderHistory() {
  const orders = useOrders();
  const router = useRouter();
  const deliveredOrders = orders.filter((order) => order.status === "delivered");
  if (deliveredOrders.length === 0) return null;

  function orderAgain(order: Order) {
    for (const orderItem of order.items) {
      const { quantity, ...product } = orderItem;
      for (let packNumber = 0; packNumber < quantity; packNumber += 1) addProductToCart(product);
    }
    router.push("/cart");
  }

  const formatDay = (time: number) => new Date(time).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  return (
    <section className={styles["profile-card"]} aria-labelledby="profile-order-history-heading">
      <div className={styles["profile-order-history-heading-row"]}>
        <h2 id="profile-order-history-heading" className={styles["profile-card-heading"]}>
          Order history
        </h2>
        <Link href="/account/orders" className={styles["profile-order-history-all-link"]}>
          View all orders
        </Link>
      </div>
      <ul className={styles["profile-order-history-list"]}>
        {deliveredOrders.map((order) => (
          <li key={order.orderId} className={styles["profile-order-history-row"]}>
            <span className={styles["profile-order-history-pictures"]} aria-hidden="true">
              {order.items.slice(0, 3).map((item) => (
                <span key={item.productId} className={styles["profile-order-history-picture"]}>
                  <Image src={item.imageSource} alt="" width={item.imageWidth} height={item.imageHeight} sizes="40px" />
                </span>
              ))}
            </span>
            <span className={styles["profile-order-history-text"]}>
              <strong>{order.items.map((item) => (item.quantity > 1 ? `${item.name} × ${item.quantity}` : item.name)).join(", ")}</strong>
              <span>
                Order {order.orderId} · Delivered {formatDay(order.statusChangedAt?.delivered ?? order.promisedAt ?? order.placedAt)}
              </span>
            </span>
            <span className={styles["profile-order-history-amount"]}>₹{order.total.toLocaleString("en-IN")}</span>
            <button type="button" className={styles["profile-order-again-button"]} onClick={() => orderAgain(order)}>
              Order again
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PersonalDetailsForm({
  primaryMobileNumber,
  savedProfile,
  isSavedMessageShown,
  onSaved,
  onEdited,
}: {
  primaryMobileNumber: string; // "+91 98450 12345"
  savedProfile: CustomerProfile | null;
  isSavedMessageShown: boolean;
  onSaved: () => void;
  onEdited: () => void;
}) {
  const [formValues, setFormValues] = useState<ProfileForm>(() => toForm(savedProfile));
  // Saved details are shown locked, with "Edit details"; a new customer starts with the form open
  const [isEditing, setIsEditing] = useState(!savedProfile);
  // After a Save with missing details, the list (and the red boxes) update as each one is filled in
  const [hasTriedSaving, setHasTriedSaving] = useState(false);
  // The date box shows its example text until clicked, then becomes a date picker.
  const [isDateFieldFocused, setIsDateFieldFocused] = useState(false);
  const primaryMobileDigits = primaryMobileNumber.replace(/\D/g, "").slice(-10);
  // The Location box: a listed area, "Others" (then formValues.location is the typed text) or nothing yet
  const [locationChoice, setLocationChoice] = useState(() => areaChoiceFor(savedProfile?.location ?? ""));

  function updateFormValue(field: keyof ProfileForm, value: string) {
    setFormValues((previousValues) => ({ ...previousValues, [field]: value }));
    onEdited();
  }

  // Picking a location fills in its pincode (Others: the typed location and an empty pincode, to fill in)
  function chooseLocation(locationName: string) {
    setLocationChoice(locationName);
    setFormValues((previousValues) =>
      locationName === OTHER_AREA
        ? { ...previousValues, location: otherAreaTextFor(previousValues.location), pincode: "" }
        : { ...previousValues, location: locationName, pincode: pincodeForArea(locationName) },
    );
    onEdited();
  }

  const trimmed = Object.fromEntries(Object.entries(formValues).map(([field, value]) => [field, value.trim()])) as ProfileForm;
  const missingDetails: string[] = [];
  if (!trimmed.firstName) missingDetails.push("First name");
  if (!trimmed.lastName) missingDetails.push("Last name");
  if (trimmed.secondaryMobile && trimmed.secondaryMobile.length !== 10) missingDetails.push("Secondary mobile number: 10 digits (or leave it empty)");
  if (trimmed.secondaryMobile && trimmed.secondaryMobile === primaryMobileDigits) missingDetails.push("Secondary mobile number: a different number from your primary one");
  if (!/^\S+@\S+\.\S+$/.test(trimmed.email)) missingDetails.push("A valid email");
  if (!trimmed.primaryAddress) missingDetails.push("Primary address");
  if (!trimmed.location) missingDetails.push("Location");
  if (!/^\d{6}$/.test(trimmed.pincode)) missingDetails.push("Pincode: 6 digits");
  const problems = hasTriedSaving ? missingDetails : [];

  function saveChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasTriedSaving(true);
    if (missingDetails.length > 0) return;
    saveCustomerProfile({ ...trimmed, primaryMobile: primaryMobileDigits });
    onSaved();
    setIsEditing(false);
  }

  function startEditing() {
    setIsEditing(true);
    onEdited();
  }

  // Cancel: back to the saved details, locked again
  function cancelEditing() {
    setFormValues(toForm(savedProfile));
    setLocationChoice(areaChoiceFor(savedProfile?.location ?? ""));
    setHasTriedSaving(false);
    setIsEditing(false);
  }

  const isMissing = (field: string) => problems.some((problem) => problem.startsWith(field));
  const inputClassName = (field: string) => `${styles["profile-form-input"]} ${isMissing(field) ? styles["profile-form-input-missing"] : ""}`;
  const selectClassName = (isEmpty: boolean, field = "") =>
    `${inputClassName(field)} ${styles["profile-form-select"]} ${isEmpty ? styles["profile-form-select-empty"] : ""}`;

  return (
    <form className={styles["profile-card"]} onSubmit={saveChanges} noValidate>
      <h2 className={styles["profile-card-heading"]}>Personal details</h2>

      {problems.length > 0 && (
        <div className={styles["profile-form-problems"]} role="alert">
          <strong>Please fill in:</strong>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Locked (shown, not editable) until "Edit details" is pressed */}
      <fieldset className={styles["profile-form-fieldset"]} disabled={!isEditing}>
      <div className={styles["profile-form-grid"]}>
        <label className={styles["profile-form-field"]}>
          <span className={styles["profile-form-label"]}>First name *</span>
          <input
            className={inputClassName("First name")}
            value={formValues.firstName}
            autoComplete="given-name"
            placeholder={fieldExamples.firstName}
            onChange={(event) => updateFormValue("firstName", event.target.value)}
          />
        </label>
        <label className={styles["profile-form-field"]}>
          <span className={styles["profile-form-label"]}>Last name *</span>
          <input
            className={inputClassName("Last name")}
            value={formValues.lastName}
            autoComplete="family-name"
            placeholder={fieldExamples.lastName}
            onChange={(event) => updateFormValue("lastName", event.target.value)}
          />
        </label>
        <label className={styles["profile-form-field"]}>
          <span className={styles["profile-form-label"]}>Primary mobile number</span>
          {/* The number used to log in: shown, not editable (changing it would change the account) */}
          <input className={styles["profile-form-input"]} type="tel" value={primaryMobileNumber} readOnly title="This is the number you log in with" />
        </label>
        <label className={styles["profile-form-field"]}>
          <span className={styles["profile-form-label"]}>Secondary mobile number</span>
          <input
            className={inputClassName("Secondary mobile number")}
            type="tel"
            inputMode="numeric"
            value={formValues.secondaryMobile}
            placeholder={fieldExamples.secondaryMobile}
            onChange={(event) => updateFormValue("secondaryMobile", event.target.value.replace(/\D/g, "").slice(0, 10))}
          />
        </label>
        <label className={`${styles["profile-form-field"]} ${styles["profile-form-field-wide"]}`}>
          <span className={styles["profile-form-label"]}>Email *</span>
          <input
            className={inputClassName("A valid email")}
            type="email"
            value={formValues.email}
            autoComplete="email"
            placeholder={fieldExamples.email}
            onChange={(event) => updateFormValue("email", event.target.value)}
          />
        </label>
        <label className={`${styles["profile-form-field"]} ${styles["profile-form-field-wide"]}`}>
          <span className={styles["profile-form-label"]}>Primary address *</span>
          <input
            className={inputClassName("Primary address")}
            value={formValues.primaryAddress}
            autoComplete="street-address"
            placeholder={fieldExamples.primaryAddress}
            onChange={(event) => updateFormValue("primaryAddress", event.target.value)}
          />
        </label>
        <label className={`${styles["profile-form-field"]} ${styles["profile-form-field-wide"]}`}>
          <span className={styles["profile-form-label"]}>Secondary address</span>
          <input
            className={styles["profile-form-input"]}
            value={formValues.secondaryAddress}
            placeholder={fieldExamples.secondaryAddress}
            onChange={(event) => updateFormValue("secondaryAddress", event.target.value)}
          />
        </label>
        <div className={styles["profile-form-field"]}>
          <span id="profile-form-location-label" className={styles["profile-form-label"]}>
            Location *
          </span>
          <BengaluruAreaPicker
            area={locationChoice}
            onChoose={chooseLocation}
            labelId="profile-form-location-label"
            look="account"
            hasError={isMissing("Location") && !locationChoice}
            isDisabled={!isEditing}
            className={styles["profile-form-area-picker"]}
          />
        </div>
        <label className={styles["profile-form-field"]}>
          <span className={styles["profile-form-label"]}>Pincode *</span>
          <input
            className={inputClassName("Pincode")}
            inputMode="numeric"
            value={formValues.pincode}
            autoComplete="postal-code"
            placeholder={fieldExamples.pincode}
            onChange={(event) => updateFormValue("pincode", event.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          {/* Filled from a listed area: ask the customer to check it (while editing) */}
          {isEditing && pincodeForArea(locationChoice) && <PincodeCheckNote look="account" />}
        </label>
        {/* "Others": the location in the customer's own words */}
        {locationChoice === OTHER_AREA && (
          <label className={`${styles["profile-form-field"]} ${styles["profile-form-field-wide"]}`}>
            <span className={styles["profile-form-label"]}>Your location *</span>
            <input
              className={inputClassName("Location")}
              value={formValues.location}
              placeholder="Area or landmark"
              onChange={(event) => updateFormValue("location", event.target.value)}
            />
          </label>
        )}
      </div>

      {/* Optional extras */}
      <h3 className={styles["profile-form-subheading"]}>More about you (optional)</h3>
      <div className={styles["profile-form-grid"]}>
        <label className={styles["profile-form-field"]}>
          <span className={styles["profile-form-label"]}>Date of birth</span>
          <input
            className={styles["profile-form-input"]}
            type={isDateFieldFocused || formValues.dateOfBirth ? "date" : "text"}
            value={formValues.dateOfBirth}
            placeholder={fieldExamples.dateOfBirth}
            onFocus={() => setIsDateFieldFocused(true)}
            onBlur={() => setIsDateFieldFocused(false)}
            onChange={(event) => updateFormValue("dateOfBirth", event.target.value)}
          />
        </label>
        <label className={styles["profile-form-field"]}>
          <span className={styles["profile-form-label"]}>Family size</span>
          <select className={selectClassName(!formValues.familySize)} value={formValues.familySize} onChange={(event) => updateFormValue("familySize", event.target.value)}>
            <option value="" disabled hidden>
              3 – 4 members
            </option>
            {familySizeOptions.map((familySize) => (
              <option key={familySize}>{familySize}</option>
            ))}
          </select>
        </label>
        <label className={styles["profile-form-field"]}>
          <span className={styles["profile-form-label"]}>Preferred plan type</span>
          <select
            className={selectClassName(!formValues.preferredPlanType)}
            value={formValues.preferredPlanType}
            onChange={(event) => updateFormValue("preferredPlanType", event.target.value)}
          >
            <option value="" disabled hidden>
              Weekly
            </option>
            {planTypeOptions.map((planType) => (
              <option key={planType}>{planType}</option>
            ))}
          </select>
        </label>
      </div>
      </fieldset>

      <div className={styles["profile-form-actions"]}>
        {isSavedMessageShown && !isEditing && (
          <p className={styles["profile-form-saved-message"]} role="status">
            Changes saved
          </p>
        )}
        {!isEditing ? (
          <>
            <DeleteAccountButton mobileNumber={primaryMobileDigits} />
            {/* Saved details: unlock them to change anything */}
            <button type="button" className={styles["profile-save-button"]} onClick={startEditing}>
              Edit details
            </button>
          </>
        ) : (
          <>
            {savedProfile && (
              <button type="button" className={styles["profile-cancel-button"]} onClick={cancelEditing}>
                Cancel
              </button>
            )}
            <button type="submit" className={styles["profile-save-button"]}>
              {savedProfile ? "Save changes" : "Save details"}
            </button>
          </>
        )}
      </div>
    </form>
  );
}

/*
  "Delete account": opens a pop-up, which first asks the database what stops it (my_account_delete_check):
  - the owner: can't delete (ownership is transferred first);
  - another team member (admin, manager, staff, delivery agent), even with an empty cart: can't delete;
    "Request" asks the admin, who sees it on Roles & permissions (already asked: says so, with
    "Cancel request" to take it back);
  - a customer with something in the cart, an order not delivered or a milk plan running: what to do first;
  - otherwise "Are you sure?" with No (focused) / Yes; Yes deletes the account for good (profile,
    addresses, login; past orders stay for the sales records), logs out and goes to the home page.
  Escape or the dimmed page close it.
*/
type DeleteStep =
  | { step: "checking" }
  | { step: "could-not-check" }
  | { step: "owner" }
  | { step: "team"; roleName: string }
  | { step: "requested"; isNew: boolean }
  | { step: "request-cancelled" }
  | { step: "wait"; reasons: string[] }
  | { step: "confirm" };

function DeleteAccountButton({ mobileNumber }: { mobileNumber: string }) {
  const router = useRouter();
  const cartItems = useCartItems();
  const cartSubscription = useCartSubscription();
  const [deleteStep, setDeleteStep] = useState<DeleteStep | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function openDeletePopup() {
    setProblem("");
    setDeleteStep({ step: "checking" });
    const check = await checkAccountDelete();
    if (!check) setDeleteStep({ step: "could-not-check" });
    else if (check.isOwner) setDeleteStep({ step: "owner" });
    else if (check.teamRole) {
      setDeleteStep(check.deleteRequestedAt ? { step: "requested", isNew: false } : { step: "team", roleName: check.teamRole.toLowerCase() });
    } else {
      const reasons = [
        ...(cartItems.length > 0 || cartSubscription ? ["Empty your cart"] : []),
        ...(check.hasUndeliveredOrder ? ["Wait for your products to be delivered"] : []),
        ...(check.hasRunningPlan ? ["Wait for your subscription to complete"] : []),
      ];
      setDeleteStep(reasons.length > 0 ? { step: "wait", reasons } : { step: "confirm" });
    }
  }

  async function sendRequest() {
    setIsBusy(true);
    const requestProblem = await requestAccountDeletion();
    setIsBusy(false);
    if (requestProblem) setProblem(requestProblem);
    else setDeleteStep({ step: "requested", isNew: true });
  }

  async function cancelRequest() {
    setIsBusy(true);
    const cancelProblem = await cancelAccountDeletionRequest();
    setIsBusy(false);
    if (cancelProblem) setProblem(cancelProblem);
    else {
      setProblem("");
      setDeleteStep({ step: "request-cancelled" });
    }
  }

  async function deleteTheAccount() {
    setIsBusy(true);
    const deleteProblem = await deleteMyAccount(mobileNumber);
    setIsBusy(false);
    if (deleteProblem) {
      setProblem(deleteProblem);
      return;
    }
    logOut();
    router.push("/");
  }

  return (
    <>
      <button type="button" className={styles["profile-delete-account-button"]} onClick={() => void openDeletePopup()}>
        Delete account
      </button>
      {deleteStep && (
        <DeleteAccountDialog
          deleteStep={deleteStep}
          isBusy={isBusy}
          problem={problem}
          onClose={() => setDeleteStep(null)}
          onRequest={() => void sendRequest()}
          onCancelRequest={() => void cancelRequest()}
          onDelete={() => void deleteTheAccount()}
        />
      )}
    </>
  );
}

// "a manager", "an admin"
function withArticle(roleName: string) {
  return `${/^[aeiou]/.test(roleName) ? "an" : "a"} ${roleName}`;
}

// The pop-up's heading and line for each step
function deleteStepWords(deleteStep: DeleteStep) {
  switch (deleteStep.step) {
    case "checking":
      return { heading: "Delete account", text: "Checking your account…" };
    case "could-not-check":
      return { heading: "Delete account", text: "Couldn't check your account. Check your internet and try again." };
    case "owner":
      return { heading: "You can't delete your account", text: "You're the owner. Transfer the ownership first." };
    case "team":
      return { heading: "You can't delete your account", text: `You're ${withArticle(deleteStep.roleName)}. Request the admin to delete it.` };
    case "requested":
      return { heading: deleteStep.isNew ? "Request sent" : "Request already sent", text: "The admin will delete your account." };
    case "request-cancelled":
      return { heading: "Request cancelled", text: "Your account stays as it is." };
    case "wait":
      return { heading: "You can't delete your account yet", text: "First:" };
    case "confirm":
      return { heading: "Are you sure?", text: "You are deleting your account permanently. This can't be undone." };
  }
}

function DeleteAccountDialog({
  deleteStep,
  isBusy,
  problem,
  onClose,
  onRequest,
  onCancelRequest,
  onDelete,
}: {
  deleteStep: DeleteStep;
  isBusy: boolean;
  problem: string;
  onClose: () => void;
  onRequest: () => void;
  onCancelRequest: () => void;
  onDelete: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Latest onClose, so the Escape listener below is set up only once
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Escape closes the box; the safe button (No / Close / OK) is focused first
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, [deleteStep.step]);

  const { heading, text } = deleteStepWords(deleteStep);
  const hasTwoButtons = deleteStep.step === "confirm" || deleteStep.step === "team" || deleteStep.step === "requested";
  const closeLabel = deleteStep.step === "confirm" ? "No" : deleteStep.step === "team" ? "Close" : "OK";

  return (
    <div className={styles["profile-delete-dialog-overlay"]} data-lenis-prevent>
      <button type="button" aria-label="Close" className={styles["profile-delete-dialog-dimmed-page"]} onClick={onClose} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="profile-delete-dialog-heading"
        aria-describedby="profile-delete-dialog-description"
        className={styles["profile-delete-dialog"]}
      >
        <span className={styles["profile-delete-dialog-icon-circle"]} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />
          </svg>
        </span>
        <h2 id="profile-delete-dialog-heading" className={styles["profile-delete-dialog-heading"]}>
          {heading}
        </h2>
        <p id="profile-delete-dialog-description" className={styles["profile-delete-dialog-description"]}>
          {text}
        </p>
        {deleteStep.step === "wait" && (
          <ul className={styles["profile-delete-dialog-reasons"]}>
            {deleteStep.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
        {problem && (
          <p className={styles["profile-delete-dialog-problem"]} role="alert">
            {problem}
          </p>
        )}
        {deleteStep.step !== "checking" && (
          <div className={`${styles["profile-delete-dialog-buttons"]} ${hasTwoButtons ? "" : styles["profile-delete-dialog-buttons-single"]}`}>
            <button ref={closeButtonRef} type="button" className={styles["profile-delete-dialog-cancel-button"]} onClick={onClose}>
              {closeLabel}
            </button>
            {deleteStep.step === "team" && (
              <button type="button" className={styles["profile-delete-dialog-request-button"]} onClick={onRequest} disabled={isBusy}>
                {isBusy ? "Sending…" : "Request"}
              </button>
            )}
            {deleteStep.step === "requested" && (
              <button type="button" className={styles["profile-delete-dialog-cancel-request-button"]} onClick={onCancelRequest} disabled={isBusy}>
                {isBusy ? "Cancelling…" : "Cancel request"}
              </button>
            )}
            {deleteStep.step === "confirm" && (
              <button type="button" className={styles["profile-delete-dialog-confirm-button"]} onClick={onDelete} disabled={isBusy}>
                {isBusy ? "Deleting…" : "Yes"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
