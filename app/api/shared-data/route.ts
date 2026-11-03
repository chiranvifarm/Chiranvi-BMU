import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mergeSharedValues } from "@/store/shared-data-merge";
import { isSharedKey } from "@/store/shared-data-sync";

/*
  The panel's remaining browser lists for every staff browser, until they move into the database too
  (store/shared-data-sync.ts): the website's own server keeps one copy, so a change in one staff browser
  reaches the others. Kept in a file next to the project (.shared-data/shared-data.json, not in Git).
  Only for logged-in team members: every request must carry the person's login (Authorization: Bearer …), and
  the database must say they are on the team (current_staff_role). Customers and visitors get nothing.
  Only the panel's remaining lists are kept; anything else in the file (copies of customers' profiles,
  orders, addresses, coupons … from before the database) is dropped and never handed out.
    GET  ?since=N   every key changed after version N (and the latest version number)
    POST {key, value, baseVersion}   saves a key; if someone else saved it after baseVersion, the two
                                     are merged by ID (see store/shared-data-merge.ts) so neither is lost
  Works while the site runs on one computer or server (npm run dev / npm start); not on serverless
  hosting, where files are not kept: that is what the database is for.
*/

type Entry = { value: string | null; version: number };
type Saved = { version: number; entries: Record<string, Entry> };

const DATA_FILE = path.join(process.cwd(), ".shared-data", "shared-data.json");

let data: Saved | null = null;

function load(): Saved {
  if (data) return data;
  try {
    data = JSON.parse(readFileSync(DATA_FILE, "utf8")) as Saved;
  } catch {
    data = { version: 0, entries: {} };
  }
  // Only the panel's remaining lists stay; earlier copies of other data are dropped from the file
  const kept = Object.fromEntries(Object.entries(data.entries).filter(([key]) => isSharedKey(key)));
  if (Object.keys(kept).length !== Object.keys(data.entries).length) {
    data = { version: data.version + 1, entries: kept };
    persist(data);
  }
  return data;
}

function persist(saved: Saved) {
  try {
    mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(saved));
  } catch {
    // Could not write the file: the data lasts until the server restarts.
  }
}

// Is the person whose login came with the request on the team? Asked to the database with their own login.
async function isTeamMember(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !supabaseUrl || !publishableKey) return false;
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/current_staff_role`, {
      method: "POST",
      headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    if (!response.ok) return false;
    const role = (await response.json()) as unknown;
    return typeof role === "string" && role !== "";
  } catch {
    return false;
  }
}

const NOT_ALLOWED = () => Response.json({ error: "Only the Chiranvi team can use this" }, { status: 403 });

export async function GET(request: Request) {
  if (!(await isTeamMember(request))) return NOT_ALLOWED();
  const since = Number(new URL(request.url).searchParams.get("since")) || 0;
  const saved = load();
  const entries = Object.entries(saved.entries)
    .filter(([key, entry]) => isSharedKey(key) && entry.version > since)
    .map(([key, entry]) => ({ key, value: entry.value, version: entry.version }));
  return Response.json({ version: saved.version, entries });
}

export async function POST(request: Request) {
  if (!(await isTeamMember(request))) return NOT_ALLOWED();
  const body = (await request.json()) as { key?: unknown; value?: unknown; baseVersion?: unknown };
  if (typeof body.key !== "string" || !isSharedKey(body.key) || (body.value !== null && typeof body.value !== "string")) {
    return Response.json({ error: "Only the panel's lists can be shared" }, { status: 400 });
  }
  const saved = load();
  const existing = saved.entries[body.key];
  const baseVersion = Number(body.baseVersion) || 0;
  // Someone saved this key after this browser last saw it: merge instead of overwriting their change
  const value =
    existing && existing.version > baseVersion && existing.value !== null && body.value !== null
      ? mergeSharedValues(body.value, existing.value)
      : (body.value as string | null);
  saved.version += 1;
  saved.entries[body.key] = { value, version: saved.version };
  persist(saved);
  return Response.json({ version: saved.version, value });
}
