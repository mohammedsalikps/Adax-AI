# ADAXAI design system

How the product looks and why. It was introduced in slice 4 (appointments) together with the
first screens built on it: the application shell, the doctor's Home and the appointment pages. The
other screens inherit the tokens (colour, radius, type, control sizes) but have **not** been
redesigned; see [What is and is not covered](#what-is-and-is-not-covered).

The reference was a premium clinical “Doctor App” mock-up: clean white and neutral surfaces, one
restrained blue, soft borders, rounded cards, readable type, little clutter, no heavy gradients or
animation. Its sample data and controls were **not** copied: every control in the product exists
because the product can do it.

## 1. Audit of the previous UI against the reference

| Area | Before | Reference | Done |
| --- | --- | --- | --- |
| Colour | Teal brand, cool grey canvas | Restrained blue, white cards | Blue brand token (`#2563eb`), cool near-white canvas; favicon, icons and theme colour changed to match |
| Type | System stack, default scale | Modern readable sans | Modern system stack (Segoe UI Variable, SF, Roboto, Inter if installed) with a named scale; see the font note below |
| Shell | Top bar with a flat left list, role chip, no search, no avatar | Sidebar with icons, top bar with search and profile | `AppShell`: sidebar, top bar with patient search, avatar, role, department and clinic, sign out |
| Landing | The doctor landed on the queue | Dashboard: four numbers, schedule, quick actions | Doctor **Home**: four real counts, today's schedule, patients ready, shortcuts |
| Schedule | Stack of cards | Table with status chips, search, date | `AppointmentTable` (table on wide screens, cards on phones), status filter with counts, device-side search, scopes and a date |
| Cards | 12px radius, no elevation | Rounded, soft border | 16px radius, hairline border, near-invisible shadow |
| States | Spinner, bare alerts, no retry on most lists | n/a (a static mock-up) | Loading placeholders, empty with an icon and a next step, failure with **Try again**, refusal without a retry |
| Dialogs | One generic dialog, toasts that appear behind a modal | n/a | One dialog; `ConfirmationDialog` for cancel / did-not-attend; results inside a dialog are shown inside it |
| Phone | Menu list under the header | n/a | Drawer with its own close button, focus handling and an inert page behind |

**Font note.** No web font is bundled. A font file would be a new dependency and, unless
self-hosted, a request to a third party from a clinical app; the system stack renders a modern
sans everywhere and works offline. The cost is that the face differs by device. If a single face
is wanted, self-host a variable font under `apps/web/public/fonts` with `font-src 'self'` and put
it first in `--font-sans`; nothing else changes.

## 2. Tokens

Defined once in [`apps/web/src/styles.css`](../apps/web/src/styles.css) (Tailwind 4 `@theme`).
The shell and the components added with it use the names. Older pages still contain some raw
sizes (`min-h-11`, `text-[10px]`) that match the tokens in value; they move over as each is touched.

| Group | Tokens |
| --- | --- |
| Surfaces | `canvas #f5f7fb` (page), `surface #fff` (cards, bars), `line #e3e8ef` (dividers, card edges), `line-strong #cbd5e1` (buttons) |
| Controls | `control #7c8ba1`: the edge of inputs, selects and text areas (3.4:1 on white, 3.2:1 on the canvas, WCAG 1.4.11 non-text contrast) |
| Text | `ink #0f172a`, `ink-muted #475569` (7.6:1 on white) |
| Brand | `brand #2563eb` (5.2:1 with white text), `brand-strong #1d4ed8` (hover, link text), `brand-soft #eff6ff` (selected, tints) |
| Status | `ok`, `pending`, `down #b91c1c`, `notice`: each an ink with a `-soft` tint; **always** shown with a label (and an icon or dot), never colour alone |
| AI | `ai` / `ai-soft` (violet): reserved for AI-generated draft content, so it is never mistaken for a signed record |
| Type | `xs 12/16`, `sm 14/20`, `base 16/24`, `lg 18/28`, `xl 20/28`, `2xl 24/32` (page titles), `stat 30/36` (numbers) |
| Spacing | Tailwind's 4px scale |
| Radius | `sm 6`, `md 8` (controls), `lg 12`, `xl 16` (cards), `2xl 20` (dialogs) |
| Elevation | `shadow-card` (hairline), `shadow-pop` (dialogs, drawer) |
| Sizes | `control 44px`, `control-sm 36px` (touch targets), `row 72px`, `row-compact 56px` (minimum schedule row heights), `sidebar 256px`, `topbar 64px` |
| Icons | 16px inline with text, 20px in navigation and tiles, 24px for the menu; always `aria-hidden` beside a text label |
| Focus | One ring everywhere: 2px `brand` outline, 2px offset (`:focus-visible`) |
| Motion | None beyond a 180ms settle, a spinner and a loading pulse. `prefers-reduced-motion` limits every animation to one instant cycle (they stop), and smooth scrolling is off |

## 3. Components

Where the brief's name differs from the code's, the code's name stays (renaming would churn every
page for no gain). Components exist only where a screen uses them.

