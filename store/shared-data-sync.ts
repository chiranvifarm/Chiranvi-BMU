import { createClient } from "@/lib/supabase/client";
import { mergeSharedValues } from "./shared-data-merge";

/*
  Keeps the panel's remaining browser lists the same in every staff browser, until they move into the database
  too (round 2: the panel's own orders, deliveries, routes and agents, the staff list, scheduled reports, the
  Delivery Panel's day). Only for logged-in team members: the website's server (app/api/shared-data/route.ts)
  checks the login against the database and gives nothing to customers or visitors.
  For a team member, this file:
  - sends every save of one of those keys to the server;
  - asks the server every 2 seconds (and when the tab comes back into view) for changes made in other staff
    browsers, saves them here and tells the stores (the same "storage" event they already follow for other tabs);
  - on the first check, merges what this browser already had with the server's copy (by ID).
  In every browser it also deletes the copies of other people's data that earlier versions kept here
  (customers' profiles, orders and addresses, products, coupons, the team): those are in the database now.
  Not shared: everything else (the cart, wishlist and badges are saved with the login in the database).
*/

// The panel's lists still kept in staff browsers (round 2)
const SHARED_KEYS = new Set([
  "chiranvi-admin-orders",
  "chiranvi-admin-deliveries",
  "chiranvi-admin-routes",
  "chiranvi-admin-agents",
  "chiranvi-admin-staff",
  "chiranvi-admin-scheduled-reports",
]);
const SHARED_PREFIXES = ["chiranvi-admin-agent-day-"];

export function isSharedKey(key: string) {
  return SHARED_KEYS.has(key) || SHARED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

// Copies earlier versions kept in every browser, now in the database: deleted everywhere
const OLD_COPIES = [
  "chiranvi-customer-profiles",
  "chiranvi-orders",
  "chiranvi-products",
  "chiranvi-restock-notices",
  "chiranvi-product-categories",
  "chiranvi-product-pages",
  "chiranvi-hidden-product-pages",
  "chiranvi-staff-members",
  "chiranvi-panel-roles",
  "chiranvi-owner",
  "chiranvi-coupons",
  "chiranvi-coupon-redemptions",
];
const OLD_COPY_PREFIXES = ["chiranvi-addresses-"];
// The panel's lists that moved into the database in round 1: a team member's browser hands its copy to the
// database once (store/panel-records.ts deletes it then); anyone else's browser deletes it at once
const MOVED_PANEL_LISTS = [
  "chiranvi-admin-customers",
  "chiranvi-admin-subscriptions",
  "chiranvi-admin-subscriptions-cancelled",
  "chiranvi-admin-pause-requests",
  "chiranvi-admin-leads",
  "chiranvi-admin-complaints",
];

function deleteKeys(keys: string[], prefixes: string[] = []) {
  try {
    const all = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index) ?? "");
    for (const key of all) {
      if (keys.includes(key) || prefixes.some((prefix) => key.startsWith(prefix))) window.localStorage.removeItem(key);
    }
  } catch {
    // Storage blocked: nothing kept to delete.
  }
}

const ENDPOINT = "/api/shared-data";
const CHECK_EVERY_MS = 2000;

let lastVersion = 0;
// The server's version of each key this browser last saw (sent with a save, so the server can merge)
const keyVersions = new Map<string, number>();
let isApplyingFromServer = false;
let isSyncing = false;
let hasPatchedStorage = false;
let accessToken: string | null = null;
let checkTimer: number | null = null;

const originalSetItem = typeof window !== "undefined" ? Storage.prototype.setItem : null;
const originalRemoveItem = typeof window !== "undefined" ? Storage.prototype.removeItem : null;

function authorization(): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

// Saves a value here without sending it back, and tells the stores it changed
function applyFromServer(key: string, value: string | null) {
  if (!isSharedKey(key) || window.localStorage.getItem(key) === value) return;
  isApplyingFromServer = true;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage full or blocked: this browser keeps what it had.
  } finally {
    isApplyingFromServer = false;
  }
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: window.localStorage }));
}

async function sendToServer(key: string, value: string | null) {
  if (!isSyncing) return;
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authorization() },
      body: JSON.stringify({ key, value, baseVersion: keyVersions.get(key) ?? 0 }),
    });
    if (!response.ok) return;
    const result = (await response.json()) as { version: number; value: string | null };
    keyVersions.set(key, result.version);
    // The server merged it with another browser's change: take the merged copy
    if (result.value !== value) applyFromServer(key, result.value);
  } catch {
    // Server not reachable: the change stays in this browser and goes with its next save.
  }
}

