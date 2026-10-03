# ADR 0011: Three front doors, one authentication

- **Status:** accepted
- **Date:** 3 Oct 2026

## Context

ADAXAI has three experiences (doctor, patient, administrator) but had one generic "Sign in to ADAXAI" page for all of them, which also said "Staff and patients use the same sign-in". It was also the page on which a sign-in failure read only **"Request failed (502)"**.

Two things were wanted: a clear, separate front door for each application, and a sign-in that fails in words a person can act on. Neither may weaken the security model: roles, facility scope, consent and default-deny are enforced by the API on every request (ADR 0007), and sign-in has lockout, rate limiting and a deliberately uniform answer for bad credentials.

## Decision

### One authentication, three doors

- **One system underneath.** All three sign-in pages call the same `POST /api/auth/login`, with the same sessions, cookie, lockout (five failures lock for 15 minutes), rate limits and audit. There is no second authentication system.
- **The doors are UX, not security.** `/login` is an application selector (Doctor App, Patient App, Admin App). Each card leads to its own sign-in page: `/login/doctor`, `/login/patient`, `/login/admin`. Choosing a card grants nothing.
- **Applications and roles** are defined once, in `packages/contracts/src/auth.ts` (`APPLICATION_ROLES`):

| Application | Admits | Lands in |
| --- | --- | --- |
| Doctor App | doctor, nurse | `/doctor` or `/nurse` |
| Patient App | patient | `/patient` |
| Admin App | admin | `/admin` |

- **Decision to confirm: nurses use the Doctor App.** Doctors and nurses are both clinical staff and the brief named three applications, so the clinical door admits both and sends each to their own workspace. The sign-in page says so ("Nurses and other clinical staff sign in here too").
- **The patient door signs in by MRN and password**, as before. Activation (MRN, activation code, a chosen password) stays at `/activate`, linked from the patient door and shown in the Patient App's frame. No new patient mechanism was invented.

### The API refuses the wrong door before any session exists

`LoginRequest` gained an optional `application`. When it is named, an account whose role the application does not admit gets **403 `wrong_application`** and **no session and no cookie**.
- The check comes after the password, active-account and portal-consent checks, so the answer is reachable only with a correct password. It cannot be used to learn which usernames exist, and an unknown, inactive or wrongly-passworded account still gets the same 401 whichever application is named.
- A correct password at the wrong door clears the failed-attempt count, as a sign-in would; it is audited as a failed `auth.login` with the reason `wrong_application` and the application asked for. Wrong passwords still count toward the lockout, so the refusal is no way to guess passwords or to reset the counter without knowing one.
- The field is optional so scripts, tests and older clients keep working. It is a front-door check. The web app's sign-in also ends, at once and before anything is shown, a session that ever came back for the wrong role (a test forges such an answer), but nothing relies on that.
- Naming an application changes nothing about what a session may do. A doctor session is still refused admin data and a patient session staff data (tests pin both).

### Pages for people who are signed in

- **Signed in as another role, at a sign-in page:** a plain notice says who is signed in and in which application, with "Open my workspace" and "Sign out". The page does not silently carry the session into another application, and does not silently move the person.
- **Signed in, opening another application's page by address:** a "no access" page names the account's own application and offers "Go to my workspace" and "Sign out". It is not a silent redirect, which would hide the refusal. Between a doctor and a nurse (one application, two workspaces) it says whose page it is ("This page is for nurses"). The API refuses the data in any case.
- **Signed out, opening a page:** the sign-in page of the application the page belongs to, with `?next=`. After sign-in, `next` is honoured only if it is a page of the signed-in role's own application (`/<role>…`, `/change-password`, and `/print/…` for doctors and nurses only); anything else, including other roles' pages, off-site addresses, dot segments (also percent-encoded) and encoded slashes, is ignored and the person lands on their own home.
- **The role that signed in decides where they land.** The application chosen never overrides the role the API reports.

### Sessions

