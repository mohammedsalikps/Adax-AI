# MedConsult — Doctor App (Frontend Simulation)

A **frontend-only demonstration** of a connected healthcare doctor console. It shows what a
complete consultation workflow could look like, from the daily appointment queue through to a
printable prescription — using mock data held entirely in the browser.

> This is a user-interface prototype. It is **not** medical software, it does not diagnose,
> and it must not be used for patient care.

---

## What this demonstrates

The full doctor workflow, end to end:

**Today's Clinic → Patient search / registration → Patient profile → Consultation dashboard →
Transcription simulation → AI documentation draft → Doctor review → Manual diagnosis →
Manual prescription → Preview / print / share → Save → Reopen**

Screen by screen:

| Screen | Route | What it does |
| --- | --- | --- |
| Today's Clinic | `/` | Appointment queue with status, vitals flags and chief complaints |
| Find Patient | `/patients/search` | Search by name, patient ID, phone or ABHA number |
| Register Patient | `/patients/new` | Five-step intake that issues a clinic patient ID |
| Patient Profile | `/patients/:patientId` | Chart: demographics, allergies, vitals history, medications, visits |
| Consultation | `/consultation/:patientId` | Transcription, vitals, notes, diagnosis, prescription, follow-up, history |

### How the assistant works

The "AI draft" is a **deterministic text extractor**, not a model. It classifies transcript lines
by the phrases they contain and composes each draft section from those lines verbatim, recording
which lines each section came from. It cannot invent clinical content: anything the transcript
does not cover is reported as **"Not mentioned in transcript."**

It never diagnoses, never recommends treatment and never creates a prescription. Diagnoses and
medications are typed by the doctor, and every prescription row is marked **Doctor-entered**.

---

## Technology stack

| Area | Choice |
| --- | --- |
| Framework | React 19 + TypeScript (strict) |
| Build tool | Vite 8 |
| Styling | Tailwind CSS v4 (design tokens in `src/styles/index.css`) |
| Routing | React Router 7, with lazy-loaded route chunks |
| Icons | Lucide React |
| Utilities | `clsx`, `tailwind-merge`, `date-fns` |
| Linting | Oxlint |
| Persistence | Browser `localStorage` only |

No backend, no database, no API client, and no additional runtime dependencies.

---

## Getting started

Requires **Node.js 20.19+** (developed on Node 24).

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Then open the URL Vite prints (`http://localhost:5173` by default).

### All scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-check (`tsc -b`) then produce a production build in `dist/` |
| `npm run preview` | Serve the built `dist/` locally to check the production output |
| `npm run lint` | Run Oxlint over the source |

Create and check a production build:

```bash
npm run build
```

```bash
npm run preview
```

---

## Project structure

```
src/
├── app/          Shell: sidebar, topbar, providers, route fallback and error boundary
├── components/
│   ├── ui/       Design-system primitives (Button, Panel, Table, Modal, Drawer, …)
│   └── clinical/ Clinical components (VitalTile, AllergyChip, PatientIdentityCard, …)
├── features/     One folder per screen, plus the demo guide
├── hooks/        useAsyncData, useDebouncedValue, useOverlay, useDocumentTitle
├── lib/          Formatting (India locale), class merging, IDs, vitals reference ranges
├── mock/         Seed data and the repository (`db.ts`) — the only storage boundary
├── router/       Route table and lazy route definitions
├── styles/       Design tokens and the print stylesheet
└── types/        Domain model
```

Screens never touch storage directly. Everything goes through `mockDb` in `src/mock/db.ts`,
which is the single seam to replace if a real API is ever added.

---

## Demo guide and reset

The topbar has a dashed **Demo** control. It opens a drawer containing:

- **Jump to a screen** — quick links to the clinic, search, registration and an example
  consultation, resolved from the seeded records rather than hardcoded.
- **Demo workflow** — the eight steps to walk through in a presentation.
- **What is simulated** — a plain statement of what is and is not real.
- **Demo data → Reset demo data** — restores the seeded patients, appointments and
  consultations, and discards everything created during the demo (registered patients, saved
  consultations, transcripts, drafts, recorded vitals). It asks for confirmation, then reloads
  and confirms with a toast.

To clear everything manually instead, remove the key `medconsult.mockdb.v1` from the browser's
local storage and refresh. The app reseeds itself on the next load.

---

## Limitations — read before demonstrating

This is a **frontend simulation**. Specifically:

