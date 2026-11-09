import { useEffect, useSyncExternalStore } from "react";
import { readLoggedInMobileNumber, useLoggedInMobileNumber } from "@/components/login/login-status";
import { createClient } from "@/lib/supabase/client";
import { ensureCustomerRowId, loadCustomerProfile, saveCustomerProfile, useCustomerProfile, type CustomerProfile } from "./customer-profiles-store";

/*
  The logged-in customer's saved delivery addresses and which one is the default, shared by My Addresses
  (account dashboard) and the address step of the cart checkout. Saved in the Supabase "addresses" table
  (supabase/migrations/0002_people_and_login.sql, 0005_address_profile_slot.sql), linked to the customer's
  row, so the book follows them to any phone; the database's rules let a customer see only their own.
  A customer's book starts with the addresses from their Profile page: the primary address ("Home",
  the default) and the secondary address ("Other"), marked with profile_slot; saving the Profile again
  updates those two. Addresses they add, edit or remove here are kept with them. Logged out: no addresses.
  The page shows a change at once and then sends it; if the database refuses it, the book is read again.
  A book saved earlier only in this browser (before the database) is moved into the database once.
  An address can have a map pin (0027_address_pins.sql): the spot from the phone's GPS, so the delivery agent's
  Google Maps goes to the gate. The database notes who saved it (the customer, or the agent at the door).
*/

// The exact spot of the address (from the phone's GPS, never typed)
export type MapPin = { latitude: number; longitude: number };

export type SavedAddress = {
  id: string;
  label: string;
  name: string;
  mobileNumber: string;
  houseAndStreet: string;
  area: string;
  city: string;
  pincode: string;
  pin?: MapPin | null; // null: no pin; left out on a change: the pin stays as it is
  pinSavedBy?: "customer" | "agent" | null;
  isProfileAddress?: boolean; // the Profile's Home or Other (a team member asks before changing it)
};

export type AddressDetails = Omit<SavedAddress, "id" | "isProfileAddress">;

type AddressBook = { addresses: SavedAddress[]; defaultAddressId: string };

// The row as the database keeps it
type AddressRow = {
  id: string;
  label: string;
  name: string;
  mobile_number: string;
  house_and_street: string;
  area: string;
  city: string;
  pincode: string;
  is_default: boolean;
  profile_slot: "primary" | "secondary" | null;
  latitude: number | null;
  longitude: number | null;
  pin_saved_by: "customer" | "agent" | null;
};

const EMPTY_ADDRESS_BOOK: AddressBook = { addresses: [], defaultAddressId: "" };

// The old browser copy of a book (moved into the database once)
const oldAddressStorageKey = (mobileNumber: string) => `chiranvi-addresses-${mobileNumber}`;
// Each customer's book once read, by login number
const addressBooks = new Map<string, AddressBook>();
const loadingBooks = new Set<string>();
const addressBookListeners = new Set<() => void>();

// "+919845012345" or "98450 12345" -> "+91 98450 12345"
function formatMobileNumber(mobileNumber: string) {
  const digits = tenDigits(mobileNumber);
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

// "+91 98450 12345" -> "9845012345" (how the database keeps it)
function tenDigits(mobileNumber: string) {
  return mobileNumber.replace(/\D/g, "").slice(-10);
}

function toAddress(row: AddressRow): SavedAddress {
  return {
    id: row.id,
    label: row.label,
    name: row.name,
    mobileNumber: formatMobileNumber(row.mobile_number),
    houseAndStreet: row.house_and_street,
    area: row.area,
    city: row.city,
    pincode: row.pincode,
    pin: row.latitude !== null && row.longitude !== null ? { latitude: row.latitude, longitude: row.longitude } : null,
    isProfileAddress: row.profile_slot !== null,
    pinSavedBy: row.pin_saved_by,
  };
}

// Who saved the pin is written by the database, never sent from here
function toRow(details: AddressDetails) {
  return {
    label: details.label,
    name: details.name.trim(),
    mobile_number: tenDigits(details.mobileNumber),
    house_and_street: details.houseAndStreet.trim(),
    area: details.area.trim(),
    city: details.city || "Bengaluru",
    pincode: details.pincode.trim(),
    ...(details.pin === undefined ? {} : { latitude: details.pin?.latitude ?? null, longitude: details.pin?.longitude ?? null }),
  };
}

function announce() {
  addressBookListeners.forEach((onChange) => onChange());
}

function setBook(mobileNumber: string, book: AddressBook) {
  addressBooks.set(mobileNumber, book);
  announce();
}

// A book this browser saved before the database existed (or null)
function oldBrowserBook(mobileNumber: string): AddressBook | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(oldAddressStorageKey(mobileNumber)) ?? "null");
    return saved && Array.isArray(saved.addresses) && saved.addresses.length ? saved : null;
  } catch {
    return null;
  }
}