- **Unchanged:** a server-side session, an `httpOnly`, `SameSite=Lax` cookie, an idle timeout and an absolute expiry, lockout and rate limiting. No password, token or role flag is kept in browser storage.
- **A session that ends in the middle of use** (expiry, signed out elsewhere, account switched off) now shows. The first request that is refused with 401 while signed in drops everything cached for that person and sends them to their application's sign-in page with "Your session ended". The cache entry for *who is signed in* is updated in place, not removed, so a page that is showing it changes at once; this also fixes a stale "you are signed in" on a sign-in page after sign-out. A person who signs out deliberately goes to the application selector with no notice.
- **The session cookie is shared by every tab,** so a tab checks who is signed in again whenever it is looked at again: the page becomes visible, the window gets focus (switching between two visible windows fires only that), or it returns from the back/forward cache. If the person is gone (signed out in another tab) it behaves as an expired session. If a *different* person is now signed in, everything cached for the first one is dropped and **the whole page is rebuilt for the new person** (the routing guard keys the page by the person), so no data, typed text, open dialog or queued save of the first person survives, whatever the role. If the check itself fails because the service is down, the person already shown stays shown. A check that was already on its way when this page signed someone in or out, or changed a password, is dropped rather than stored over the newer state.
- **Signing out counts only when the server confirms it** (or says there was no session). If the request fails, the person is told "you are still signed in" and stays where they are, rather than being shown a sign-in page while the session cookie is still valid.
- **A hint that is only a hint:** the web app keeps in memory, for a few seconds, whether the last session ended under the person or by their own sign-out (and which application they were in). It holds nothing about them and is forgotten by a reload.

### Errors say what to do, and reveal nothing extra

`describeSignInError` maps each failure to a title, a sentence and (for service problems) a **Try again**:

| Situation | What the person sees |
| --- | --- |
| 401 | "Invalid username (or MRN) or password … if your account was switched off, contact an administrator." The API returns the same 401 for a wrong password, an unknown username, a switched-off account and a withdrawn portal consent, **on purpose**, so the page cannot say which. |
| 423 | The account is temporarily locked (the server's message: 15 minutes, or ask an administrator). Unknown usernames are locked by the same rule, so this does not reveal that an account exists. |
| 429 | The server's message ("Try again in N seconds"). |
| 403 `wrong_application` | "This account cannot use the Doctor App": choose the application for your role. |
| 502, 503, 504, a refused connection, or the dev proxy saying the API is down | "Sign-in is temporarily unavailable", with **Try again**. Never "Request failed (502)". |
| A network failure | "Cannot reach the sign-in service. Check your connection." |
| Other 5xx | "Something went wrong on our side." No code, no trace. |

The application selector also asks `GET /api/ready` (public) and shows "Sign-in service available", or "Sign-in is temporarily unavailable" with a retry, before anyone types a password.

### The 502, and the dev proxy

The "Request failed (502)" came from the **development proxy**, not from the API's authentication: the browser reached Vite on port 5173, Vite proxies `/api` to the API on port 4000, and **nothing was listening on 4000**. Vite answered with an empty 502, which the client could only describe as "Request failed (502)". Three changes follow:
- The API client treats a gateway answer with no usable body (502, 503, 504) as "service unavailable".
- The Vite proxy (development and preview only; production has no Vite proxy) answers, when the connection is refused, `503 {"error":"api_unavailable","message":"The API is not running. Start it with `npm run dev`…"}`. It logs one line with the error code and the target. Vite's own "http proxy error" log line, which carries the request URL and so any query string (a patient search term, for one), is suppressed, so no request detail is logged. The dev and preview servers also send `X-Frame-Options: DENY` and `frame-ancestors 'none'`; a production host would need the same, which this repository does not provide.
- The selector and the sign-in pages say it, with a retry.

## Consequences and limits

- **Not a second security layer.** Everything the doors do can be bypassed by calling the API directly, and the API alone decides. The `application` check is a courtesy that stops a person getting a session for the wrong door; it is not what keeps data safe.
- **"Account disabled" cannot be told apart from "wrong password"** by design (account enumeration). The page adds a generic pointer to an administrator.
- **There is no self-service password reset**, so there is no "Forgot password" link: a clinic administrator (staff), another administrator or the local reset command (administrators), or a new activation code from the clinic (patients). The page says who can help.
- **Nurses sign in at the Doctor App** and no separate nurse door exists; confirm this is wanted.
- **Existing properties of the sign-in that this slice did not change, and a reader should know:** the failed-attempt counter for usernames that do not exist is held in memory with a 10,000-entry limit, so someone able to send enough attempts to evict entries could tell, by when a lock stops, that a name did not exist; and a person who knows a username can lock that account for 15 minutes with five wrong passwords (the lock is the price of the brute-force protection).
- **Not covered:** multi-factor authentication, single sign-on, TLS (the product is local single-machine), concurrent-session limits, and any change to how patients activate.
