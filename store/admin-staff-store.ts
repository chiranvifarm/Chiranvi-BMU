import { createPanelRecordStore } from "./panel-records";

/*
  The farm's team for the Chiranvi Panel's Staff page (and the Staff attendance report): job, phone, shift,
  today's attendance, days absent this month and salary. Kept in the database (panel_records, "staff";
  supabase/migrations/0019_…), seen and changed by the staff member's role (Staff); salaries never reach a
  browser that isn't allowed to see them.
  - The delivery agents are the same people as on Routes & agents (store/admin-routes-store.ts).
  - Each new day everyone starts as present, except people on leave; whoever was absent the day before
    has that day added to their days absent this month (and a new month starts from zero).
  Who can open the panel is separate: store/staff-access-store.ts (Roles & permissions).
*/

export type StaffGroup = "Delivery" | "Farm" | "Managers";
export type TodayStatus = "Present" | "Absent" | "On leave";

export type StaffPerson = {
  id: string;
  name: string;
  job: string; // "Delivery agent", "Farm worker", "Manager", ...
  group: StaffGroup;
  phone: string; // 10 digits
  shift: string; // "5 AM – 1 PM"
  salary: number; // a month
  today: TodayStatus;
  daysAbsentThisMonth: number; // before today
  statusDate?: string; // YYYY-MM-DD: the day "today" is about (an older one rolls over when read)
};

export const STAFF_JOBS: { job: string; group: StaffGroup }[] = [
  { job: "Delivery agent", group: "Delivery" },
  { job: "Driver", group: "Delivery" },
  { job: "Farm worker", group: "Farm" },
  { job: "Milking", group: "Farm" },
  { job: "Cattle care", group: "Farm" },
  { job: "Packing", group: "Farm" },
  { job: "Cleaner", group: "Farm" },
  { job: "Manager", group: "Managers" },
];

export const STAFF_SHIFTS = ["4 AM – 12 PM", "5 AM – 1 PM", "9 AM – 6 PM", "2 PM – 10 PM"];

const startingStaff: StaffPerson[] = [
  ["Ramesh K", "Delivery agent", "9741230500", "5 AM – 1 PM", 14000, "Present", 1],
  ["Shivu M", "Delivery agent", "9741233523", "5 AM – 1 PM", 14000, "Present", 2],
  ["Somu N", "Delivery agent", "9741236546", "5 AM – 1 PM", 13000, "Present", 0],
  ["Karthik N", "Manager", "9741239569", "9 AM – 6 PM", 32000, "Present", 1],
  ["Manju R", "Delivery agent", "9741242592", "5 AM – 1 PM", 14000, "Present", 3],
  ["Divya Rao", "Manager", "9741245615", "9 AM – 6 PM", 32000, "Present", 1],
  ["Raju T", "Delivery agent", "9741248638", "5 AM – 1 PM", 13000, "Present", 0],
  ["Prakash S", "Delivery agent", "9741251661", "5 AM – 1 PM", 14000, "Present", 4],
  ["Gowramma", "Cleaner", "9741254684", "9 AM – 6 PM", 10000, "Absent", 6],
  ["Ganesh B", "Delivery agent", "9741257707", "5 AM – 1 PM", 14000, "Present", 1],
  ["Nagesh H", "Farm worker", "9741260730", "4 AM – 12 PM", 13000, "Present", 0],
  ["Anil Kumar", "Manager", "9741263753", "9 AM – 6 PM", 32000, "Present", 1],
  ["Imran A", "Delivery agent", "9741266776", "5 AM – 1 PM", 14000, "Present", 2],
  ["Basava", "Driver", "9741269799", "5 AM – 1 PM", 16000, "On leave", 8],
  ["Lakshmamma", "Milking", "9741272822", "4 AM – 12 PM", 12000, "Present", 0],
  ["Venkatesh", "Farm worker", "9741275845", "4 AM – 12 PM", 13000, "Present", 1],
  ["Shankar", "Cattle care", "9741278868", "2 PM – 10 PM", 12000, "Present", 2],
  ["Mahadevi", "Packing", "9741281891", "4 AM – 12 PM", 11000, "Present", 0],
].map(([name, job, phone, shift, salary, today, daysAbsentThisMonth], index) => ({
  id: `ST-${index + 1}`,
  name: name as string,
  job: job as string,
  group: STAFF_JOBS.find((staffJob) => staffJob.job === job)?.group ?? "Farm",
  phone: phone as string,
  shift: shift as string,
  salary: salary as number,
  today: today as TodayStatus,
  daysAbsentThisMonth: daysAbsentThisMonth as number,
}));

function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// A new day: yesterday's absences are counted, everyone not on leave starts as present (a new month from zero)
function onToday(person: StaffPerson): StaffPerson {
  const date = todayKey();
  const statusDate = person.statusDate ?? date;
  if (statusDate === date) return { ...person, statusDate };
  const isNewMonth = statusDate.slice(0, 7) !== date.slice(0, 7);
  return {
    ...person,
    statusDate: date,
    daysAbsentThisMonth: isNewMonth ? 0 : person.daysAbsentThisMonth + (person.today === "Present" ? 0 : 1),
    today: person.today === "On leave" ? "On leave" : "Present",
  };
}

const store = createPanelRecordStore<StaffPerson>({
  module: "staff",
  fromData: onToday,
  seed: {
    seedKey: "staff",
    makeSamples: () => startingStaff.map((person) => ({ ...person, statusDate: todayKey() })),
    oldStorageKey: "chiranvi-admin-staff",
    // This browser kept {date, staff: […]}
    fromOldCopy: (saved) => {
      const old = saved as { date?: string; staff?: StaffPerson[] };
      return Array.isArray(old.staff) ? old.staff.map((person) => ({ ...person, statusDate: old.date })) : null;
    },
  },
});

// Changes are saved with today's roll-over (so yesterday's absence is counted once)
function changePerson(id: string, change: (person: StaffPerson) => StaffPerson) {
  void store.change(id, (person) => change(onToday(person)));
}

export function setTodayStatus(id: string, today: TodayStatus) {
  changePerson(id, (person) => ({ ...person, today }));
}

export function updateStaffPerson(id: string, changes: Partial<Pick<StaffPerson, "job" | "group" | "phone" | "shift" | "salary">>) {
  changePerson(id, (person) => ({ ...person, ...changes }));
}

export function addStaffPerson(person: Pick<StaffPerson, "name" | "job" | "group" | "phone" | "shift" | "salary">) {
  const highest = Math.max(0, ...store.getRecords().map((existing) => Number(existing.id.replace(/D/g, "")) || 0));
  const newPerson: StaffPerson = { ...person, id: `ST-${highest + 1}`, today: "Present", daysAbsentThisMonth: 0, statusDate: todayKey() };
  void store.add(newPerson);
  return newPerson;
}

export function removeStaffPerson(id: string) {
  void store.remove(id);
}

// Days present this month so far, counting today if present
export function getDaysPresent(person: StaffPerson, date = new Date()) {
  const daysSoFar = date.getDate();
  return Math.max(0, daysSoFar - person.daysAbsentThisMonth - (person.today === "Present" ? 0 : 1));
}

export function useStaffList() {
  return store.useRecords();
}
