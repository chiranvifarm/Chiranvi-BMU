"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import BengaluruAreaPicker, {
  BENGALURU_AREAS,
  OTHER_AREA,
  PincodeCheckNote,
  areaChoiceFor,
  otherAreaTextFor,
  pincodeForArea,
} from "@/components/area-picker/bengaluru-area-picker";
import { useLoggedInMobileNumber } from "@/components/login/login-status";
import type { SavedAddress } from "@/store/address-store";
import { useCustomerProfile } from "@/store/customer-profiles-store";
import styles from "./address-form-dialog.module.css";

/*
  Pop-up form to add a new address or edit one (opened from "Add new address" / "Edit" on My Addresses,
  and from the address step of the cart checkout).
  Fields: address name (Home / Work / Other), full name, mobile number, house / flat and street,
  area, city and pincode, plus "Make this my default address".
  Area: chosen from the Bengaluru list, which fills in its pincode (still editable); "Others" opens a box
  to type the area, which is what gets saved.
  Checks before saving: every field filled, a 10-digit mobile number and a 6-digit pincode.
  A new address asks first who it is for, and says the delivery agent will call its number. "It's mine": the
  name is the customer's own and locked; the number and address can be changed. "Someone else's": the form is
  open, for that person's name, number and address (not a name starting with the customer's first name; the
  last name alone is allowed, as family share it). The number goes on the orders sent here (the delivery
  contact), so the agent's stop and Order details show it. The Profile doesn't change, and neither does the login
  number (a new login number needs an OTP check, which comes with the backend). Editing an address doesn't ask;
  nor does asksProfileDetails, as that form is the customer's own details.
  The cart passes savedAddresses and onPickSaved: after the answer, the customer's saved addresses of that kind
  are listed to pick from, with Add new address for the form. An address with their own first name is theirs
  (repeated letters don't count, so "Prassanjith" and "Prasssanjith" are the same); any other name is someone
  else's. None of that kind yet: straight to the form.
  Cancel, the close button, Escape or a click on the dimmed page closes it without saving.
  asksProfileDetails (the cart, for a logged-in customer without a Profile): "Full name" becomes First name and
  Last name, and Email is asked too, so the address gives every detail the Profile needs; they go to onSave
  as profileDetails.
  "Use my current location" (needed to order): the phone's GPS gives the address's map pin, so the delivery agent's
  Google Maps goes to the gate. The phone asks the customer first; nothing is read without the tap. The spot is
  then looked up on OpenStreetMap (free, no key, anywhere in India) to fill in the street (only when that box is
  empty), area, city and pincode; the customer checks them and adds the house / flat number. A Bengaluru area
  on our list is chosen in the area box; any other place goes in as "Others" with its name.
*/

export type { SavedAddress };

const addressLabels = ["Home", "Work", "Other"];

type FormValues = Omit<SavedAddress, "id" | "isProfileAddress">;
// The fields typed in boxes (the pin comes from the phone's GPS)
type TextFieldName = Exclude<keyof FormValues, "pin" | "pinSavedBy">;
// The Profile's details asked with the address (asksProfileDetails)
type ProfileValues = { firstName: string; lastName: string; email: string };
// "Use my current location": idle, asking the phone, done (how exact, in metres, and whether the address boxes
// were filled from it), or why it didn't work
type PinState =
  | { step: "idle" }
  | { step: "finding" }
  | { step: "saved"; accuracyMetres: number; isAddressFilled: boolean }
  | { step: "failed"; message: string };
// Further than this from the gate: saved, but the customer is told it isn't very exact
const ROUGH_PIN_METRES = 100;

// India, roughly (the database refuses pins outside it)
function isInIndia(latitude: number, longitude: number) {
  return latitude >= 6 && latitude <= 37.5 && longitude >= 68 && longitude <= 97.5;
}

// The address boxes filled from a spot; listedArea: the Bengaluru area on our list it is in, if any
type AddressFromLocation = { houseAndStreet: string; area: string; city: string; pincode: string; listedArea: string | null };

// OpenStreetMap's free address lookup (no key; one lookup per tap is well within its limit of one a second)
const OPENSTREETMAP_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";

