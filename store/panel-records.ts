import { useMemo, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";

/*
  The Chiranvi Panel's lists in the database (table panel_records, supabase/migrations/0019_…): one row per
  record, by page ("module"). The database's rules decide what comes back: staff get a page's records by
  Roles & permissions (View / Create / Edit / Delete), a customer only their own (their pause requests),
  visitors nothing. So nothing of these lists is kept in the browser.
  createPanelRecordStore() gives each store the same calls it had before: read the list, add, change, remove.
  A change shows at once and is then saved; if the database refuses it, the list is read again.
  The first time someone who may see a page opens it, its sample records are copied in once (marked as
  samples) — or, if this browser still had the page's list saved from before the database, that list. After a
  successful read the old browser copy is deleted.
  Read when first needed, again when the window comes back into focus, when someone logs in or out, and every
  minute while the page is open.
*/

type RecordRow = { id: string; data: unknown; is_sample: boolean };

export type PanelRecordStore<T extends { id: string }> = {
  useRecords(): T[];
  useRealRecords(): T[]; // without the sample records
  getRecords(): T[];
  useIsLoaded(): boolean;
  add(record: T, ownerMobile?: string): Promise<boolean>;
  // ownerMobile: hand the record to another agent (deliveries, routes, agent cards)
  change(id: string, makeChange: (record: T) => T, ownerMobile?: string | null): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  reload(): Promise<void>;
};

type StoreOptions<T> = {
  module: string;
  // A record as the page uses it, from what the database keeps (old names, "days ago" from dates …)
  fromData?: (data: T) => T;
  // The page's samples, copied in once (seedKey: once per key, e.g. one day's sample deliveries)
  seed?: {
    seedKey: string | (() => string);
    makeSamples: () => T[];
    oldStorageKey?: string; // the page's list as this browser kept it before the database
    // That old copy as a list, when it wasn't kept as one (e.g. {date, staff: […]}); null: not usable
    fromOldCopy?: (saved: unknown) => T[] | null;
    ownerMobileOf?: (record: T) => string | undefined;
  };
  // Only these records, e.g. [["data->>date", today]] for today's deliveries
  filters?: () => [string, string][];
  refreshEveryMs?: number;
};

const PAGE_SIZE = 1000;

// The browser copies of the panel's lists from before the database, deleted once the database has them
export function forgetBrowserCopy(storageKey: string) {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Storage blocked: nothing to delete.
  }
}

function readBrowserCopy<T>(storageKey: string | undefined, fromOldCopy?: (saved: unknown) => T[] | null): T[] | null {
  if (!storageKey) return null;
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    if (fromOldCopy) return saved === null ? null : fromOldCopy(saved);
    return Array.isArray(saved) ? (saved as T[]) : null;
  } catch {
    return null;
  }
}

/*
  Copies of other people's data that earlier versions kept in every browser (and copied between browsers):
  - always deleted: customers' profiles, orders and addresses, products, coupons, the team (all in the
    database now);
  - the panel's lists: a team member's browser hands each list to the database once (the list's store deletes
    its copy then); anyone else's browser deletes them at once.
*/
const OLD_COPIES = [
  "chiranvi-customer-profiles", "chiranvi-orders", "chiranvi-products", "chiranvi-restock-notices",
  "chiranvi-product-categories", "chiranvi-product-pages", "chiranvi-hidden-product-pages",
  "chiranvi-staff-members", "chiranvi-panel-roles", "chiranvi-owner", "chiranvi-coupons", "chiranvi-coupon-redemptions",
  "chiranvi-notify-me",
];
const OLD_PANEL_LISTS = [
  "chiranvi-admin-customers", "chiranvi-admin-subscriptions", "chiranvi-admin-subscriptions-cancelled",
  "chiranvi-admin-pause-requests", "chiranvi-admin-leads", "chiranvi-admin-complaints", "chiranvi-admin-orders",
  "chiranvi-admin-deliveries", "chiranvi-admin-routes", "chiranvi-admin-agents", "chiranvi-admin-staff",
  "chiranvi-admin-scheduled-reports",
];

function deleteOldKeys(keys: string[], prefixes: string[]) {
  try {
    const all = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index) ?? "");
    all.filter((key) => keys.includes(key) || prefixes.some((prefix) => key.startsWith(prefix))).forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Storage blocked: nothing kept to delete.
  }
}

let hasCleanedUp = false;

async function forgetOldBrowserCopies() {
  if (hasCleanedUp || typeof window === "undefined") return;
  hasCleanedUp = true;
  deleteOldKeys(OLD_COPIES, ["chiranvi-addresses-"]);
  const supabase = createClient();
  const { data: login } = await supabase.auth.getSession();
  const { data: role } = login.session ? await supabase.rpc("current_staff_role") : { data: null };
  if (typeof role !== "string" || role === "") deleteOldKeys(OLD_PANEL_LISTS, ["chiranvi-admin-agent-day-"]);
}

