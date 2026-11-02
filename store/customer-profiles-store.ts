import { useEffect, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { customerIdForMobile, isCustomerListed, removeCustomer, saveRegisteredCustomer } from "./admin-customers-store";
import { updateAddressesFromProfile } from "./address-store";

/*
  Customers' own details from the Profile page (/account), saved in the Supabase "customers" table
  (supabase/migrations/0002_people_and_login.sql), one row per customer, linked to their login. So the
  details follow the customer to any phone or laptop, on localhost and on the live site.
  A new customer is taken to the Profile page after logging in; saving it gives them a Customer ID
  (made from their login number) and puts them on the Chiranvi Panel's Customers page (badge "new").
  The logged-in customer's row is read after login (the database's rules let them read only their own).
  The page shows a save at once and then sends it; if the database refuses it, the row is read again.
  A profile saved earlier only in this browser (before the database) is moved into the database once.
*/

export type CustomerProfileDetails = {
  firstName: string;
  lastName: string;
  primaryMobile: string; // 10 digits, the number used to log in
  secondaryMobile: string; // 10 digits or empty
  email: string;
  primaryAddress: string;
  secondaryAddress: string;
  location: string; // a Bengaluru area from the area picker (components/area-picker), or the typed area for "Others"
  pincode: string; // 6 digits
  // Optional (asked under "More about you")
  dateOfBirth: string; // yyyy-mm-dd or empty
  familySize: string;
  preferredPlanType: string;
};

export type CustomerProfile = CustomerProfileDetails & {
  customerId: string; // CUS-3KJ2Q9T
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

// The row as the database keeps it
type CustomerRow = {
  id: string;
  customer_code: string;
  mobile_number: string;
  secondary_mobile: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  primary_address: string | null;
  secondary_address: string | null;
  location: string | null;
  pincode: string | null;
  date_of_birth: string | null;
  family_size: string | null;
  preferred_plan_type: string | null;
  profile_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

// The old browser copy (moved into the database once)
const OLD_STORAGE_KEY = "chiranvi-customer-profiles";

// Profiles read from the database, by login number (in practice only the logged-in customer's)
let profiles: Record<string, CustomerProfile> = {};
// The database row id of each customer (addresses are linked to it), by login number
const customerRowIds = new Map<string, string>();
// Login numbers whose row has been read (with or without a profile), and reads under way
const loadedMobiles = new Set<string>();
const loadingMobiles = new Map<string, Promise<CustomerProfile | null>>();
const listeners = new Set<() => void>();
const EMPTY: Record<string, CustomerProfile> = {};

function announce() {
  profiles = { ...profiles };
  listeners.forEach((onChange) => onChange());
}

function toProfile(row: CustomerRow): CustomerProfile {
  return {
    firstName: row.first_name,
    lastName: row.last_name,
    primaryMobile: row.mobile_number,
    secondaryMobile: row.secondary_mobile ?? "",
    email: row.email ?? "",
    primaryAddress: row.primary_address ?? "",
    secondaryAddress: row.secondary_address ?? "",
    location: row.location ?? "",
    pincode: row.pincode ?? "",
    dateOfBirth: row.date_of_birth ?? "",
    familySize: row.family_size ?? "",
    preferredPlanType: row.preferred_plan_type ?? "",
    customerId: row.customer_code,
    createdAt: row.profile_completed_at ?? row.created_at,
    updatedAt: row.updated_at,
  };
}

// The Profile form's details as database columns (empty optional fields are saved as empty, not "")
function toRow(details: CustomerProfileDetails) {
  const orNull = (value: string) => (value.trim() ? value.trim() : null);
  return {
    mobile_number: details.primaryMobile,
    customer_code: customerIdForMobile(details.primaryMobile),
    first_name: details.firstName.trim(),
    last_name: details.lastName.trim(),
    secondary_mobile: orNull(details.secondaryMobile),
    email: orNull(details.email),
    primary_address: orNull(details.primaryAddress),
    secondary_address: orNull(details.secondaryAddress),
    location: orNull(details.location),
    pincode: orNull(details.pincode),
    date_of_birth: orNull(details.dateOfBirth),
    family_size: orNull(details.familySize),
    preferred_plan_type: orNull(details.preferredPlanType),
  };
}

// A profile this browser saved before the database existed, for this number (or null)
function oldBrowserProfile(mobileNumber: string): CustomerProfileDetails | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(OLD_STORAGE_KEY) ?? "null");
    const profile = saved && typeof saved === "object" ? saved[mobileNumber] : null;
    return profile && typeof profile.firstName === "string" && profile.firstName.trim() ? profile : null;
  } catch {
    return null;
  }
}