| Brief | Implementation | Notes |
| --- | --- | --- |
| AppShell, Sidebar, TopBar | `components/shell/AppShell`, `Sidebar`, `TopBar`; route element `PortalLayout` | One shell for all four roles. Pages per role in `lib/nav.ts`. Patient search for doctors and nurses only |
| PageHeader | `ui/Layout` `PageHeader` | Title, one-line description, actions |
| StatCard | `ui/Layout` `StatCard` | An icon tile, a label, a number, a hint. Shows a dash (never a zero) while loading or failed |
| PatientAvatar | `ui/PatientAvatar` | Initials only: the product holds no photographs. Hidden from assistive technology (a name is always beside it) |
| StatusBadge | `ui/Feedback` `Badge` (with `dot`), `AppointmentStatusBadge`, `VisitStatusBadge` | The existing `StatusBadge` is the service-health pill on the admin overview |
| AppointmentTable | `components/clinical/AppointmentTable` | See below |
| PatientProfilePanel | **not built** | A side panel would repeat the patient banner and the appointment's details dialog. Revisit with the consultation workspace |
| SectionCard | `ui/Layout` `Card` | Its title names the region for assistive technology |
| EmptyState, LoadingState, ErrorState | `ui/Feedback` | `ErrorState` offers **Try again**, except for a refusal (403), which says so and offers nothing to retry |
| ConfirmationDialog | `ui/ConfirmationDialog` | Says what will happen, offers “keep it” first, can ask for a reason, shows failures inside the dialog, cannot be dismissed while the request is in flight |
| FormField | `ui/Form` `Field`, `TextField`, `SelectField`, `TextAreaField` | Label, hint, error and `aria-describedby` wired once |
| Primary / SecondaryButton | `ui/Button` variants `primary`, `secondary`, `danger`, `ghost` | One component, four variants, two sizes |
| (new) SegmentedControl | `ui/SegmentedControl` | A short row of exclusive choices; each is a toggle button with a pressed state |

**AppointmentTable.** A list of rows styled as a table (a grid with a decorative header) from the
`xl` breakpoint (1280px, where the content is about 960px wide) and as stacked cards below it, so
there is one structure at every width and the columns always line up with the header. On the
doctor's Home the schedule has the full content width until 1536px, and shares it with a side
column only above that. Each
row carries its time and length, the patient (avatar, name, MRN, reason), the clinician and
department, the status with any flags, the linked visit, and **Check in** when the server allows
it. Everything else (reschedule, cancel, did not attend, history, messages) is in **Details**: the
destructive actions are one deliberate step away. The row shows no “patient not told” flag for the
normal case (a patient without portal access); it flags a cancellation the patient may not know
about and a message that failed.

## 4. The doctor app's information architecture, as built

| Brief | Built | Why / why not |
| --- | --- | --- |
| Sidebar: Home | **Home** | Real data only |
| Patients | **Patients** | |
| Today's Schedule | **Appointments** (scopes: today, upcoming, past, a date) and **Today's schedule** on Home | One page, not two |
| Consultations | **My consultations** | |
| Reports | not built | There is no reporting feature; a link would be a fake control |
| Mana AI | not a page | Mana answers about one patient's record, so it lives on the patient record and in the consultation. A stand-alone page would have no patient to ask about |
| Settings | not built | There are no user settings. **Change password** is at the bottom of the sidebar |
| (existing) | **OPD queue**, **Thermal**, **AI review** | Kept |
| Top bar: patient search | Yes, for doctors and nurses | Submitting opens the Patients page with the term in the router state: not in the address, a shared link, the referrer or a server log; the page takes it once and clears it from the history entry, so a reload or Back does not repeat the (audited) search. Nothing is searched until it is submitted. Two characters at least |
| Notifications | not built | Staff have no notifications; the outbox is for patients |
| Doctor, role, facility | Yes | Name, role, department and clinic (from `/api/auth/me`) |
| Dashboard: Total in queue / Ongoing / Completed / Upcoming | **In the queue**, **With a doctor**, **Completed today**, **Appointments to come** | Counted from today's queue and schedule, for the doctor's own patients |
| Quick actions | Four links | Only to pages that exist |
| Consultation workspace (transcription, live device readings, notes, AI summary) | **Not part of this slice** | The consultation page keeps its current layout, with the new tokens. Its redesign (clear connected / stale / simulated states for devices, AI content visibly draft-only) is the recommended next slice |

## 4a. The front door and sign-in pages

The first thing anyone sees (`/login`) and the three sign-in pages share one frame and the same
tokens; they set the look future applications inherit.