export function createPanelRecordStore<T extends { id: string }>(options: StoreOptions<T>): PanelRecordStore<T> {
  const EMPTY: T[] = [];
  let records: T[] = EMPTY;
  let sampleRecordIds = new Set<string>();
  let isLoaded = false;
  let isLoading = false;
  let isFollowing = false;
  // The seed key last tried (a new day's sample deliveries have a new one)
  let triedSeedKey: string | null = null;
  // A read must not bring back old data over a change: while a change is being saved nothing is read, and a
  // read that a change overtook is done again
  let changesBeingSaved = 0;
  let changesMade = 0;
  let isReadWaiting = false;
  const listeners = new Set<() => void>();

  function announce() {
    listeners.forEach((onChange) => onChange());
  }

  async function readRows(): Promise<RecordRow[] | null> {
    const supabase = createClient();
    const rows: RecordRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      let query = supabase.from("panel_records").select("id, data, is_sample").eq("module", options.module);
      for (const [column, value] of options.filters?.() ?? []) query = query.eq(column, value);
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("sort_order")
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        console.error(`Could not read the panel's ${options.module}`, error);
        return null;
      }
      rows.push(...((data ?? []) as RecordRow[]));
      if (!data || data.length < PAGE_SIZE) return rows;
    }
  }

  // The page's samples (or this browser's list from before), copied in once by the database
  async function seedOnce() {
    const seed = options.seed;
    const seedKey = typeof seed?.seedKey === "function" ? seed.seedKey() : seed?.seedKey;
    if (!seed || !seedKey || triedSeedKey === seedKey) return false;
    triedSeedKey = seedKey;
    const samples = seed.makeSamples();
    const sampleIds = new Set(samples.map((sample) => sample.id));
    const fromBefore = readBrowserCopy<T>(seed.oldStorageKey, seed.fromOldCopy);
    const list = fromBefore && fromBefore.length > 0 ? fromBefore : samples;
    const { data, error } = await createClient().rpc("seed_panel_records", {
      seed_key: seedKey,
      module: options.module,
      records: list.map((record) => ({
        id: record.id,
        data: record,
        isSample: sampleIds.has(record.id),
        ownerMobile: seed.ownerMobileOf?.(record),
      })),
    });
    if (error) console.error(`Could not copy the panel's ${options.module} samples`, error);
    return data === true;
  }

  async function load() {
    if (isLoading) return;
    if (changesBeingSaved > 0) {
      isReadWaiting = true;
      return;
    }
    isLoading = true;
    const changesBeforeReading = changesMade;
    const { data: login } = await createClient().auth.getSession();
    if (!login.session) {
      // Logged out: nothing to show (visitors may not read these lists at all)
      isLoading = false;
      isLoaded = true;
      if (records !== EMPTY) records = EMPTY;
      announce();
      return;
    }
    let rows = await readRows();
    if (rows && rows.length === 0 && (await seedOnce())) rows = await readRows();
    isLoading = false;
    if (!rows) return;
    if (changesMade !== changesBeforeReading) {
      void load();
      return;
    }
    const fromData = options.fromData ?? ((data: T) => data);
    sampleRecordIds = new Set(rows.filter((row) => row.is_sample).map((row) => row.id));
    records = rows.map((row) => fromData({ ...(row.data as T), id: row.id }));
    isLoaded = true;
    if (options.seed?.oldStorageKey) forgetBrowserCopy(options.seed.oldStorageKey);
    announce();
  }

  function startFollowing() {
    if (isFollowing || typeof window === "undefined") return;
    isFollowing = true;
    void forgetOldBrowserCopies();
    void load();
    window.addEventListener("focus", () => void load());
    window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, options.refreshEveryMs ?? 60_000);
    createClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        triedSeedKey = null;
        window.setTimeout(() => void load(), 0);
      }
    });
  }

  function subscribe(onChange: () => void) {
    listeners.add(onChange);
    startFollowing();
    return () => {
      listeners.delete(onChange);
    };
  }

  // After a change: shown at once, then saved; the list is read again if the database refused it
  async function saveThenCheck(change: () => void, write: () => PromiseLike<{ error: unknown; count?: number | null }>) {
    changesBeingSaved += 1;
    changesMade += 1;
    change();
    announce();
    let isSaved = false;
    try {
      const { error, count } = await write();
      isSaved = !error && count !== 0;
      if (error) console.error(`The database did not accept the change to the panel's ${options.module}`, error);
    } finally {
      changesBeingSaved -= 1;
      if (!isSaved) isReadWaiting = true;
      if (isReadWaiting && changesBeingSaved === 0) {
        isReadWaiting = false;
        void load();
      }
    }
    return isSaved;
  }

  return {
    useRecords: () => useSyncExternalStore(subscribe, () => records, () => EMPTY),
    useRealRecords: () => {
      const all = useSyncExternalStore(subscribe, () => records, () => EMPTY);
      return useMemo(() => all.filter((record) => !sampleRecordIds.has(record.id)), [all]);
    },
    getRecords: () => records,
    useIsLoaded: () => useSyncExternalStore(subscribe, () => isLoaded, () => false),
    add: (record, ownerMobile) =>
      saveThenCheck(
        () => (records = [record, ...records]),
        () =>
          createClient()
            .from("panel_records")
            .insert({ module: options.module, id: record.id, data: record, owner_mobile: ownerMobile ?? null }, { count: "exact" }),
      ),
    change: (id, makeChange, ownerMobile) => {
      const existing = records.find((record) => record.id === id);
      if (!existing) return Promise.resolve(false);
      const changed = makeChange(existing);
      return saveThenCheck(
        () => (records = records.map((record) => (record.id === id ? changed : record))),
        () =>
          createClient()
            .from("panel_records")
            .update(ownerMobile === undefined ? { data: changed } : { data: changed, owner_mobile: ownerMobile }, { count: "exact" })
            .eq("module", options.module)
            .eq("id", id),
      );
    },
    remove: (id) =>
      saveThenCheck(
        () => (records = records.filter((record) => record.id !== id)),
        () => createClient().from("panel_records").delete({ count: "exact" }).eq("module", options.module).eq("id", id),
      ),
    reload: load,
  };
}
