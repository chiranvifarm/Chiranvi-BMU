import { createPanelRecordStore } from "./panel-records";

/*
  Complaint tickets seen in the Chiranvi Panel (Refunds & complaints page, and the red count on its
  sidebar badge): customer issues, any refund given, and who is handling them. Refunds go back to the
  customer's payment method (no wallet). Kept in the database (panel_records, "refunds";
  supabase/migrations/0019_…), seen by the staff member's role (Refunds & complaints).
  The first time the panel opens the page, 96 sample tickets are copied in.
*/

export type TicketPriority = "High" | "Medium" | "Low";
export type TicketStatus = "Open" | "In progress" | "Resolved";

export type ComplaintTicket = {
  id: string; // TK-514
  raisedAt: string; // ISO date
  customerName: string;
  area: string;
  issue: string;
  orderNumber: string;
  refund: number; // 0 when there is no refund
  priority: TicketPriority;
  status: TicketStatus;
  assignedTo: string;
  resolvedAt?: string; // ISO date and time
};

export const TICKET_ISSUES = [
  "Spoiled milk",
  "Missed delivery",
  "Wrong item",
  "Late delivery",
  "Pouch leaking",
  "Short quantity",
];
export const TICKET_HANDLERS = ["Karthik N", "Divya Rao"];
export const TICKET_PRIORITIES: TicketPriority[] = ["High", "Medium", "Low"];

const sampleCustomers: [string, string][] = [
  ["Meena Iyer", "Uttarahalli"],
  ["Karthik N", "Vijayanagar"],
  ["Divya Rao", "Banashankari"],
  ["Harish Patil", "JP Nagar"],
  ["Lakshmi Devi", "RR Nagar"],
  ["Arjun Shetty", "Jayanagar"],
  ["Kavya M", "Basavanagudi"],
  ["Naveen Reddy", "Kengeri"],
  ["Sneha Kulkarni", "Uttarahalli"],
  ["Mahesh B", "Vijayanagar"],
  ["Deepa S", "Banashankari"],
  ["Rahul Jain", "JP Nagar"],
  ["Shalini K", "RR Nagar"],
  ["Vinod Kumar", "Jayanagar"],
];
const sampleRefunds = [68, 0, 45, 0, 36, 136];
const samplePriorities: TicketPriority[] = ["High", "Medium", "Low"];
const sampleStatuses: TicketStatus[] = [
  "Open",
  "In progress",
  "Resolved",
  "Resolved",
  "Open",
  "Resolved",
  "In progress",
  "Open",
  "In progress",
  "Resolved",
  "Resolved",
  "Open",
  "Resolved",
  "In progress",
];

function makeSampleTickets(): ComplaintTicket[] {
  const tickets: ComplaintTicket[] = [];
  for (let index = 0; index < 96; index++) {
    const raisedAt = new Date();
    raisedAt.setDate(raisedAt.getDate() - Math.floor(index / 5));
    raisedAt.setHours(9, 0, 0, 0);
    const [customerName, area] = sampleCustomers[index % sampleCustomers.length];
    // The newest 14 follow the design's mix; older ones are resolved
    const status = index < 14 ? sampleStatuses[index] : "Resolved";
    tickets.push({
      id: `TK-${514 - index}`,
      raisedAt: raisedAt.toISOString(),
      customerName,
      area,
      issue: TICKET_ISSUES[index % TICKET_ISSUES.length],
      orderNumber: `#CF-${2030 - index * 3}`,
      refund: sampleRefunds[index % sampleRefunds.length],
      priority: samplePriorities[index % samplePriorities.length],
      status,
      assignedTo: TICKET_HANDLERS[index % 2],
      resolvedAt: status === "Resolved" ? new Date(raisedAt.getTime() + (3 + (index % 5)) * 3600000).toISOString() : undefined,
    });
  }
  return tickets;
}

const store = createPanelRecordStore<ComplaintTicket>({
  module: "refunds",
  seed: { seedKey: "refunds", makeSamples: makeSampleTickets, oldStorageKey: "chiranvi-admin-complaints" },
});

export function updateTicket(id: string, changes: Partial<Pick<ComplaintTicket, "status" | "assignedTo" | "refund" | "priority">>) {
  void store.change(id, (ticket) => ({
    ...ticket,
    ...changes,
    resolvedAt:
      changes.status === "Resolved"
        ? new Date().toISOString()
        : changes.status
          ? undefined
          : ticket.resolvedAt,
  }));
}

export function addTicket(ticket: Omit<ComplaintTicket, "id" | "raisedAt" | "status" | "resolvedAt">) {
  const highest = Math.max(0, ...store.getRecords().map((existing) => Number(existing.id.replace(/D/g, "")) || 0));
  const newTicket: ComplaintTicket = { ...ticket, id: `TK-${highest + 1}`, raisedAt: new Date().toISOString(), status: "Open" };
  void store.add(newTicket);
  return newTicket;
}

export function useComplaintTickets() {
  return store.useRecords();
}
