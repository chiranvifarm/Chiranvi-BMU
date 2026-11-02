"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import BengaluruAreaPicker, { OTHER_AREA, PincodeCheckNote, areaChoiceFor, otherAreaTextFor, pincodeForArea } from "@/components/area-picker/bengaluru-area-picker";
import { useLoggedInMobileNumber } from "@/components/login/login-status";
import type { SavedAddress } from "@/store/address-store";
import { saveCustomerProfile, useCustomerProfile } from "@/store/customer-profiles-store";
import styles from "./address-form-dialog.module.css";

/*
  Pop-up form to add a new address or edit one (opened from "Add new address" / "Edit" on My Addresses,
  and from the address step of the cart checkout).
  Fields: address name (Home / Work / Other), full name, mobile number, house / flat and street,
  area, city (Bengaluru only, as we deliver only there) and pincode, plus "Make this my default address".
  Area: chosen from the Bengaluru list, which fills in its pincode (still editable); "Others" opens a box
  to type the area, which is what gets saved.
  Checks before saving: every field filled, a 10-digit mobile number and a 6-digit pincode.
  A mobile number different from the login number (and from the profile's secondary number) asks first
  whose it is: "Someone else's" keeps it for this address only (the delivery contact on its orders);
  "It's mine" also saves it as the customer's secondary number on their Profile. The login number never
  changes here (a new login number needs an OTP check, which comes with the backend).
  Cancel, the close button, Escape or a click on the dimmed page closes it without saving.
  asksProfileDetails (the cart, for a logged-in customer without a Profile): "Full name" becomes First name and
  Last name, and Email is asked too, so the address gives every detail the Profile needs; they go to onSave
  as profileDetails (with the address's number as the second number when it is "mine").
*/

export type { SavedAddress };

const addressLabels = ["Home", "Work", "Other"];

type FormValues = Omit<SavedAddress, "id">;
// The Profile's details asked with the address (asksProfileDetails)
type ProfileValues = { firstName: string; lastName: string; email: string };
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

// "+91 98450 12345" → "9845012345"
function tenDigitsOf(mobileNumber: string) {
  return mobileNumber.replace(/[^0-9]/g, "").replace(/^91(?=[0-9]{10}$)/, "");
}

// "9845012345" → "98450 12345"
function formatMobile(tenDigits: string) {
  return `${tenDigits.slice(0, 5)} ${tenDigits.slice(5)}`;
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
  if (!/^\d{6}$/.test(formValues.pincode.trim())) fieldErrors.pincode = "Enter a 6-digit pincode";
  return fieldErrors;
}