/*
  Reads the customer's addresses from the database (once; again with refresh). The first time, an older
  browser-only book is moved in (its Home / Other from the Profile come from the Profile itself).
*/
async function loadAddressBook(mobileNumber: string, refresh = false) {
  if ((!refresh && addressBooks.has(mobileNumber)) || loadingBooks.has(mobileNumber)) return;
  loadingBooks.add(mobileNumber);
  const supabase = createClient();
  const readRows = async () => {
    const { data, error } = await supabase
      .from("addresses")
      .select("id, label, name, mobile_number, house_and_street, area, city, pincode, is_default, profile_slot, latitude, longitude, pin_saved_by, customers!inner(mobile_number)")
      .eq("customers.mobile_number", mobileNumber)
      .order("created_at");
    if (error) console.error("Could not read the addresses", error);
    return (data ?? []) as unknown as AddressRow[];
  };
  let rows = await readRows();
  if (rows.length === 0) {
    const fromBrowser = oldBrowserBook(mobileNumber);
    const ownAddresses = fromBrowser?.addresses.filter((address) => !address.id.startsWith("profile-")) ?? [];
    const customerId = ownAddresses.length ? await ensureCustomerRowId(mobileNumber) : null;
    if (customerId && fromBrowser) {
      await supabase.from("addresses").insert(
        ownAddresses.map((address) => ({ ...toRow(address), customer_id: customerId, is_default: address.id === fromBrowser.defaultAddressId })),
      );
      rows = await readRows();
    }
  }
  const addresses = rows.map(toAddress);
  const defaultAddressId = rows.find((row) => row.is_default)?.id ?? addresses[0]?.id ?? "";
  loadingBooks.delete(mobileNumber);
  setBook(mobileNumber, { addresses, defaultAddressId });
}

// After a change: show it at once, save it, and read the book again if the database refused it
async function saveThenCheck(mobileNumber: string, newBook: AddressBook, write: () => Promise<{ error: unknown } | null>) {
  setBook(mobileNumber, newBook);
  const result = await write();
  if (!result || result.error) {
    console.error("The database did not accept the address change", result?.error);
    void loadAddressBook(mobileNumber, true);
  }
}

// Makes one address the default (the database allows only one: the old one is cleared first)
async function writeDefault(customerId: string, addressId: string) {
  const supabase = createClient();
  const cleared = await supabase.from("addresses").update({ is_default: false }).eq("customer_id", customerId).eq("is_default", true);
  if (cleared.error) return cleared;
  return supabase.from("addresses").update({ is_default: true }).eq("id", addressId);
}