- **No backend, no database, no network calls.** All data lives in `localStorage` in one
  browser. It is not shared between browsers, devices or users, and clearing site data deletes it.
- **No authentication.** The signed-in clinician is a fixed demo persona.
- **No microphone and no speech recognition.** Transcript lines are replayed from a script on a
  timer. No audio is captured at any point.
- **No AI model.** The draft generator is a keyword-based text extractor. It under-extracts on
  phrasing it does not recognise, and by design cannot diagnose or recommend treatment.
- **No medical devices.** Vitals are mock values; recorded vitals are typed by hand.
- **No clinical decision support.** No drug-interaction checking, no allergy cross-checking, no
  dosing validation. Reference ranges colour the interface and are not a clinical aid.
- **No real patient data.** Every patient, visit, medication and consultation is fictional and
  was written for this demonstration. Any resemblance to a real person is unintended.
- **Prescriptions are not valid.** Printed output is labelled a demonstration document and must
  not be used to dispense medication.
- **Not a medical device and not regulated software.** No compliance, audit trail, retention
  policy or clinical validation of any kind.

### Development-only surfaces

Two routes exist only in development builds and are absent from `dist`:

- `/components` — the component gallery
- `/__crash-probe` — throws deliberately, to exercise the route error boundary

Neither appears in navigation. In a production build both fall through to the 404 page.

---

## Android app (Capacitor)

