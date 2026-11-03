import { createClient } from "@/lib/supabase/client";
import { createPanelRecordStore } from "./panel-records";

/*
  Leads: people who asked about Chiranvi from Instagram, the website, referrals, Google or a walk-in.
  Kept in the database (panel_records, "leads"; supabase/migrations/0019_…), seen on the Chiranvi Panel's
  Leads page by the staff member's role. Each lead is in one stage: New, Contacted, Free trial, Converted or Lost.
  New leads — from the panel, and from the website's bulk order and "Request delivery" forms, also by visitors
  who aren't logged in — go through the database's submit_lead(), which checks them and limits how many one
  number can send; visitors can never read leads.
  The first time the panel opens the page, 37 sample leads are copied in.
*/

export type LeadStage = "new" | "contacted" | "trial" | "converted" | "lost";
export type LeadSource = "Instagram" | "Website" | "Referral" | "Google" | "Walk-in";

export const LEAD_STAGES: { key: LeadStage; label: string }[] = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "trial", label: "Free trial" },
  { key: "converted", label: "Converted" },
  { key: "lost", label: "Lost" },
];

export const LEAD_SOURCES: LeadSource[] = ["Instagram", "Website", "Referral", "Google", "Walk-in"];

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

// Moving a lead sets the note that stage shows on its card
export function moveLead(id: string, stage: LeadStage) {
  const notes: Partial<Record<LeadStage, string>> = { contacted: "Call back 5 PM", converted: "Daily Milk", lost: "Price" };
  void store.change(id, (lead) => ({
    ...lead,
    stage,
    note: notes[stage],
    trialEndsAt: stage === "trial" ? new Date(Date.now() + 3 * 86400000).toISOString() : undefined,
  }));
}

/*
  A new lead (stage New): sent to the database's submit_lead(), which gives it its number. The website's bulk
  order form also sends a note, the address, email and products. Answers the lead as sent (the panel's list
  shows it with its number once the database has it).
*/
export function addLead(lead: Pick<AdminLead, "name" | "phone" | "source"> & Partial<Pick<AdminLead, "note" | "address" | "email" | "bulkOrderItems">>) {
  const sentLead: AdminLead = { ...lead, id: "", stage: "new", createdAt: new Date().toISOString() };
  void createClient()
    .rpc("submit_lead", { lead })
    .then(({ error }) => {
      if (error) console.error("The database did not take the lead", error);
      void store.reload();
    });
  return sentLead;
}

export function removeLead(id: string) {
  void store.remove(id);
}

export function useAdminLeads() {
  return store.useRecords();
}