/*
  The customer saved their Profile: their Home / Other addresses take the new details (put back if they
  had removed them); addresses they added themselves stay. The first address becomes the default.
*/
export async function updateAddressesFromProfile(profile: CustomerProfile) {
  const customerId = await ensureCustomerRowId(profile.primaryMobile);
  if (!customerId) return;
  const supabase = createClient();
  const shared = {
    name: `${profile.firstName} ${profile.lastName}`.trim(),
    area: profile.location,
    city: "Bengaluru",
    pincode: profile.pincode,
  };
  const slots: { slot: "primary" | "secondary"; label: string; street: string }[] = [
    { slot: "primary", label: "Home", street: profile.primaryAddress },
    { slot: "secondary", label: "Other", street: profile.secondaryAddress },
  ];
  for (const { slot, label, street } of slots) {
    const { data: existing } = await supabase.from("addresses").select("id").eq("customer_id", customerId).eq("profile_slot", slot).maybeSingle();
    if (!street.trim() || !/^\d{6}$/.test(profile.pincode)) {
      // No secondary address on the Profile any more: its row goes
      if (existing && slot === "secondary") await supabase.from("addresses").delete().eq("id", existing.id);
      continue;
    }
    const row = { ...shared, label, house_and_street: street.trim(), profile_slot: slot };
    // An existing Home / Other keeps its own delivery phone (the cart's address that filled the Profile may have
    // another number); a new one gets the login number
    if (existing) await supabase.from("addresses").update(row).eq("id", existing.id);
    else await supabase.from("addresses").insert({ ...row, mobile_number: profile.primaryMobile, customer_id: customerId });
  }
  // No default yet (a new book): Home is the default
  const { data: defaults } = await supabase.from("addresses").select("id").eq("customer_id", customerId).eq("is_default", true);
  if (!defaults?.length) {
    const { data: home } = await supabase.from("addresses").select("id").eq("customer_id", customerId).eq("profile_slot", "primary").maybeSingle();
    if (home) await supabase.from("addresses").update({ is_default: true }).eq("id", home.id);
  }
  await loadAddressBook(profile.primaryMobile, true);
}

/*
  The cart: a logged-in customer without a Profile saved a delivery address with the Profile's details
  (first and last name, email, and the address's number as their second number when they said it is
  theirs; components/account/address/address-form-dialog.tsx, asksProfileDetails). With the address
  (primary address, area, pincode) they fill every required Profile detail. The address itself becomes the
  Profile's Home address (keeping its own phone), so the book doesn't get it twice. Nothing happens when
  they already have a Profile.
*/
export async function fillEmptyProfileFromAddress(
  addressId: string,
  details: AddressDetails,
  profileDetails: { firstName: string; lastName: string; email: string; secondaryMobile: string },
) {
  const mobileNumber = readLoggedInMobileNumber();
  if (!mobileNumber || (await loadCustomerProfile(mobileNumber))) return;
  // A just-added address may still be on its way to the database: wait for its row (up to 5 s)
  const supabase = createClient();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data } = await supabase.from("addresses").select("id").eq("id", addressId).maybeSingle();
    if (data) break;
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  await supabase.from("addresses").update({ profile_slot: "primary" }).eq("id", addressId);
  saveCustomerProfile({
    firstName: profileDetails.firstName,
    lastName: profileDetails.lastName,
    primaryMobile: mobileNumber,
    secondaryMobile: profileDetails.secondaryMobile !== mobileNumber ? profileDetails.secondaryMobile : "",
    email: profileDetails.email,
    primaryAddress: details.houseAndStreet.trim(),
    secondaryAddress: "",
    location: details.area,
    pincode: details.pincode,
    dateOfBirth: "",
    familySize: "",
    preferredPlanType: "",
  });
}

function subscribeToAddressBook(onChange: () => void) {
  addressBookListeners.add(onChange);
  return () => {
    addressBookListeners.delete(onChange);
  };
}

// The logged-in customer's { addresses, defaultAddressId } (read from the database the first time)
export function useAddressBook() {
  const mobileNumber = useLoggedInMobileNumber();
  // Also reads their Profile (orders take the customer's name and Customer ID from it)
  useCustomerProfile(mobileNumber);
  useEffect(() => {
    if (mobileNumber) void loadAddressBook(mobileNumber);
  }, [mobileNumber]);
  return useSyncExternalStore(
    subscribeToAddressBook,
    () => (mobileNumber ? (addressBooks.get(mobileNumber) ?? EMPTY_ADDRESS_BOOK) : EMPTY_ADDRESS_BOOK),
    () => EMPTY_ADDRESS_BOOK,
  );
}