The same web build is wrapped in a native Android shell with
[Capacitor](https://capacitorjs.com). Nothing about the application changes — identical
routes, `localStorage` persistence, demo data, reset behaviour, safety labels and responsive
layout. It is still a frontend demonstration, now running inside a WebView.

| Setting | Value |
| --- | --- |
| App name | `Adax AI` |
| Application ID | `com.adax.ai` |
| Web assets | `dist/` (the Vite production build) |
| Native project | `android/` |
| Min / target SDK | 24 / 36 |
| Version name / code | `1.0` / `1` |

### Build workflow

Run these from the project root every time the web app changes:

```bash
npm install
```

```bash
npm run build
```

```bash
npx cap sync android
```

`npm run build` regenerates `dist/`, and `npx cap sync android` copies it into
`android/app/src/main/assets/public`. **Skipping the sync means the APK ships stale web
assets.**

Then open the native project:

```bash
npx cap open android
```

### Run on a connected phone

1. On the phone: **Settings → About phone**, tap **Build number** seven times to unlock
   Developer options, then enable **Developer options → USB debugging**.
2. Connect by USB and accept the "Allow USB debugging" prompt.
3. In Android Studio, pick the device from the target dropdown in the toolbar.
4. Press **Run ▶** (`Shift+F10`).

To confirm the device is visible:

```bash
adb devices
```

### Debug vs release APK

| | Debug APK | Signed release APK |
| --- | --- | --- |
| Signing key | Auto-generated debug key, shared by every Android SDK install | Your private keystore, unique to you |
| Purpose | Local development and testing | Distribution to other people |
| WebView debugging | Enabled (inspectable via `chrome://inspect`) | Disabled |
| Optimisation | None; debug metadata retained | Release variant; smaller, no debug metadata |
| Updates | Cannot be replaced by a release build | Only updatable by an APK signed with the same key |
| Size here | ~4.3 MB | ~3.3 MB |

Both contain the same web application and the same demonstration data.

### Debug APK

In Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

Or from the command line:

```bash
cd android && ./gradlew assembleDebug
```

Output:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

A debug APK is signed with the automatically generated debug key. It installs on any phone
with "install from unknown sources" enabled, and is the right choice for demonstrations.

### Signed release APK

Release signing is already wired into `android/app/build.gradle`. It reads credentials from
`android/keystore.properties`, which is **git-ignored** and points at a keystore stored
*outside* this repository. No password is hardcoded in any source file.

If that file and its keystore are present, a release build is signed automatically:

```bash
cd android && ./gradlew assembleRelease
```

Output:

```
android/app/build/outputs/apk/release/app-release.apk
```

If `keystore.properties` is missing, the same command still succeeds but produces an
**unsigned** APK, which Android will refuse to install. Nothing fails silently — Gradle logs a
warning when the file exists but the keystore it names does not.

#### Creating a keystore

Only needed once. A keystore is a file holding the private key that identifies you as the
publisher; every future update of the app must be signed with the *same* key.

```bash
keytool -genkeypair -v -keystore ~/.android-keystores/adax-ai-release.jks -alias adax-ai -keyalg RSA -keysize 4096 -validity 10000
```

`keytool` ships with the JDK (Android Studio bundles one at
`<Android Studio>/jbr/bin/keytool`). It will prompt for a password and for name/organisation
details. Then create `android/keystore.properties`:

```properties
storeFile=C:/Users/<you>/.android-keystores/adax-ai-release.jks
storePassword=<your store password>
keyAlias=adax-ai
keyPassword=<your key password>
```

Android Studio's **Build → Generate Signed App Bundle / APK…** wizard does the same thing
through a dialog, and can create the keystore for you.

#### Keystore safety

- **Never commit the keystore or `keystore.properties`.** Both are covered by `.gitignore`
  (`*.jks`, `*.keystore`, `android/keystore.properties`).
- **Keep the keystore outside the repository** so it cannot be added even by `git add -A`.
- **Back up the keystore and its passwords** somewhere durable, such as a password manager.
  Losing them means you can never ship an update that Android accepts as the same app — the
  only way forward is a new application ID.
- **Do not paste passwords into source files, scripts, or CI logs.** For CI, pass them as
  masked environment variables or use `~/.gradle/gradle.properties`, which lives outside the
  project.
- Treat the keystore like a private key, because that is exactly what it is.

#### Verifying a release APK

```bash
apksigner verify --verbose --print-certs android/app/build/outputs/apk/release/app-release.apk
```

`Verifies` plus at least one `true` scheme line means the APK is genuinely signed. `aapt2 dump
badging <apk>` confirms the label (`Adax AI`), package (`com.adax.ai`) and version.

### Installing the APK on Android

1. Copy the `.apk` onto the phone (see sharing below).
2. Open it with the **Files** app, or tap the download notification.
3. Android will warn that the app came from an unknown source. Grant **Allow from this
   source** / **Install unknown apps** for whichever app is opening the file — the browser,
   Files, Drive or WhatsApp — then go back and tap **Install**.
4. Play Protect may show "Unsafe app blocked" or offer to scan. This is expected for any APK
   not distributed through the Play Store; choose **Install anyway** / **More details →
   Install anyway**.
5. Launch **Adax AI** from the app drawer.

Requires Android 7.0 (API 24) or newer. Everything runs offline from bundled assets — no
server, no network and no configuration after installation.

### Sharing the APK

The debug APK is fine for demonstrations; the signed release APK is the better choice for
sending to other people. Recipients will need the unknown-sources permission described above
whichever route you use.

**WhatsApp** — attach the `.apk` as a *Document* (not an image). Some WhatsApp versions
refuse `.apk` attachments; if so, rename it to `app-release.apk.txt` before sending and have
the recipient rename it back, or use one of the options below instead.

**Google Drive** — upload the APK, then **Share → Copy link** and set the link to *Anyone with
the link*. The recipient opens the link, taps **Download**, dismisses the "file may harm your
device" warning, then opens it from notifications or the Files app.

**Email** — Gmail and most mail providers **block `.apk` attachments outright**, including
inside `.zip`. Put the file on Drive (or any file-sharing service) and email the link instead.

> **This is a frontend demonstration only.** The APK contains no backend, no database, no
> authentication, no real speech recognition, no real AI model and no medical-device
> integration. All patients, vitals, transcripts and history are fictional demonstration data
> stored in the WebView's `localStorage` on that device. It must not be used for real clinical
> work, and prescriptions and diagnoses remain doctor-entered throughout.

### Native configuration

Capacitor settings live in `capacitor.config.ts`; regenerated native values live in
`android/app/src/main/assets/capacitor.config.json` (do not edit that copy by hand). The
visible app label is `app_name` in `android/app/src/main/res/values/strings.xml`.

`android/app/src/main/res/values/colors.xml` mirrors the web design tokens so the status bar
matches the application topbar, and `styles.xml` runs the activity without an action bar. A
Capacitor WebView has no browser chrome or address bar of its own.

`android/local.properties` points Gradle at the local Android SDK. It is machine-specific;
Android Studio recreates it automatically when the project is opened.

---

## Status

Feature-complete as a demonstration. Lint and type-check are clean, the production build
succeeds, and the workflow has been verified end to end at 320 px, 375 px, 768 px, 1024 px and
desktop widths with no console errors or warnings.

The Android app has been built, installed and exercised on an emulator (Pixel-class phone at
1080x2400 / 420 dpi and a tablet profile at 1600x2560 / 240 dpi). A signed release APK is
produced by `./gradlew assembleRelease`. It has not been tested on physical hardware.