/*
  Reads this login number's customer row from the database (once; again with refresh). Returns the
  profile, or null for a new customer who has not saved one yet. An older browser-only profile is moved in.
*/
export function loadCustomerProfile(mobileNumber: string, refresh = false): Promise<CustomerProfile | null> {
  if (!refresh && loadedMobiles.has(mobileNumber)) return Promise.resolve(profiles[mobileNumber] ?? null);
  const running = loadingMobiles.get(mobileNumber);
  if (running && !refresh) return running;
  const reading = (async () => {
    /*
      Only the logged-in customer can read their row. Read without that login (the session not there yet,
      or another number's), the answer "no row" would be wrong, so it is not kept: the read runs again
      once the login is there (see followProfileChanges).
    */
    const { data: sessionData } = await createClient().auth.getSession();
    if ((sessionData.session?.user.phone ?? "").replace(/\D/g, "").slice(-10) !== mobileNumber) {
      loadingMobiles.delete(mobileNumber);
      return profiles[mobileNumber] ?? null;
    }
    const { data, error } = await createClient()
      .from("customers")
      .select("*")
      .eq("mobile_number", mobileNumber)
      .maybeSingle();
    if (error) console.error("Could not read the profile", error);
    const row = data as CustomerRow | null;
    if (row) customerRowIds.set(mobileNumber, row.id);
    let profile = row && row.profile_completed_at ? toProfile(row) : null;
    // First time on the database: a profile saved only in this browser before is moved in
    if (!profile && !error) {
      const fromBrowser = oldBrowserProfile(mobileNumber);
      if (fromBrowser) profile = await writeProfile({ ...fromBrowser, primaryMobile: mobileNumber });
    }
    if (profile) profiles[mobileNumber] = profile;
    else delete profiles[mobileNumber];
    loadedMobiles.add(mobileNumber);
    loadingMobiles.delete(mobileNumber);
    announce();
    if (profile) listOnCustomersPage(profile);
    return profile;
  })();
  loadingMobiles.set(mobileNumber, reading);
  return reading;
}

// Saves (creates or updates) the customer's row as the logged-in customer; returns the saved profile
async function writeProfile(details: CustomerProfileDetails): Promise<CustomerProfile | null> {
  const supabase = createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from("customers")
    .upsert(
      { ...toRow(details), user_id: userId, profile_completed_at: profiles[details.primaryMobile]?.createdAt ?? new Date().toISOString() },
      { onConflict: "mobile_number" },
    )
    .select("*")
    .single();
  if (error) {
    console.error("The database did not accept the profile", error);
    return null;
  }
  const row = data as CustomerRow;
  customerRowIds.set(details.primaryMobile, row.id);
  return toProfile(row);
}

/*
  The customer's row id in the database, making a short row for them first if they have none yet (e.g.
  adding an address in the cart before saving the Profile), so addresses always have a customer to belong to.
*/
export async function ensureCustomerRowId(mobileNumber: string): Promise<string | null> {
  if (customerRowIds.has(mobileNumber)) return customerRowIds.get(mobileNumber) ?? null;
  await loadCustomerProfile(mobileNumber);
  if (customerRowIds.has(mobileNumber)) return customerRowIds.get(mobileNumber) ?? null;
  const supabase = createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from("customers")
    .insert({ user_id: userId, mobile_number: mobileNumber, customer_code: customerIdForMobile(mobileNumber) })
    .select("id")
    .single();
  if (error) {
    console.error("Could not create the customer row", error);
    return null;
  }
  customerRowIds.set(mobileNumber, data.id as string);
  return data.id as string;
}

// The Chiranvi Panel's Customers page still keeps its own list in the browser (until it moves to the
// database): a customer with a saved profile is put on it. Runs after the current drawing.
function listOnCustomersPage(profile: CustomerProfile) {
  window.setTimeout(() => {
    if (!isCustomerListed(profile.primaryMobile)) saveRegisteredCustomer(profile, profile.createdAt);
  }, 0);
}

// The saved profile of this login number, or null (a new customer, or not read yet)
export function getCustomerProfile(mobileNumber: string): CustomerProfile | null {
  return profiles[mobileNumber] ?? null;
}

// Saves the Profile form; the first save also adds the customer to the Chiranvi Panel's Customers page
export function saveCustomerProfile(details: CustomerProfileDetails): CustomerProfile {
  const existing = getCustomerProfile(details.primaryMobile);
  const now = new Date().toISOString();
  const customerId = saveRegisteredCustomer(details, existing?.createdAt);
  const profile: CustomerProfile = { ...details, customerId, createdAt: existing?.createdAt ?? now, updatedAt: now };
  // Shown at once …
  profiles[details.primaryMobile] = profile;
  loadedMobiles.add(details.primaryMobile);
  announce();
  // … then saved; the address book's Home / Other follow once the row exists
  void writeProfile(details).then((saved) => {
    if (saved) {
      profiles[details.primaryMobile] = saved;
      announce();
      void updateAddressesFromProfile(saved);
    } else {
      void loadCustomerProfile(details.primaryMobile, true);
    }
  });
  return profile;
}