/*
  "#1312, Prestige Lakeside Habitat, Varthur, Bengaluru 560087". Customers often type the area, city or
  pincode in the street line too ("…, 4th Main Road, Electronic City"): those parts are left out of the
  street line, so the area, city and pincode show once, at the end.
*/
export function formatAddressLine(address: AddressDetails) {
  const sameText = (first: string, second: string) => first.trim().toLowerCase() === second.trim().toLowerCase();
  const isCityOrPincode = (part: string) =>
    /^(bengaluru|bangalore)?[\s-]*\d{6}$/i.test(part.trim()) || /^(bengaluru|bangalore)$/i.test(part.trim()) || sameText(part, address.city);
  const streetParts = address.houseAndStreet
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !sameText(part, address.area) && !isCityOrPincode(part));
  return [...streetParts, address.area, `${address.city} ${address.pincode}`.trim()].filter((part) => part.trim()).join(", ");
}

// Adds an address and returns its id. The first address, or shouldBeDefault, becomes the default.
export function addAddress(details: AddressDetails, shouldBeDefault: boolean) {
  const mobileNumber = readLoggedInMobileNumber();
  const newAddressId = crypto.randomUUID();
  if (!mobileNumber) return newAddressId;
  const book = addressBooks.get(mobileNumber) ?? EMPTY_ADDRESS_BOOK;
  const becomesDefault = shouldBeDefault || book.addresses.length === 0;
  void saveThenCheck(
    mobileNumber,
    {
      addresses: [...book.addresses, { ...details, mobileNumber: formatMobileNumber(details.mobileNumber), id: newAddressId }],
      defaultAddressId: becomesDefault ? newAddressId : book.defaultAddressId,
    },
    async () => {
      const customerId = await ensureCustomerRowId(mobileNumber);
      if (!customerId) return null;
      const inserted = await createClient().from("addresses").insert({ ...toRow(details), id: newAddressId, customer_id: customerId });
      if (inserted.error || !becomesDefault) return inserted;
      return writeDefault(customerId, newAddressId);
    },
  );
  return newAddressId;
}

export function updateAddress(addressId: string, details: AddressDetails, shouldBeDefault: boolean) {
  const mobileNumber = readLoggedInMobileNumber();
  if (!mobileNumber) return;
  const book = addressBooks.get(mobileNumber) ?? EMPTY_ADDRESS_BOOK;
  void saveThenCheck(
    mobileNumber,
    {
      addresses: book.addresses.map((address) =>
        // (a change without a pin keeps the address's pin)
        address.id === addressId
          ? { ...address, ...details, pin: details.pin === undefined ? address.pin : details.pin, mobileNumber: formatMobileNumber(details.mobileNumber), id: addressId }
          : address,
      ),
      defaultAddressId: shouldBeDefault ? addressId : book.defaultAddressId,
    },
    async () => {
      const updated = await createClient().from("addresses").update(toRow(details)).eq("id", addressId);
      if (updated.error || !shouldBeDefault) return updated;
      const customerId = await ensureCustomerRowId(mobileNumber);
      return customerId ? writeDefault(customerId, addressId) : null;
    },
  );
}

// Removing the default address makes the next one the default.
export function removeAddress(addressId: string) {
  const mobileNumber = readLoggedInMobileNumber();
  if (!mobileNumber) return;
  const book = addressBooks.get(mobileNumber) ?? EMPTY_ADDRESS_BOOK;
  const remainingAddresses = book.addresses.filter((address) => address.id !== addressId);
  const nextDefaultId = addressId === book.defaultAddressId ? (remainingAddresses[0]?.id ?? "") : book.defaultAddressId;
  void saveThenCheck(mobileNumber, { addresses: remainingAddresses, defaultAddressId: nextDefaultId }, async () => {
    const removed = await createClient().from("addresses").delete().eq("id", addressId);
    if (removed.error || !nextDefaultId || nextDefaultId === book.defaultAddressId) return removed;
    const customerId = await ensureCustomerRowId(mobileNumber);
    return customerId ? writeDefault(customerId, nextDefaultId) : null;
  });
}

export function setDefaultAddress(addressId: string) {
  const mobileNumber = readLoggedInMobileNumber();
  if (!mobileNumber) return;
  const book = addressBooks.get(mobileNumber) ?? EMPTY_ADDRESS_BOOK;
  void saveThenCheck(mobileNumber, { ...book, defaultAddressId: addressId }, async () => {
    const customerId = await ensureCustomerRowId(mobileNumber);
    return customerId ? writeDefault(customerId, addressId) : null;
  });
}
