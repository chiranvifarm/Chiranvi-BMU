import { useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAreAdminCustomersLoaded, useRealAdminCustomers, type AdminCustomer } from "./admin-customers-store";
import { createPanelRecordStore } from "./panel-records";

/*
  Leads: people who asked about Chiranvi from social media, the website, referrals, Google or a walk-in, and
  people who logged in on the website but haven't bought anything yet.
  Kept in the database (panel_records, "leads"; supabase/migrations/0019_…), seen on the Chiranvi Panel's
  Leads page by the staff member's role. Each lead is in one stage: New, Contacted, Free trial, Converted or Lost.
  New leads — from the panel, and from the website's bulk order and "Request delivery" forms, also by visitors
  who aren't logged in — go through the database's submit_lead(), which checks them and limits how many one
  number can send; visitors can never read leads. A website form's lead keeps the social media or Google link
  the visitor came from (sourceOfThisVisit).
  Customer leads are made when staff open the Leads page (useCustomerLeads): someone logged in without a
  completed profile (panel_logins_without_profile() in the database), then a completed profile with no order.
  They are one lead per login number: it follows the person, and their first order moves it to Converted.
  The first time the panel opens the page, 37 sample leads are copied in; the Leads page and Reports leave them out.
*/

export type LeadStage = "new" | "contacted" | "trial" | "converted" | "lost";
export type LeadSource =
  | "Instagram"
  | "Facebook"
  | "WhatsApp"
  | "YouTube"
  | "X"
  | "LinkedIn"
  | "Other social"
  | "Website"
  | "Referral"
  | "Google"
  | "Walk-in";

// Why someone is a lead, besides simply asking
export type LeadKind = "profile-incomplete" | "no-order" | "location" | "bulk";

export const LEAD_KIND_LABELS: Record<LeadKind, string> = {
  "profile-incomplete": "Profile not completed",
  "no-order": "No order yet",
  location: "Location request",
  bulk: "Bulk order",
};

export const LEAD_STAGES: { key: LeadStage; label: string }[] = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "trial", label: "Free trial" },
  { key: "converted", label: "Converted" },
  { key: "lost", label: "Lost" },
];

export const SOCIAL_SOURCES: LeadSource[] = ["Instagram", "Facebook", "WhatsApp", "YouTube", "X", "LinkedIn", "Other social"];
export const LEAD_SOURCES: LeadSource[] = [...SOCIAL_SOURCES, "Website", "Referral", "Google", "Walk-in"];

export type AdminLead = {
  id: string;
  name: string;
  phone: string; // 98861 20 410
  source: LeadSource;
  stage: LeadStage;
  createdAt: string; // ISO date
  // Small note on the card: "Call back 5 PM", "Daily Milk", "Price" ...
  note?: string;
  trialEndsAt?: string; // ISO date, for free trials
  // From the website's bulk order form ("Get a bulk quote")
  address?: string;
  email?: string;
  bulkOrderItems?: BulkOrderItem[];
  kind?: LeadKind;
  customerMobile?: string; // a customer lead: their login number, 10 digits
  isDismissed?: boolean; // a customer lead taken off the board (kept, so it isn't made again)
};

export type BulkOrderItem = { productName: string; packLabel: string; quantity: number };