// What stops the logged-in person deleting their account (the database's my_account_delete_check())
export type AccountDeleteCheck = {
  teamRole: string | null; // "Manager", "Delivery agent" … (null: a customer)
  isOwner: boolean;
  deleteRequestedAt: string | null; // a team member already asked the admin
  hasRunningPlan: boolean;
  hasUndeliveredOrder: boolean;
};

// The "Delete account" pop-up asks first; null when it couldn't ask
export async function checkAccountDelete(): Promise<AccountDeleteCheck | null> {
  const { data, error } = await createClient().rpc("my_account_delete_check");
  if (error || !data) {
    console.error("Could not check the account", error);
    return null;
  }
  return data as AccountDeleteCheck;
}

/*
  A team member (not the owner) asks the admin to delete their account: Roles & permissions shows it beside
  their name. Answers an error message, or null when sent.
*/
export async function requestAccountDeletion(): Promise<string | null> {
  const { error } = await createClient().rpc("request_my_account_deletion");
  if (error) {
    console.error("The request was not sent", error);
    return error.code === "P0001" && error.message ? error.message : "Couldn't send the request. Check your internet and try again.";
  }
  return null;
}

// The team member takes their request back. Answers an error message, or null when done.
export async function cancelAccountDeletionRequest(): Promise<string | null> {
  const { error } = await createClient().rpc("cancel_my_account_deletion_request");
  if (error) {
    console.error("The request was not cancelled", error);
    return "Couldn't cancel the request. Check your internet and try again.";
  }
  return null;
}

/*
  Profile page → "Delete account": the database's delete_my_account() deletes the customer for good (their
  profile, addresses, "Notify me" requests and login; past orders stay for the sales records, unlinked). It
  refuses team members, a running milk plan and orders not delivered yet, with a message for the customer.
  Then this browser forgets them too (the Customers page entry, the wishlist), and the page logs them out.
  Answers an error message, or null when the account is gone.
*/
export async function deleteMyAccount(mobileNumber: string): Promise<string | null> {
  const { error } = await createClient().rpc("delete_my_account");
  if (error) {
    console.error("The account was not deleted", error);
    return error.code === "P0001" && error.message ? error.message : "Couldn't delete your account. Check your internet and try again.";
  }
  delete profiles[mobileNumber];
  customerRowIds.delete(mobileNumber);
  loadedMobiles.delete(mobileNumber);
  announce();
  removeCustomer(customerIdForMobile(mobileNumber));
  try {
    window.localStorage.removeItem("chiranvi-wishlist");
  } catch {
    // Storage blocked: nothing kept to remove.
  }
  return null;
}

/*
  Reads the logged-in customer's row again when the window comes back into focus or someone logs in, so
  a profile saved on another device (or after this tab first looked) shows here too. Without this, a tab
  that once read "no profile yet" kept showing "New customer" until it was refreshed.
*/
let isFollowingChanges = false;
function followProfileChanges() {
  if (isFollowingChanges || typeof window === "undefined") return;
  isFollowingChanges = true;
  const readAgain = async () => {
    const { data } = await createClient().auth.getSession();
    const digits = (data.session?.user.phone ?? "").replace(/\D/g, "").slice(-10);
    if (digits.length === 10) void loadCustomerProfile(digits, true);
  };
  window.addEventListener("focus", () => void readAgain());
  createClient().auth.onAuthStateChange((event) => {
    // Called from inside Supabase: the read is done just after, as Supabase advises
    if (event === "SIGNED_IN") window.setTimeout(() => void readAgain(), 0);
  });
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  followProfileChanges();
  return () => {
    listeners.delete(onChange);
  };
}

function getProfiles() {
  return profiles;
}

// The profile of this login number (read from the database the first time it is asked for)
export function useCustomerProfile(mobileNumber: string | null): CustomerProfile | null {
  useEffect(() => {
    if (mobileNumber) void loadCustomerProfile(mobileNumber);
  }, [mobileNumber]);
  const allProfiles = useSyncExternalStore(subscribe, getProfiles, () => EMPTY);
  return mobileNumber ? (allProfiles[mobileNumber] ?? null) : null;
}

// True once this number's row has been read (so pages don't show "new customer" while it is loading)
export function useIsCustomerProfileKnown(mobileNumber: string | null) {
  useSyncExternalStore(subscribe, getProfiles, () => EMPTY);
  return mobileNumber ? loadedMobiles.has(mobileNumber) : true;
}