/*
  The address at a spot, anywhere in India, from OpenStreetMap. null: no answer (offline, slow, or nothing
  there). The parts OpenStreetMap has differ by place, so the first one present is taken for each box.
*/
async function lookUpAddress(latitude: number, longitude: number): Promise<AddressFromLocation | null> {
  const query = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    zoom: "18",
    "accept-language": "en",
    lat: String(latitude),
    lon: String(longitude),
  });
  const stopWaiting = new AbortController();
  const timer = window.setTimeout(() => stopWaiting.abort(), 8000);
  try {
    const response = await fetch(`${OPENSTREETMAP_REVERSE_URL}?${query}`, { signal: stopWaiting.signal });
    if (!response.ok) return null;
    const place = (await response.json()) as { address?: Record<string, string> };
    const parts = place.address;
    if (!parts || parts.country_code !== "in") return null;
    // Office divisions ("Zone 5 Royapuram", "Bengaluru South City Corporation") are not what people call their area
    const isOfficeDivision = (name: string) => /^(zone|ward)\b|corporation|municipal/i.test(name);
    const firstOf = (...keys: string[]) => keys.map((key) => parts[key]?.trim()).find((name) => name && !isOfficeDivision(name)) ?? "";
    const city = firstOf("city", "town", "municipality", "village", "county", "state_district");
    const area = firstOf("neighbourhood", "suburb", "quarter", "hamlet", "village", "city_district", "town");
    const houseAndStreet = [...new Set([parts.house_number, parts.house_name, parts.building, parts.road].map((part) => part?.trim()).filter(Boolean))].join(", ");
    const pincode = (parts.postcode ?? "").replace(/\s/g, "");
    // In Bengaluru: the area on our list that the place's own area names contain ("Koramangala 4th Block")
    const placeAreas = [parts.suburb, parts.neighbourhood, parts.quarter, parts.city_district].filter(Boolean).map((part) => part.toLowerCase());
    const isBengaluru = /bengaluru|bangalore/i.test(`${city} ${parts.state_district ?? ""}`);
    const listedArea = isBengaluru
      ? (BENGALURU_AREAS.find((listed) => placeAreas.some((placeArea) => placeArea.includes(listed.toLowerCase()))) ?? null)
      : null;
    return { houseAndStreet, area: area !== city ? area : "", city, pincode: /^\d{6}$/.test(pincode) ? pincode : "", listedArea };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}
type FieldErrors = Partial<Record<keyof FormValues | keyof ProfileValues, string>>;

// What the address adds to an empty Profile
export type ProfileDetailsFromAddress = ProfileValues & { secondaryMobile: string };

const emptyForm: FormValues = {
  label: "Home",
  name: "",
  mobileNumber: "",
  houseAndStreet: "",
  area: "",
  city: "Bengaluru",
  pincode: "",
};

// "  PRIYA   Sharma " → "priya sharma", to compare names
function sameNameForm(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// The first name without repeated letters: "Prassanjith Saravanan" and "Prasssanjith" are both "prasanjith"
function firstNameKey(name: string) {
  return sameNameForm(name).split(" ")[0].replace(/(.)\1+/g, "$1");
}

function findFieldErrors(formValues: FormValues, areaChoice: string, profileValues: ProfileValues | null): FieldErrors {
  const fieldErrors: FieldErrors = {};
  if (profileValues) {
    if (!profileValues.firstName.trim()) fieldErrors.firstName = "Enter the first name";
    if (!profileValues.lastName.trim()) fieldErrors.lastName = "Enter the last name";
    if (!/^\S+@\S+\.\S+$/.test(profileValues.email.trim())) fieldErrors.email = "Enter a valid email";
  } else if (!formValues.name.trim()) fieldErrors.name = "Enter the full name";
  if (formValues.mobileNumber.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "").length !== 10) {
    fieldErrors.mobileNumber = "Enter a 10-digit mobile number";
  }
  if (!formValues.houseAndStreet.trim()) fieldErrors.houseAndStreet = "Enter the house / flat and street";
  if (!areaChoice) fieldErrors.area = "Choose the area";
  else if (!formValues.area.trim()) fieldErrors.area = "Enter the area";
  if (!formValues.city.trim()) fieldErrors.city = "Enter the city";
  if (!/^\d{6}$/.test(formValues.pincode.trim())) fieldErrors.pincode = "Enter a 6-digit pincode";
  return fieldErrors;
}

