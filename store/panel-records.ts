import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";

/*
  The Chiranvi Panel's lists in the database (table panel_records, supabase/migrations/0018_…): one row per
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

type RecordRow = { id: string; data: unknown };

export type PanelRecordStore<T extends { id: string }> = {
  useRecords(): T[];
  getRecords(): T[];
  useIsLoaded(): boolean;
  add(record: T, ownerMobile?: string): Promise<boolean>;
  change(id: string, makeChange: (record: T) => T): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  reload(): Promise<void>;
};

type StoreOptions<T> = {
  module: string;
  // A record as the page uses it, from what the database keeps (old names, "days ago" from dates …)
  fromData?: (data: T) => T;
  // The page's samples, copied in once (seedKey: once per key, e.g. one day's sample deliveries)
  seed?: {
    seedKey: string;
    makeSamples: () => T[];
    oldStorageKey?: string; // the page's list as this browser kept it before the database
    ownerMobileOf?: (record: T) => string | undefined;
  };
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

function readBrowserCopy<T>(storageKey: string | undefined): T[] | null {
  if (!storageKey) return null;
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    return Array.isArray(saved) ? (saved as T[]) : null;
  } catch {
    return null;
  }
}

export function createPanelRecordStore<T extends { id: string }>(options: StoreOptions<T>): PanelRecordStore<T> {
  const EMPTY: T[] = [];
  let records: T[] = EMPTY;
  let isLoaded = false;
  let isLoading = false;
  let isFollowing = false;
  let hasTriedSeeding = false;
  const listeners = new Set<() => void>();

  function announce() {
    listeners.forEach((onChange) => onChange());
  }

  async function readRows(): Promise<RecordRow[] | null> {
    const supabase = createClient();
    const rows: RecordRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("panel_records")
        .select("id, data")
        .eq("module", options.module)
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
    if (!seed || hasTriedSeeding) return false;
    hasTriedSeeding = true;
    const samples = seed.makeSamples();
    const sampleIds = new Set(samples.map((sample) => sample.id));
    const fromBefore = readBrowserCopy<T>(seed.oldStorageKey);
    const list = fromBefore && fromBefore.length > 0 ? fromBefore : samples;
    const { data, error } = await createClient().rpc("seed_panel_records", {
      seed_key: seed.seedKey,
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
    isLoading = true;
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
    const fromData = options.fromData ?? ((data: T) => data);
    records = rows.map((row) => fromData({ ...(row.data as T), id: row.id }));
    isLoaded = true;
    if (options.seed?.oldStorageKey) forgetBrowserCopy(options.seed.oldStorageKey);
    announce();
  }

  function startFollowing() {
    if (isFollowing || typeof window === "undefined") return;
    isFollowing = true;
    void load();
    window.addEventListener("focus", () => void load());
    window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, options.refreshEveryMs ?? 60_000);
    createClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        hasTriedSeeding = false;
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
    change();
    announce();
    const { error, count } = await write();
    if (error || count === 0) {
      if (error) console.error(`The database did not accept the change to the panel's ${options.module}`, error);
      void load();
      return false;
    }
    return true;
  }

  return {
    useRecords: () => useSyncExternalStore(subscribe, () => records, () => EMPTY),
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
    change: (id, makeChange) => {
      const existing = records.find((record) => record.id === id);
      if (!existing) return Promise.resolve(false);
      const changed = makeChange(existing);
      return saveThenCheck(
        () => (records = records.map((record) => (record.id === id ? changed : record))),
        () =>
          createClient()
            .from("panel_records")
            .update({ data: changed }, { count: "exact" })
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