| Component | Where | Role |
| --- | --- | --- |
| `AuthShell`, `AuthHeader`, `BackToApplications` | `components/auth/AuthShell` | The frame of every signed-out page (also activation and the password change): skip link, product mark, development notice; the heading with the application badge and one line; the way back |
| `ApplicationCard` | `components/auth/ApplicationCard` | One application on the selector: who it is for, what it really offers (only features that exist), one button-styled link. The description is guidance, never a permission |
| `ApplicationBadge`, `appStyle` | `components/auth/` | Names the application ("Doctor App") on its pages: an icon, a tint and an accent line from the tokens (blue for clinical work, green for the patient's space, ink for administration) |
| `LoginForm` | `components/auth/LoginForm` | The sign-in form of one application: labelled fields, a loading state, retry, forgotten-password help (who can reset it; there is no self-service reset) |
| `PasswordField` | `components/auth/PasswordField` | Password with a show/hide toggle (a button with a pressed state) |
| `ErrorBanner` | `components/auth/ErrorBanner` | A sign-in problem announced at once: a title, a sentence that helps, and **Try again** when the problem is the service |
| `ServiceStatus` | `components/auth/ServiceStatus` | "Sign-in service available", or unavailable with a retry, from the public `/api/ready` |
| `SignedInNotice`, `NoAccessPage` | `components/auth/`, `pages/NoAccessPage` | Someone signed in as another role at a sign-in page, or opening another application's address: said plainly, with their own workspace and sign-out, never a silent move |

Behaviour rules for these pages: errors never show a code or a trace and never say which usernames
exist; a banner for a service problem offers a retry and a refusal does not; the selector stacks to
one column below 768px, and every control is at least 44px; keyboard order is skip link, way back,
fields, password toggle, Sign in. Verified in Chromium at 1440 × 900, 1280 × 800, 1024 × 768 and
390 × 844 (see [STATUS.md](STATUS.md)).

## 5. Rules the screens follow

- **No fake controls.** A control appears only if the product can do it.
- **Clinical safety is visible.** AI content is violet and labelled as a draft; the signed record
  is not styled like it. The development banner stays on every page.
- **Nothing succeeds silently or falsely.** Success messages say what happened; where a patient
  could not be told, the message says so.
- **Destructive actions are confirmed**, with a reason where the record needs one.
- **Times are the clinic's.** The API sends a day and a clock time; the browser's timezone is
  never used for an appointment. Instants (history, message times) are shown on the clinic's
  timezone, which the API supplies with them.
- **Every list has five states:** loading, empty, populated, failed (with retry) and refused.
- **Accessibility.** Landmarks (skip link, banner note, navigation, search, main), one `h1`,
  labelled regions, visible focus, a scroll margin under the sticky top bar, 44px targets (36px
  in dense rows), form-control edges at 3:1, status never by colour alone,
  `prefers-reduced-motion`, a drawer that manages focus (in on open; back to the menu button, or
  to the new page, on close) and makes the page behind it, and the skip link, inert. A dialog
  with a request in flight cannot be closed, even by a repeated Escape, and when one dialog
  replaces another (Details, then Reschedule) focus returns to what opened the first. The drawer
  also stops the page behind it from scrolling. The e2e suite runs axe
  (WCAG 2.2 A and AA rules that axe can test; it does not test non-text contrast, focus order or
  screen-reader output) and a horizontal-overflow check on the screens listed in section 6.
- **Responsive.** Desktop first; below 1024px the sidebar becomes a drawer and the search moves
  under the top bar; below 1280px the schedule's rows stack as cards; the side column of Home
  appears from 1536px.

## 6. Verification, and what was not verified

Done, in headless Chromium against the disposable end-to-end stack:

- Screenshots reviewed by hand at **1440 × 900** and **390 × 844** (a phone), plus the suite's own
  **1280 × 720** desktop and **412 × 915** phone projects. Screens: doctor Home (empty and with
  data), appointments (today, upcoming, search with no match, status filter with no match),
  detail, cancel confirmation with a validation error, booking with patient results, the OPD queue,
  a patient record, the loading, failed and refused schedule, the nurse queue, the administrator's
  redacted schedule, the patient portal's appointments, and the open phone menu.
- Automated: axe and overflow checks in `e2e/appointments.spec.ts` and `e2e/doctor-home.spec.ts`
  (Home, schedule, details, the portal, the administrator's view, the failed and refused states),
  and the drawer's focus, Escape, inert and close behaviour.

Not done: Firefox and Safari, real phones or tablets, a screen reader by hand, Windows high
contrast, browser zoom beyond the default, print styles for the new pages, and a dark theme (there
is none).

## 7. What is and is not covered

**Redesigned:** the application shell (all roles), the doctor's Home, the appointment pages and
dialogs (staff and patient portal), the shared controls and states.

**Re-coloured and re-rounded by the tokens, otherwise unchanged:** every other page, including the
queue (which gained the segmented control), the patient record, the consultation, thermal, AI
review, devices and the administrator's pages. They were not audited screen by screen; expect
details (spacing, tables, older alert styles) to be uneven until each slice reaches them.
