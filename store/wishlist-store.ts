import { useSyncExternalStore } from "react";
import { getAccountState, subscribeToAccountState, updateAccountState } from "./account-state";

/*
  Wishlist: the products hearted on the All products page, shown on the account's "Wishlist" page.
  Each item keeps what that page needs (so it still shows if the product changes later). Kept with the
  customer's login in the database (store/account-state.ts), so it follows them to any phone or laptop;
  nothing is kept in the browser. A wishlist kept in this browser before the database is moved in once.
*/

export type WishlistItem = {
  itemId: string; // the card's id: "<slug>" or "<slug>-<packId>"
  slug: string; // product page: /products/<slug>
  name: string;
  packLabel: string; // "1 litre"
  price: number;
  originalPrice?: number;
  imageSource: string;
  imageWidth: number;
  imageHeight: number;
};

const emptyWishlist: WishlistItem[] = [];
const OLD_STORAGE_KEY = "chiranvi-wishlist";
let hasMovedOldWishlist = false;

// The browser's wishlist from before the database: moved into the saved one once, then deleted
function moveOldBrowserWishlist() {
  if (hasMovedOldWishlist || typeof window === "undefined") return;
  hasMovedOldWishlist = true;
  try {
    const saved = JSON.parse(window.localStorage.getItem(OLD_STORAGE_KEY) ?? "null");
    if (Array.isArray(saved) && saved.length > 0 && getAccountState().wishlist.length === 0) updateAccountState({ wishlist: saved });
    window.localStorage.removeItem(OLD_STORAGE_KEY);
  } catch {
    // Storage blocked or unreadable: nothing to move.
  }
}

function getWishlist() {
  return getAccountState().wishlist as WishlistItem[];
}

function subscribe(onChange: () => void) {
  moveOldBrowserWishlist();
  return subscribeToAccountState(onChange);
}

export function useWishlist() {
  return useSyncExternalStore(subscribe, getWishlist, () => emptyWishlist);
}

// Heart: adds the item, or takes it out when it is already there
export function toggleWishlistItem(item: WishlistItem) {
  const items = getWishlist();
  updateAccountState({
    wishlist: items.some((saved) => saved.itemId === item.itemId) ? items.filter((saved) => saved.itemId !== item.itemId) : [...items, item],
  });
}

export function removeWishlistItem(itemId: string) {
  updateAccountState({ wishlist: getWishlist().filter((saved) => saved.itemId !== itemId) });
}
