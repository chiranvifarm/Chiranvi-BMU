import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";

/*
  The logged-in person's own things, kept in the database (table account_state, one row per login,
  supabase/migrations/0019_…): the cart, the milk plan waiting in it and its coupon code, the wishlist, and
  when panel pages were last opened (their "new" badges). Only that person can read or change the row, and
  it follows them to any phone or laptop. Nothing of it is kept in the browser.
  Logged out: the same things are held only in memory for the visit (e.g. a product tapped before logging in);
  after logging in, they join the saved row.
  A change shows at once and is saved a moment later (several quick changes go in one save).
*/

export type AccountState = {
  cart: unknown[];
  cartSubscription: unknown | null;
  cartCoupon: string | null;
  wishlist: unknown[];
  panelSeen: Record<string, string>;
};

const EMPTY_STATE: AccountState = { cart: [], cartSubscription: null, cartCoupon: null, wishlist: [], panelSeen: {} };

type AccountStateRow = {
  cart: unknown[];
  cart_subscription: unknown | null;
  cart_coupon: string | null;
  wishlist: unknown[];
  panel_seen: Record<string, string>;
};

let state: AccountState = EMPTY_STATE;
let userId: string | null = null;
let isLoaded = false;
let isFollowing = false;
let saveTimer: number | null = null;
// What changed since the last save. Only that is saved: an old tab (the panel, say) marking a page as seen must
// not write back the cart it still remembers, or a cart emptied by an order comes back
let changedFields = new Set<keyof AccountState>();
const listeners = new Set<() => void>();

function announce() {
  listeners.forEach((onChange) => onChange());
}

// Items kept before the login (in memory) join the saved ones: a cart line by product, a wishlist item by id
function mergeById(saved: unknown[], kept: unknown[], idOf: (item: unknown) => string) {
  const savedIds = new Set(saved.map(idOf));
  return [...saved, ...kept.filter((item) => !savedIds.has(idOf(item)))];
}

const cartLineId = (item: unknown) => String((item as { productId?: string }).productId ?? "");
const wishlistItemId = (item: unknown) => String((item as { itemId?: string }).itemId ?? "");

async function load() {
  const supabase = createClient();
  const { data: login } = await supabase.auth.getSession();
  const loggedInUserId = login.session?.user.id ?? null;
  if (!loggedInUserId) {
    // Logged out: what is in memory stays for the visit; nothing is saved
    if (userId) state = EMPTY_STATE;
    userId = null;
    isLoaded = true;
    announce();
    return;
  }
  const { data, error } = await supabase
    .from("account_state")
    .select("cart, cart_subscription, cart_coupon, wishlist, panel_seen")
    .eq("user_id", loggedInUserId)
    .maybeSingle();
  if (error) {
    console.error("Could not read the saved cart", error);
    return;
  }
  const row = data as AccountStateRow | null;
  const isNewLogin = userId !== loggedInUserId;
  const keptInMemory = isNewLogin && !userId ? state : EMPTY_STATE;
  userId = loggedInUserId;
  state = {
    cart: mergeById(row?.cart ?? [], keptInMemory.cart, cartLineId),
    cartSubscription: row?.cart_subscription ?? keptInMemory.cartSubscription,
    cartCoupon: row?.cart_coupon ?? keptInMemory.cartCoupon,
    wishlist: mergeById(row?.wishlist ?? [], keptInMemory.wishlist, wishlistItemId),
    panelSeen: row?.panel_seen ?? {},
  };
  isLoaded = true;
  announce();
  // Things kept before the login go into the saved row
  if (keptInMemory !== EMPTY_STATE) changedFields = new Set(["cart", "cartSubscription", "cartCoupon", "wishlist"]);
  if (keptInMemory !== EMPTY_STATE && (keptInMemory.cart.length > 0 || keptInMemory.wishlist.length > 0 || keptInMemory.cartSubscription)) {
    scheduleSave();
  }
}

async function save() {
  saveTimer = null;
  if (!userId) return;
  const fieldsToSave = changedFields;
  changedFields = new Set();
  const { error } = await createClient()
    .from("account_state")
    .upsert({
      user_id: userId,
      ...(fieldsToSave.has("cart") && { cart: state.cart }),
      ...(fieldsToSave.has("cartSubscription") && { cart_subscription: state.cartSubscription }),
      ...(fieldsToSave.has("cartCoupon") && { cart_coupon: state.cartCoupon }),
      ...(fieldsToSave.has("wishlist") && { wishlist: state.wishlist }),
      ...(fieldsToSave.has("panelSeen") && { panel_seen: state.panelSeen }),
    });
  if (error) {
    console.error("Could not save the cart", error);
    void load();
  }
}

function scheduleSave() {
  if (typeof window === "undefined" || !userId) return;
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void save(), 400);
}

function startFollowing() {
  if (isFollowing || typeof window === "undefined") return;
  isFollowing = true;
  void load();
  // Back to this window (the cart changed on another phone or tab): read it again, unless a save is waiting
  window.addEventListener("focus", () => {
    if (saveTimer === null) void load();
  });
  createClient().auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") window.setTimeout(() => void load(), 0);
  });
}

export function subscribeToAccountState(onChange: () => void) {
  listeners.add(onChange);
  startFollowing();
  return () => {
    listeners.delete(onChange);
  };
}

export function getAccountState() {
  return state;
}

// Changes the person's things: shown at once, saved a moment later (logged in)
export function updateAccountState(change: Partial<AccountState>) {
  state = { ...state, ...change };
  (Object.keys(change) as (keyof AccountState)[]).forEach((field) => changedFields.add(field));
  announce();
  scheduleSave();
}

// True once the saved row has been read (or nobody is logged in), so a cart isn't shown empty while it loads
export function useIsAccountStateLoaded() {
  return useSyncExternalStore(subscribeToAccountState, () => isLoaded, () => false);
}

// When this person last opened a panel page ("orders", "customers"): its "new" badge counts what came after
export function usePanelSeenAt(page: string) {
  return useSyncExternalStore(subscribeToAccountState, () => state.panelSeen[page] ?? "", () => "");
}

export function markPanelPageSeen(page: string) {
  updateAccountState({ panelSeen: { ...state.panelSeen, [page]: new Date().toISOString() } });
}