const sampleLeads: [string, LeadStage, LeadSource, number, string?][] = [
  ["Anitha R", "new", "Instagram", 1],
  ["Suresh Gowda", "new", "Website", 2],
  ["Meena Iyer", "new", "Referral", 3],
  ["Karthik N", "new", "Google", 4],
  ["Divya Rao", "new", "Walk-in", 1],
  ["Harish Patil", "new", "Instagram", 2],
  ["Rekha P", "new", "Website", 3],
  ["Sanjay K", "new", "Google", 5],
  ["Pooja S", "new", "Referral", 6],
  ["Lakshmi Devi", "contacted", "Website", 2, "Call back 5 PM"],
  ["Arjun Shetty", "contacted", "Referral", 3, "Call back 5 PM"],
  ["Kavya M", "contacted", "Google", 3, "Call back 5 PM"],
  ["Naveen Reddy", "contacted", "Walk-in", 4, "Call back 5 PM"],
  ["Sneha Kulkarni", "contacted", "Instagram", 4, "Call back 5 PM"],
  ["Mahesh B", "contacted", "Website", 5, "Call back 5 PM"],
  ["Gowri T", "contacted", "Google", 6, "Call back 5 PM"],
  ["Deepa S", "trial", "Referral", 4],
  ["Rahul Jain", "trial", "Google", 5],
  ["Shalini K", "trial", "Walk-in", 6],
  ["Vinod Kumar", "trial", "Instagram", 4],
  ["Asha N", "trial", "Website", 5],
  ["Manjunath G", "converted", "Referral", 9, "Daily Milk"],
  ["Priya Sharma", "converted", "Google", 10, "Daily Milk"],
  ["Ravi Kumar", "converted", "Walk-in", 11, "Daily Milk"],
  ["Anitha R", "converted", "Instagram", 12, "Daily Milk"],
  ["Suresh Gowda", "converted", "Website", 12, "Daily Milk"],
  ["Meena Iyer", "converted", "Referral", 13, "Daily Milk"],
  ["Kiran V", "converted", "Google", 14, "Daily Milk"],
  ["Usha R", "converted", "Website", 15, "Daily Milk"],
  ["Ganesh P", "converted", "Walk-in", 15, "Daily Milk"],
  ["Latha M", "converted", "Instagram", 16, "Daily Milk"],
  ["Ramesh S", "converted", "Referral", 17, "Daily Milk"],
  ["Karthik N", "lost", "Google", 8, "Price"],
  ["Divya Rao", "lost", "Walk-in", 9, "Price"],
  ["Harish Patil", "lost", "Instagram", 10, "Price"],
  ["Lakshmi Devi", "lost", "Website", 11, "Price"],
  ["Bhavya H", "new", "Referral", 1],
];

function makeSampleLeads(): AdminLead[] {
  const now = Date.now();
  return sampleLeads.map(([name, stage, source, daysAgo, note], index) => ({
    id: `LD-${300 + index}`,
    name,
    phone: `98861 ${String(20 + ((index * 3) % 80)).padStart(2, "0")} ${String(410 + ((index * 37) % 580)).padStart(3, "0")}`,
    source,
    stage,
    createdAt: new Date(now - daysAgo * 86400000).toISOString(),
    note,
    trialEndsAt: stage === "trial" ? new Date(now + (1 + (index % 3)) * 86400000).toISOString() : undefined,
  }));
}

const store = createPanelRecordStore<AdminLead>({
  module: "leads",
  seed: { seedKey: "leads", makeSamples: makeSampleLeads, oldStorageKey: "chiranvi-admin-leads" },
});

// Leads from before kinds were saved are known by what the website's forms send
export function getLeadKind(lead: AdminLead): LeadKind | undefined {
  if (lead.kind) return lead.kind;
  if (lead.bulkOrderItems?.length) return "bulk";
  return lead.note === "Location request" ? "location" : undefined;
}

// Moving a lead keeps its note and kind; a free trial runs for three days
export function moveLead(id: string, stage: LeadStage) {
  void store.change(id, (lead) => ({
    ...lead,
    kind: getLeadKind(lead),
    stage,
    trialEndsAt: stage === "trial" ? new Date(Date.now() + 3 * 86400000).toISOString() : undefined,
  }));
}

// What gives away a link's social media: its utm_source ("?utm_source=instagram") or the site it came from
const SOURCE_SIGNS: [RegExp, LeadSource][] = [
  [/instagram|\big\b/, "Instagram"],
  [/facebook|\bfb\b/, "Facebook"],
  [/whatsapp|\bwa\.me\b/, "WhatsApp"],
  [/youtube|\byoutu\.be\b/, "YouTube"],
  [/twitter|\bx\.com\b|\bt\.co\b/, "X"],
  [/linkedin|\blnkd\.in\b/, "LinkedIn"],
  [/telegram|\bt\.me\b|snapchat|pinterest|threads|reddit|sharechat/, "Other social"],
  [/google/, "Google"],
];

function sourceOfThisVisit(): LeadSource {
  if (typeof window === "undefined") return "Website";
  const signs = `${new URLSearchParams(window.location.search).get("utm_source") ?? ""} ${document.referrer}`.toLowerCase();
  return SOURCE_SIGNS.find(([sign]) => sign.test(signs))?.[1] ?? "Website";
}