export default function AddressFormDialog({
  addressToEdit,
  isDefaultAtStart,
  asksProfileDetails = false,
  onSave,
  onClose,
}: {
  addressToEdit: SavedAddress | null;
  isDefaultAtStart: boolean;
  asksProfileDetails?: boolean;
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
  // "Whose number is this?" shown over the form (the address is saved once it is answered)
  const [isNumberQuestionOpen, setIsNumberQuestionOpen] = useState(false);
  const isNumberQuestionOpenRef = useRef(false);
  useEffect(() => {
    isNumberQuestionOpenRef.current = isNumberQuestionOpen;
  }, [isNumberQuestionOpen]);
  const loginMobile = useLoggedInMobileNumber();
  const savedProfile = useCustomerProfile(loginMobile);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  // Latest onClose, so the Escape listener below is set up only once.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Cursor in the first field; Escape closes; the page behind does not scroll while open.
  useEffect(() => {
    firstFieldRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // With the number question open, Escape goes back to the form only
      if (isNumberQuestionOpenRef.current) setIsNumberQuestionOpen(false);
      else onCloseRef.current();
    }
    window.addEventListener("keydown", closeOnEscape);
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  function updateField(field: keyof FormValues | keyof ProfileValues, value: string) {
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
      pincode: chosenArea === OTHER_AREA ? "" : pincodeForArea(chosenArea),
    }));
    setFieldErrors((previousErrors) => ({ ...previousErrors, area: undefined, pincode: undefined }));
  }

  function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newFieldErrors = findFieldErrors(formValues, areaChoice, asksProfileDetails ? profileValues : null);
    setFieldErrors(newFieldErrors);
    if (Object.keys(newFieldErrors).length > 0) return;
    const typedMobile = tenDigitsOf(formValues.mobileNumber);
    const isOtherNumber = Boolean(loginMobile) && typedMobile !== loginMobile && typedMobile !== savedProfile?.secondaryMobile;
    if (isOtherNumber) {
      setIsNumberQuestionOpen(true);
      return;
    }
    saveTheAddress(false);
  }

  // "It's mine": the number also becomes the secondary number on the customer's Profile
  function saveAsMyNumber() {
    if (savedProfile) saveCustomerProfile({ ...savedProfile, secondaryMobile: tenDigitsOf(formValues.mobileNumber) });
    saveTheAddress(true);
  }

  // isMyNumber: "It's mine" was chosen for a number other than the login number
  function saveTheAddress(isMyNumber: boolean) {
    const fullName = asksProfileDetails ? `${profileValues.firstName.trim()} ${profileValues.lastName.trim()}` : formValues.name.trim();
    onSave(
      {
        ...formValues,
        name: fullName,
        houseAndStreet: formValues.houseAndStreet.trim(),
        area: formValues.area.trim(),
        pincode: formValues.pincode.trim(),
      },
      shouldBeDefault,
      asksProfileDetails
        ? {
            firstName: profileValues.firstName.trim(),
            lastName: profileValues.lastName.trim(),
            email: profileValues.email.trim(),
            secondaryMobile: isMyNumber ? tenDigitsOf(formValues.mobileNumber) : "",
          }
        : undefined,
    );
  }

  function renderTextField(
    field: keyof FormValues | keyof ProfileValues,
    label: string,
    options: { placeholder: string; inputMode?: "numeric" | "tel" | "email"; maxLength?: number; isWide?: boolean; note?: ReactNode },
  ) {
    const errorId = `address-form-${field}-error`;
    const value = field === "firstName" || field === "lastName" || field === "email" ? profileValues[field] : formValues[field];
    return (
      <label className={`${styles["address-form-field"]} ${options.isWide ? styles["address-form-field-wide"] : ""}`}>
        <span className={styles["address-form-label"]}>{label}</span>
        <input
          ref={field === (asksProfileDetails ? "firstName" : "name") ? firstFieldRef : undefined}
          value={value}
          placeholder={options.placeholder}
          inputMode={options.inputMode}
          maxLength={options.maxLength}
          aria-invalid={fieldErrors[field] ? true : undefined}
          aria-describedby={fieldErrors[field] ? errorId : undefined}
          className={`${styles["address-form-input"]} ${fieldErrors[field] ? styles["address-form-input-error"] : ""}`}
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
        className={styles["address-dialog"]}
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
              renderTextField("name", "Full name", { placeholder: "Priya Sharma" })
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
            <label className={`${styles["address-form-field"]} ${styles["address-form-field-wide"]}`}>
              <span className={styles["address-form-label"]}>City</span>
              <input
                value="Bengaluru"
                readOnly
                className={`${styles["address-form-input"]} ${styles["address-form-input-locked"]}`}
              />
            </label>
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

      {isNumberQuestionOpen && (
        <div className={styles["address-number-question-backdrop"]}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="address-number-question-heading"
            aria-describedby="address-number-question-text"
            className={styles["address-number-question"]}
          >
            <h3 id="address-number-question-heading" className={styles["address-number-question-heading"]}>
              Whose number is this?
            </h3>
            <p id="address-number-question-text" className={styles["address-number-question-text"]}>
              <strong>{formatMobile(tenDigitsOf(formValues.mobileNumber))}</strong> is different from the number you logged in with.
            </p>
            <div className={styles["address-number-question-choices"]}>
              <button type="button" className={styles["address-number-question-choice"]} onClick={() => saveTheAddress(false)} autoFocus>
                <strong>Someone else&apos;s</strong>
                <span>Use it only for this delivery address</span>
              </button>
              <button type="button" className={styles["address-number-question-choice"]} onClick={saveAsMyNumber}>
                <strong>It&apos;s mine</strong>
                <span>Save it as my second number</span>
              </button>
            </div>
            <p className={styles["address-number-question-login-note"]}>You will still log in with your current number.</p>
            <button type="button" className={styles["address-number-question-back-button"]} onClick={() => setIsNumberQuestionOpen(false)}>
              Go back and edit the number
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
