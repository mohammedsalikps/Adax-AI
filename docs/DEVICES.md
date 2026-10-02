# Devices: integration boundary (no hardware integrated)

**Status: no wearable band, smart stethoscope or thermal camera has been connected to or tested
with this build.** What exists is the boundary a real integration would plug into. Nothing in the
application, seed data or demo shows device readings that did not come through that boundary.

## Hardware inventory at build time (2 Oct 2026)

Checked on the development machine (Windows 11) with `Get-PnpDevice` and `Win32_SerialPort`:

| Looked for | Found |
| --- | --- |
| Bluetooth devices paired or present | Only the laptop's own Bluetooth radio (Intel Wireless Bluetooth); no band, stethoscope or other health device |
| Audio inputs | Built-in microphone array only (no USB/Bluetooth stethoscope) |
| Serial / USB health devices | None (USB: webcam, fingerprint reader, hubs) |
| Device SDKs or vendor API credentials | None in the repository or `.env` |
| FLIR camera | None; thermal tests use public sample files (see README) |

## What is implemented

| Part | Where | Notes |
| --- | --- | --- |
| Device registry | Admin > Devices; `POST/PATCH /api/admin/devices` | Kind, make, model, serial (unique), status, integration mode: `not_integrated`, `manual_upload`, `gateway_api` |
| Assignment to a patient | Nurse > Devices; `POST /api/devices/:id/assignments`, `POST /api/device-assignments/:id/end` | Requires the patient's `device_monitoring` consent; one open assignment per device (database index); assignments can only be ended, never edited or deleted (trigger) |
| Gateway ingestion API | `POST /api/device-ingest/readings` | See contract below. Stored as observations with `source = device`, `validationStatus = device_unverified`, linked to the device; shown as "by device" |
| Gateway tokens | Admin > Devices > Issue token | Random token shown once; only its SHA-256 is stored; replace or revoke at any time; retiring a device revokes it |
| Stethoscope recordings | "Stethoscope recordings" card on the patient record and consultation; `POST /api/patients/:id/auscultations` | Upload of WAV/MP3/M4A/OGG/WebM files (for example exported from a stethoscope's own app), auscultation site, playback. No analysis |

## Gateway contract

A gateway is a separate program (phone app, bedside PC, vendor cloud bridge) that reads the device
and posts to ADAXAI:

```http
POST /api/device-ingest/readings
Authorization: Bearer adxdev_…            (token issued for that device)
x-adaxai-csrf: 1
Content-Type: application/json

{ "measuredAt": "2026-10-02T10:15:00+05:30",
  "readings": [ { "kind": "heart_rate", "value": 72 }, { "kind": "spo2", "value": 97 } ] }
```

- `kind` is one of the vital kinds in `packages/contracts/src/vitals.ts`; values outside the
  plausible range are rejected (400). Timestamps more than 5 minutes in the future are rejected.
- The patient is the one the device was **assigned to when the readings were measured**
  (`measuredAt`). The gateway never names a patient. Buffered readings sent late are therefore
  filed to the right patient, even after the device was given to someone else.
- **Refusals** (all audited, nothing stored):

  | Situation | Response |
  | --- | --- |
  | Not assigned to anyone at `measuredAt`, including before the assignment started | 409 `outside_assignment` |
  | That patient's device consent missing, withdrawn, or given after `measuredAt` | 409 `consent_required` |
  | Unknown token | 401 |
  | Retired device or wrong integration mode | 403 |
  | Too many requests for the token | 429 with `Retry-After` (`config/adaxai.yaml` → `security.rateLimits.deviceIngestPerToken`) |

  A renewal of the consent under newer wording counts as continuous consent. Withdrawing device
  consent ends the patient's device assignments at once. Changing a device's integration away
  from `gateway_api`, or retiring it, revokes its token.
- Response: `201 { "stored": n, "validationStatus": "device_unverified" }`.

## What a real integration needs

1. **The physical devices** (make and model chosen), on loan for testing.
2. **Data access**, one of:
   - standard Bluetooth LE profiles (e.g. Heart Rate Service `0x180D`, Pulse Oximeter `0x1822`,
     Health Thermometer `0x1809`) — then a gateway can read them directly;
   - the vendor's SDK or cloud API with credentials and documentation (most wearables);
   - for stethoscopes, the vendor's export format or SDK (audio sample rate, filtering, file type).
3. **A gateway** implementing the contract above, tested against the device: pairing,
   reconnection, timestamps and time zones, units, duplicate suppression, battery and signal
   quality flags.
4. **Validation** of readings against reference measurements before any reading is treated as
   anything other than `device_unverified`.

Until then, the "Devices" pages, the API and these notes are the only device features, and the
README does not claim device integration.