/*
  A new lead (stage New): sent to the database's submit_lead(), which gives it its number. The website's bulk
  order form also sends a note, the address, email and products. Answers the lead as sent (the panel's list
  shows it with its number once the database has it).
*/
export function addLead(lead: Pick<AdminLead, "name" | "phone" | "source"> & Partial<Pick<AdminLead, "note" | "address" | "email" | "bulkOrderItems">>) {
  // "Website" from a form: the link the visitor came from, if it shows one
  const withSource = { ...lead, source: lead.source === "Website" ? sourceOfThisVisit() : lead.source };
  const sentLead: AdminLead = { ...withSource, id: "", stage: "new", createdAt: new Date().toISOString() };
  void createClient()
    .rpc("submit_lead", { lead: withSource })
    .then(({ error }) => {
      if (error) console.error("The database did not take the lead", error);
      void store.reload();
    });
  return sentLead;
}

// A customer lead is only hidden: removed, the next visit would make it again
export function removeLead(id: string) {
  const lead = store.getRecords().find((existing) => existing.id === id);
  if (lead?.customerMobile) void store.change(id, (existing) => ({ ...existing, isDismissed: true }));
  else void store.remove(id);
}

// Real leads only: no samples, and none taken off the board (Leads page, Reports)
export function useRealAdminLeads() {
  const leads = store.useRealRecords();
  return useMemo(() => leads.filter((lead) => !lead.isDismissed), [leads]);
}

type LoginWithoutProfile = { mobile: string; logged_in_at: string };

// Who logged in without completing a profile (the database's login list; staff only)
async function readLoginsWithoutProfile() {
  const { data, error } = await createClient().rpc("panel_logins_without_profile");
  if (error) {
    console.error("Could not read the logins without a profile", error);
    return [];
  }
  return (data ?? []) as LoginWithoutProfile[];
}

function shownPhone(mobile: string) {
  return `${mobile.slice(0, 5)} ${mobile.slice(5, 7)} ${mobile.slice(7)}`;
}

// One lead per login number: made once, then it follows the person
function updateCustomerLeads(customers: AdminCustomer[], logins: LoginWithoutProfile[]) {
  const leadOf = new Map(store.getRecords().flatMap((lead) => (lead.customerMobile ? [[lead.customerMobile, lead] as const] : [])));
  const makeLead = (lead: Omit<AdminLead, "id" | "stage" | "source"> & { customerMobile: string }) =>
    void store.add({ ...lead, id: `LD-M-${lead.customerMobile}`, stage: "new", source: "Website" });

  for (const customer of customers) {
    const mobile = customer.phone.replace(/\D/g, "").slice(-10);
    if (mobile.length !== 10) continue;
    const lead = leadOf.get(mobile);
    if (customer.orderCount > 0) {
      // Their first order: the lead has turned into a customer
      if (lead && lead.stage !== "converted" && lead.stage !== "lost") {
        void store.change(lead.id, (existing) => ({ ...existing, stage: "converted", note: customer.plan, trialEndsAt: undefined }));
      }
    } else if (!lead) {
      makeLead({
        customerMobile: mobile,
        name: customer.name,
        phone: shownPhone(mobile),
        createdAt: customer.registeredAt ?? new Date().toISOString(),
        kind: "no-order",
        address: customer.profile?.primaryAddress || undefined,
        email: customer.profile?.email || undefined,
      });
    } else if (lead.kind === "profile-incomplete") {
      // They completed their profile
      void store.change(lead.id, (existing) => ({
        ...existing,
        kind: "no-order",
        name: customer.name,
        address: customer.profile?.primaryAddress || undefined,
        email: customer.profile?.email || undefined,
      }));
    }
  }

  for (const login of logins) {
    if (leadOf.has(login.mobile)) continue;
    makeLead({
      customerMobile: login.mobile,
      name: "Name not given",
      phone: shownPhone(login.mobile),
      createdAt: login.logged_in_at,
      kind: "profile-incomplete",
    });
  }
}

// The Leads page: brings the customer leads up to date (only for staff who may add leads)
export function useCustomerLeads(canAddLeads: boolean) {
  const customers = useRealAdminCustomers();
  const areCustomersLoaded = useAreAdminCustomersLoaded();
  const areLeadsLoaded = store.useIsLoaded();
  useEffect(() => {
    if (!canAddLeads || !areCustomersLoaded || !areLeadsLoaded) return;
    let isStillWanted = true;
    void readLoginsWithoutProfile().then((logins) => {
      if (isStillWanted) updateCustomerLeads(customers, logins);
    });
    return () => {
      isStillWanted = false;
    };
  }, [canAddLeads, customers, areCustomersLoaded, areLeadsLoaded]);
}