async function checkForChanges(isFirstCheck = false) {
  if (!isSyncing) return;
  try {
    const response = await fetch(`${ENDPOINT}?since=${lastVersion}`, { cache: "no-store", headers: authorization() });
    if (!response.ok) return;
    const result = (await response.json()) as { version: number; entries: { key: string; value: string | null; version: number }[] };
    const keysOnServer = new Set<string>();
    for (const entry of result.entries) {
      if (!isSharedKey(entry.key)) continue;
      keysOnServer.add(entry.key);
      keyVersions.set(entry.key, entry.version);
      if (!isFirstCheck) {
        applyFromServer(entry.key, entry.value);
        continue;
      }
      // First visit: keep this browser's own records too (merged by ID), and send the merged copy back
      const localValue = window.localStorage.getItem(entry.key);
      if (localValue !== null && entry.value !== null && localValue !== entry.value) {
        const merged = mergeSharedValues(entry.value, localValue);
        applyFromServer(entry.key, merged);
        if (merged !== entry.value) void sendToServer(entry.key, merged);
      } else {
        applyFromServer(entry.key, entry.value);
      }
    }
    lastVersion = Math.max(lastVersion, result.version);
    if (isFirstCheck) {
      // Shared data only this browser has: send it to the server
      for (let index = 0; index < window.localStorage.length; index++) {
        const key = window.localStorage.key(index);
        if (key && isSharedKey(key) && !keysOnServer.has(key)) void sendToServer(key, window.localStorage.getItem(key));
      }
    }
  } catch {
    // Server not reachable: try again at the next check.
  }
}

// Every save of a shared key in a team member's browser also goes to the server
function patchStorage() {
  if (hasPatchedStorage || !originalSetItem || !originalRemoveItem) return;
  hasPatchedStorage = true;
  const setItem = originalSetItem;
  const removeItem = originalRemoveItem;
  Storage.prototype.setItem = function sharedSetItem(this: Storage, key: string, value: string) {
    setItem.call(this, key, value);
    if (isSyncing && this === window.localStorage && !isApplyingFromServer && isSharedKey(key)) void sendToServer(key, value);
  };
  Storage.prototype.removeItem = function sharedRemoveItem(this: Storage, key: string) {
    removeItem.call(this, key);
    if (isSyncing && this === window.localStorage && !isApplyingFromServer && isSharedKey(key)) void sendToServer(key, null);
  };
}

/*
  Who is logged in decides: a team member (any role on Roles & permissions) shares the panel's lists;
  anyone else shares nothing, and their browser deletes the panel's lists earlier versions copied into it.
*/
async function decideSyncing() {
  const supabase = createClient();
  const { data: login } = await supabase.auth.getSession();
  accessToken = login.session?.access_token ?? null;
  let isTeamMember = false;
  if (accessToken) {
    const { data } = await supabase.rpc("current_staff_role");
    isTeamMember = typeof data === "string" && data !== "";
  }
  if (!isTeamMember) {
    isSyncing = false;
    if (checkTimer !== null) window.clearInterval(checkTimer);
    checkTimer = null;
    deleteKeys([...MOVED_PANEL_LISTS, ...SHARED_KEYS], SHARED_PREFIXES);
    return;
  }
  if (isSyncing) return;
  isSyncing = true;
  patchStorage();
  void checkForChanges(true);
  checkTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") void checkForChanges();
  }, CHECK_EVERY_MS);
}

function start() {
  if (typeof window === "undefined") return;
  // Once per page, even if this file is loaded again (development reloads)
  const page = window as typeof window & { chiranviSharedDataSync?: boolean };
  if (page.chiranviSharedDataSync) return;
  page.chiranviSharedDataSync = true;
  deleteKeys(OLD_COPIES, OLD_COPY_PREFIXES);
  void decideSyncing();
  window.addEventListener("focus", () => {
    if (isSyncing) void checkForChanges();
  });
  createClient().auth.onAuthStateChange((event, session) => {
    accessToken = session?.access_token ?? null;
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") window.setTimeout(() => void decideSyncing(), 0);
  });
}

start();
