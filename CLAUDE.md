# Chiranvi Farm website: rules for Claude

Read this whole file before doing anything in this project. Two people work on this repo at the same
time, each with their own Claude. These rules exist so neither Claude breaks or overwrites the other
person's work.

@AGENTS.md

## The project

- **Chiranvi Farm**: a dairy delivery website (milk subscriptions, one-time orders, products) plus an
  admin panel called **Chiranvi Panel** at `/admin`.
- Owner: **Hariprasath** (phone 8754852810). A teammate works on the same repo.
- Stack: **Next.js 16 (App Router), React 19, TypeScript, CSS Modules**. No UI component libraries,
  no Zod, no new npm packages unless the person you are helping explicitly asks.
- **Frontend only for now.** Data lives in browser storage (`localStorage`) through small stores in
  `store/`. The backend (Supabase) is not connected yet. See "Supabase" below.

## Who works on what (most important)

| Area | Owner | Files |
| --- | --- | --- |
| Admin panel (Chiranvi Panel) | Hariprasath | `app/admin/**`, `components/admin/**`, `store/admin-*.ts`, `store/staff-access-store.ts`, `store/panel-features.ts` |
| Product list shared by the admin and the site | Hariprasath | `store/products-store.ts`, `components/landing/best-sellers/**` |
| Teammate's area | Teammate | *(write the agreed folders here)* |

- **Only edit files in the area of the person you are helping.** If a task needs a file from someone
  else's area, **stop and ask**. Name the file and say why. Do not "just fix it".
- Files used by everyone are **shared files**. Never change them without asking first:
  `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `components/navigation/**`,
  `components/login/**`, `components/account/**`, `store/cart-store.ts`, `package.json`,
  `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`.
- **Never edit `AGENTS.md`.** `next dev` writes it automatically.

## How to work

1. **Edit only the files the person names for the task.** A component and its `.module.css` count
   only if both are named.
2. **Never create a new file or folder without asking.** Ask with: file name, where it goes, why.
   Prefer doing the work inside an existing file of the task.
3. **Don't make changes that force edits in other files.** Keep each component self-contained. If a
   change would affect another file, stop and ask, naming the files.
4. **Never design on your own.** Don't add sections, text, features or styles nobody asked for. If
   designs (Figma screenshots) are being sent, wait until the person says **"start"**.
5. **After every task, report:** each file changed, what changed, where (line numbers), old value →
   new value, and any new file created and why.
6. **CSS class names must be descriptive**, e.g. `product-card-price-label`, never `pc-pl` or `box1`.
7. Don't delete placeholder folders (`.gitkeep`), even if they look unused.
8. Match the code around you: same naming, comment style (short plain-English comments explaining
   why), and file layout.

## Folder conventions

- **Landing page:** one folder per section,
  `components/landing/<name>/<name>-section.tsx` + `<name>-section.module.css`. Anything a section
  needs (animations, helpers) stays inside its own folder. `app/page.tsx` only lists the sections.
- **Admin pages:** `components/admin/admin-<page>-page.tsx` + `.module.css`, route in
  `app/admin/<page>/page.tsx`, data in `store/admin-<thing>-store.ts`. Shared admin pieces (top bar,
  number cards, tabs, pagination, pop-ups, toast) are in `components/admin/admin-shared.tsx`. Reuse
  them; don't change them without asking (every admin page uses them).

## Design rules

- **Colours: Chiranvi only.** Greens `#1F4D2E` / `#285C3A` / `#2F6B3A`, light green `#E6F0E1`,
  yellow `#F5BF2C`, gold `#C99A1E`, light yellow `#FBF3E1`, white. **Red only for serious things**:
  errors, missed, failed, remove, emergency.
- **Fonts:** the site's fonts, not the fonts in Figma. Ubuntu for headings and big numbers, Poppins
  for everything else.
- **Admin pages:** medium size using the `--admin-pixel` unit; layout follows the Figma design, styles
  follow these rules. Calendars use the same style as the account Subscription calendar.
- **No wallet anywhere.** The business has no prepaid wallet. Never add wallet features. If a customer
  page still mentions a wallet, point it out and ask before removing it.

## Running and testing

- Start the site with `npm run dev`, then open http://localhost:3000. If a dev server is already
  running, use that one; don't start a second one.
- Before finishing, run `npx tsc --noEmit` and fix any type errors in the files you changed.
- Admin panel: log in on the site with a number that has access (owner 8754852810, or a number added
  on **Roles & permissions**), then open **Chiranvi Panel** from the account page.
- Sample data is made fresh in each browser, so each person sees their own data. That's expected.

## Git

- **Never commit or push directly to `main`.** Work on a branch:
  `git checkout main && git pull && git checkout -b <task-name>`.
- Commit and push only when the person asks. Use clear messages ("Coupons page: add coupon form").
- **Never** use `git push --force`, `git reset --hard`, or `git checkout -- <file>` on someone else's
  changes, and never delete branches you didn't create.
- Merge into `main` through a pull request on GitHub, so the other person can see the change.
- If `git pull` shows a conflict in a file from the other person's area, don't resolve it by
  guessing. Show the conflict and ask.

## Supabase (backend)

The owner is learning Supabase by writing the backend code by hand. During Supabase work, **don't
write or edit the files yourself**: give small, explained steps in the chat (what each piece does and
why) and let the person type them. Don't add Supabase code to frontend files unasked.