export default function AddressFormDialog({
  addressToEdit,
  isDefaultAtStart,
  asksProfileDetails = false,
  savedAddresses = [],
  onPickSaved,
  onSave,
  onClose,
}: {
  addressToEdit: SavedAddress | null;
  isDefaultAtStart: boolean;
  asksProfileDetails?: boolean;
  savedAddresses?: SavedAddress[];
  onPickSaved?: (address: SavedAddress) => void;
  onSave: (address: FormValues, shouldBeDefault: boolean, profileDetails?: ProfileDetailsFromAddress) => void;
  onClose: () => void;
}) {
  const [formValues, setFormValues] = useState<FormValues>(() => (addressToEdit ? { ...addressToEdit } : emptyForm));
  const [shouldBeDefault, setShouldBeDefault] = useState(isDefaultAtStart);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // First name / last name start from the address's full name (first word, then the rest)
  const [profileValues, setProfileValues] = useState<ProfileValues>(() => {
    const [firstName = "", ...otherNames] = (addressToEdit?.name ?? "").trim().split(/\s+/);
    return { firstName, lastName: otherNames.join(" "), email: "" };
  });
  // The area box: a listed area, "Others" (then formValues.area is the typed text) or nothing yet
  const [areaChoice, setAreaChoice] = useState(() => areaChoiceFor(addressToEdit?.area ?? ""));
  const [pinState, setPinState] = useState<PinState>({ step: "idle" });
  // "Who is this address for?": asked on its own first; the form opens after the answer
  const [addressFor, setAddressFor] = useState<"me" | "someone-else" | null>(null);
  const isQuestionOpen = !addressToEdit && !asksProfileDetails && addressFor === null;
  const startsWithQuestion = useRef(isQuestionOpen);
  const loginMobile = useLoggedInMobileNumber();
  const savedProfile = useCustomerProfile(loginMobile);
  const ownName = `${savedProfile?.firstName ?? ""} ${savedProfile?.lastName ?? ""}`.trim();
  const isNameLocked = addressFor === "me" && Boolean(ownName);
  // The saved addresses of the kind chosen, listed before the form
  const [isAddingNew, setIsAddingNew] = useState(false);
  const ownFirstName = firstNameKey(ownName);
  const addressesOfChoice = savedAddresses.filter((address) => (firstNameKey(address.name) === ownFirstName) === (addressFor === "me"));
  const isListOpen = addressFor !== null && !isAddingNew && Boolean(onPickSaved) && addressesOfChoice.length > 0;
  const isFormOpen = !isQuestionOpen && !isListOpen;
  const firstFieldRef = useRef<HTMLInputElement>(null);
  // Latest onClose, so the Escape listener below is set up only once.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Cursor in the first field (the question takes it first); Escape closes; the page behind does not scroll while open.
  useEffect(() => {
    if (!startsWithQuestion.current) firstFieldRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", closeOnEscape);
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  // The form has just opened after the question: cursor in its first field
  useEffect(() => {
    if (isFormOpen && startsWithQuestion.current) firstFieldRef.current?.focus();
  }, [isFormOpen]);

  // The phone's GPS, once, when the customer taps the button (the phone asks them first)
  function addCurrentLocation() {
    if (!("geolocation" in navigator)) {
      setPinState({ step: "failed", message: "This phone or browser can't share its location." });
      return;
    }
    setPinState({ step: "finding" });
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        if (!isInIndia(latitude, longitude)) {
          setPinState({ step: "failed", message: "This location is outside India, so it can't be used for a delivery address." });
          return;
        }
        setFormValues((previousValues) => ({ ...previousValues, pin: { latitude, longitude } }));
        // The address boxes from the spot: the street only when it is still empty (it may have a flat number typed)
        const found = await lookUpAddress(latitude, longitude);
        if (found) {
          setAreaChoice(found.listedArea ?? (found.area ? OTHER_AREA : areaChoice));
          setFormValues((previousValues) => ({
            ...previousValues,
            houseAndStreet: previousValues.houseAndStreet.trim() ? previousValues.houseAndStreet : found.houseAndStreet,
            area: found.listedArea ?? (found.area || previousValues.area),
            city: found.city || previousValues.city,
            pincode: found.pincode || (found.listedArea ? pincodeForArea(found.listedArea) : "") || previousValues.pincode,
          }));
          setFieldErrors((previousErrors) => ({ ...previousErrors, houseAndStreet: undefined, area: undefined, city: undefined, pincode: undefined }));
        }
        setPinState({ step: "saved", accuracyMetres: Math.round(accuracy), isAddressFilled: Boolean(found) });
      },
      (problem) => {
        setPinState({
          step: "failed",
          message:
            problem.code === problem.PERMISSION_DENIED
              ? "Location is blocked. Allow location for this website in your phone's settings, or skip this."
              : "Couldn't find your location. Try again near a window or outdoors, or skip this.",
        });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  // The line under the location button
  function pinNote() {
    if (pinState.step === "finding") return "Finding your location and address…";
    if (pinState.step === "failed") return pinState.message;
    if (pinState.step === "saved") {
      const filledLine = pinState.isAddressFilled
        ? "Location added and the address filled in from it. Check it, add your house / flat number, then save."
        : "Location added, but we couldn't fill in the address from it. Please type it, then save.";
      return pinState.accuracyMetres > ROUGH_PIN_METRES
        ? `${filledLine} (Only exact to about ${pinState.accuracyMetres} m: try again near a window or outdoors for a closer spot.)`
        : filledLine;
    }
    if (formValues.pin) {
      return formValues.pinSavedBy === "agent" ? "Location saved by our delivery partner at your door." : "Location saved.";
    }
    return "Needed to place an order. Tap this while you're at this address, so we can check we deliver there and our delivery partner reaches your gate.";
  }

  function updateField(field: TextFieldName | keyof ProfileValues, value: string) {
    if (field === "firstName" || field === "lastName" || field === "email") setProfileValues((previousValues) => ({ ...previousValues, [field]: value }));
    else setFormValues((previousValues) => ({ ...previousValues, [field]: value }));
    setFieldErrors((previousErrors) => ({ ...previousErrors, [field]: undefined }));
  }

  // Choosing an area fills its pincode (Others: the typed area and an empty pincode, to fill in)
  function chooseArea(chosenArea: string) {
    setAreaChoice(chosenArea);
    const typedArea = otherAreaTextFor(formValues.area);
    setFormValues((previousValues) => ({
      ...previousValues,
      area: chosenArea === OTHER_AREA ? typedArea : chosenArea,
      // (areas share pincodes, so none is filled in: what the customer typed or the location gave stays)
      pincode: pincodeForArea(chosenArea) || previousValues.pincode,
    }));
    setFieldErrors((previousErrors) => ({ ...previousErrors, area: undefined, pincode: undefined }));
  }

  // "It's mine" fills in the customer's own name
  function chooseWhoFor(who: "me" | "someone-else") {
    setAddressFor(who);
    setFormValues((previousValues) => ({ ...previousValues, name: who === "me" ? ownName : "" }));
  }

  function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newFieldErrors = findFieldErrors(formValues, areaChoice, asksProfileDetails ? profileValues : null);
    // Someone else's address can't start with the customer's first name (the last name alone can); the same match
    // as the lists, so a spelling slip like "Prassanjith" for "Prasssanjith" isn't let through
    if (addressFor === "someone-else" && ownFirstName && firstNameKey(formValues.name) === ownFirstName) {
      newFieldErrors.name = "Enter the name of the person receiving it, not your own";
    }
    setFieldErrors(newFieldErrors);
    if (Object.keys(newFieldErrors).length > 0) return;
    const fullName = asksProfileDetails ? `${profileValues.firstName.trim()} ${profileValues.lastName.trim()}` : formValues.name.trim();
    onSave(
      {
        ...formValues,
        name: fullName,
        houseAndStreet: formValues.houseAndStreet.trim(),
        area: formValues.area.trim(),
        pincode: formValues.pincode.trim(),
        // A pin added just now is the customer's (the database notes it too)
        pinSavedBy: pinState.step === "saved" ? "customer" : formValues.pinSavedBy,
      },
      shouldBeDefault,
      asksProfileDetails
        ? {
            firstName: profileValues.firstName.trim(),
            lastName: profileValues.lastName.trim(),
            email: profileValues.email.trim(),
            secondaryMobile: "",
          }
        : undefined,
    );
  }

  function renderTextField(
    field: TextFieldName | keyof ProfileValues,
    label: string,
    options: { placeholder: string; inputMode?: "numeric" | "tel" | "email"; maxLength?: number; isWide?: boolean; note?: ReactNode; isLocked?: boolean },
  ) {
    const errorId = `address-form-${field}-error`;
    const value = field === "firstName" || field === "lastName" || field === "email" ? profileValues[field] : formValues[field];
    return (
      <label className={`${styles["address-form-field"]} ${options.isWide ? styles["address-form-field-wide"] : ""}`}>
        <span className={styles["address-form-label"]}>{label}</span>
        <input
          ref={field === (asksProfileDetails ? "firstName" : "name") ? firstFieldRef : undefined}
          value={value}
          readOnly={options.isLocked}
          placeholder={options.placeholder}
          inputMode={options.inputMode}
          maxLength={options.maxLength}
          aria-invalid={fieldErrors[field] ? true : undefined}
          aria-describedby={fieldErrors[field] ? errorId : undefined}
          className={`${styles["address-form-input"]} ${fieldErrors[field] ? styles["address-form-input-error"] : ""} ${options.isLocked ? styles["address-form-input-locked"] : ""}`}
          onChange={(event) => updateField(field, event.target.value)}
        />
        {fieldErrors[field] ? (
          <span id={errorId} className={styles["address-form-error"]}>
            {fieldErrors[field]}
          </span>
        ) : (
          options.note
        )}
      </label>
    );
  }

  return (
    <div className={styles["address-dialog-overlay"]} data-lenis-prevent>
      <button
        type="button"
        aria-label="Close without saving"
        className={styles["address-dialog-dimmed-page"]}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="address-dialog-heading"
        className={`${styles["address-dialog"]} ${isFormOpen ? "" : styles["address-dialog-waiting"]}`}
      >
        <div className={styles["address-dialog-heading-row"]}>
          <h2 id="address-dialog-heading" className={styles["address-dialog-heading"]}>
            {addressToEdit ? "Edit address" : "Add new address"}
          </h2>
          <button type="button" aria-label="Close" className={styles["address-dialog-close-button"]} onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <p className={styles["address-dialog-description"]}>
          We currently deliver only to selected locations in Bengaluru.
        </p>

        <form noValidate onSubmit={saveAddress}>
          {/* Address name: Home / Work / Other */}
          <div className={styles["address-form-labels"]} role="radiogroup" aria-label="Save address as">
            {addressLabels.map((addressLabel) => (
              <button
                key={addressLabel}
                type="button"
                role="radio"
                aria-checked={formValues.label === addressLabel}
                className={`${styles["address-form-label-chip"]} ${
                  formValues.label === addressLabel ? styles["address-form-label-chip-selected"] : ""
                }`}
                onClick={() => updateField("label", addressLabel)}
              >
                {addressLabel}
              </button>
            ))}
          </div>

          <div className={styles["address-form-grid"]}>
            {asksProfileDetails ? (
              <>
                {renderTextField("firstName", "First name", { placeholder: "Priya" })}
                {renderTextField("lastName", "Last name", { placeholder: "Sharma" })}
              </>
            ) : (
              renderTextField("name", "Full name", { placeholder: "Priya Sharma", isLocked: isNameLocked })
            )}
            {renderTextField("mobileNumber", "Mobile number", {
              placeholder: "+91 98450 12345",
              inputMode: "tel",
              maxLength: 16,
            })}
            {asksProfileDetails && renderTextField("email", "Email", { placeholder: "priya@example.com", inputMode: "email" })}
            {renderTextField("houseAndStreet", "House / flat and street", {
              placeholder: "#1312, Prestige Lakeside Habitat",
              isWide: true,
            })}
            <div className={styles["address-form-field"]}>
              <span id="address-form-area-label" className={styles["address-form-label"]}>
                Area
              </span>
              <BengaluruAreaPicker
                area={areaChoice}
                onChoose={chooseArea}
                labelId="address-form-area-label"
                look="account"
                hasError={Boolean(fieldErrors.area) && !areaChoice}
              />
              {fieldErrors.area && !areaChoice && (
                <span className={styles["address-form-error"]}>{fieldErrors.area}</span>
              )}
            </div>
            {renderTextField("pincode", "Pincode", {
              placeholder: "560087",
              inputMode: "numeric",
              maxLength: 6,
              // Filled from a listed area: ask the customer to check it
              note: pincodeForArea(areaChoice) && <PincodeCheckNote look="account" />,
            })}
            {/* "Others": the area in the customer's own words */}
            {areaChoice === OTHER_AREA && renderTextField("area", "Your area", { placeholder: "Area or landmark", isWide: true })}
            {/* Any city in India (filled from the location, or typed) */}
            {renderTextField("city", "City", { placeholder: "Bengaluru", isWide: true })}
          </div>

          {/* The map pin: needed to order (the database checks the distance from the hub with it) */}
          <div className={styles["address-form-location"]}>
            <button
              type="button"
              className={styles["address-form-location-button"]}
              disabled={pinState.step === "finding"}
              onClick={addCurrentLocation}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
                <circle cx="12" cy="10" r="2.4" />
              </svg>
              {formValues.pin ? "Update to my current location" : "Use my current location"}
            </button>
            <span
              role="status"
              className={pinState.step === "failed" ? styles["address-form-error"] : styles["address-form-location-note"]}
            >
              {pinNote()}
            </span>
          </div>

          <label className={styles["address-form-default-option"]}>
            <input
              type="checkbox"
              checked={shouldBeDefault}
              onChange={(event) => setShouldBeDefault(event.target.checked)}
            />
            Make this my default address
          </label>

          <div className={styles["address-dialog-buttons"]}>
            <button type="button" className={styles["address-dialog-cancel-button"]} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles["address-dialog-save-button"]}>
              Save address
            </button>
          </div>
        </form>
      </div>

      {isQuestionOpen && (
        <div className={styles["address-number-question-backdrop"]}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="address-number-question-heading"
            aria-describedby="address-number-question-agent-note"
            className={styles["address-number-question"]}
          >
            <h3 id="address-number-question-heading" className={styles["address-number-question-heading"]}>
              Who is this address for?
            </h3>
            <div className={styles["address-number-question-choices"]}>
              <button type="button" className={styles["address-number-question-choice"]} onClick={() => chooseWhoFor("me")} autoFocus>
                <strong>It&apos;s mine</strong>
                <span>{ownName ? `Your name stays ${ownName}. You can change the number and address` : "You can change the number and address"}</span>
              </button>
              <button type="button" className={styles["address-number-question-choice"]} onClick={() => chooseWhoFor("someone-else")}>
                <strong>Someone else&apos;s</strong>
                <span>You can enter their name, number and address</span>
              </button>
            </div>
            <p id="address-number-question-agent-note" className={styles["address-number-question-agent-note"]}>
              The delivery agent will call the number you give here for orders sent to this address.
            </p>
            <p className={styles["address-number-question-login-note"]}>You will still log in with your current number.</p>
            <button type="button" className={styles["address-number-question-back-button"]} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {isListOpen && (
        <div className={styles["address-number-question-backdrop"]}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="address-saved-heading" className={styles["address-number-question"]}>
            <h3 id="address-saved-heading" className={styles["address-number-question-heading"]}>
              {addressFor === "me" ? "Your addresses" : "Someone else\u2019s addresses"}
            </h3>
            <div className={styles["address-saved-list"]}>
              {addressesOfChoice.map((address) => (
                <button key={address.id} type="button" className={styles["address-number-question-choice"]} onClick={() => onPickSaved?.(address)}>
                  <strong>
                    {address.label} · {address.name}
                  </strong>
                  <span>
                    {address.houseAndStreet}, {address.area}, {address.city} {address.pincode}
                  </span>
                  <span>{address.mobileNumber}</span>
                </button>
              ))}
            </div>
            <button type="button" className={styles["address-saved-add-button"]} onClick={() => setIsAddingNew(true)} autoFocus>
              Add new address
            </button>
            <button type="button" className={styles["address-number-question-back-button"]} onClick={() => setAddressFor(null)}>
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
