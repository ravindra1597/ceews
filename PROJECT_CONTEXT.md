# CEEWS — Project Context

**Cardiac Event Early Warning System**  
Built at hackUMBC 2025 · Live at `er-cardiac-hackathon.web.app`

---

## Tech Stack

| Layer | Library | Version |
|---|---|---|
| UI framework | React | 19.2.4 |
| Build tool | Vite | 8.0.4 (with `@vitejs/plugin-react` 6.0.1) |
| Styling | Tailwind CSS | 4.2.2 (PostCSS plugin, not Vite plugin) |
| Icons | lucide-react | 1.8.0 |
| AI | `@google/genai` (Gemini) | 1.50.1 |
| Database | Firebase / Firestore | 12.12.0 |
| Hosting | Firebase Hosting (classic) | — |
| Linting | ESLint | 9.39.4 |

PostCSS config uses `@tailwindcss/postcss` — **not** the legacy `tailwindcss` Vite plugin.  
Tailwind v4 config is minimal (`tailwind.config.js` exists but has no theme extensions; all colors are inline arbitrary values).

---

## File Structure

```
ceews/
├── src/
│   ├── App.jsx          ← Entire application (single-file, ~700 lines)
│   ├── App.css          ← Unused legacy stub (safe to delete)
│   ├── index.css        ← Tailwind import + custom animations
│   ├── main.jsx         ← React 19 createRoot entry point
│   └── assets/
│       ├── hero.png
│       ├── react.svg
│       └── vite.svg
├── public/
│   ├── favicon.svg
│   └── icons.svg
├── dist/                ← Vite build output (gitignored)
├── .env                 ← VITE_GEMINI_API_KEY=... (gitignored, never commit)
├── .gitignore           ← Includes .env, .env.local, .env.*.local
├── firebase.json        ← Firebase Hosting config (serves dist/)
├── index.html           ← Vite HTML entry
├── package.json
├── postcss.config.js    ← { plugins: { '@tailwindcss/postcss': {} } }
├── tailwind.config.js   ← Empty extend (defaults only)
├── vite.config.js       ← Standard @vitejs/plugin-react config
└── PROJECT_CONTEXT.md   ← This file
```

No `components/` directory — everything lives in `src/App.jsx`.

---

## Environment Variables

| Variable | File | Purpose |
|---|---|---|
| `VITE_GEMINI_API_KEY` | `.env` | Google AI Studio key for Gemini 2.5 Flash |

The Firebase `apiKey` in `firebaseConfig` is a **public** client identifier (Firebase security is enforced via Firestore rules, not key secrecy). It is hardcoded in `App.jsx` and safe to commit.

The Gemini API key is **secret** and must stay in `.env` only. A prior key was flagged as leaked (it had been committed to source). The current key was rotated and moved to the env file.

---

## Firebase / Firestore

**Project ID:** `er-cardiac-hackathon`  
**Auth domain:** `er-cardiac-hackathon.firebaseapp.com`

### Collections

Each patient gets its own Firestore collection. The collection name is derived from the patient ID at the time of creation.

| Patient | Collection |
|---|---|
| John D. (A) | `incidents_A` |
| Maria S. (B) | `incidents_B` |
| Robert K. (C) | `incidents_C` |
| Dynamically added | `incidents_{SANITIZED_ID}` |

`SANITIZED_ID` = raw user input → `.trim().toUpperCase().replace(/\s+/g, '_')`  
Example: user enters `"ER-004"` → collection `incidents_ER-004`

### Incident Document Schema

Written by `saveAssessmentToCloud()` after every Gemini assessment:

```js
{
  text:            string,    // Gemini clinical assessment paragraph
  score:           number,    // Risk score 0–99 at time of assessment
  vitals: {
    heartRate:     number,    // bpm
    systolicBP:    number,    // mmHg
    spo2:          number,    // %
    troponin:      number,    // ng/mL (3 decimal places)
  },
  recommendations: string[],  // Parsed numbered list from Gemini, may be [] on old docs
  timestamp:       string,    // new Date().toISOString() — ISO 8601

  // Added by saveDoctorNote() — may be absent on older documents:
  doctorNote:      string,    // Free-text clinical observation
  noteTimestamp:   Timestamp, // Firestore serverTimestamp()
}
```

**Query pattern used everywhere:** `orderBy('timestamp', 'desc'), limit(10)`  
`onSnapshot` keeps results live in real time.

---

## Module-Level Constants and Helpers (outside React component)

### `INITIAL_PATIENTS` (array)
The starting roster. Each entry is a patient config object:
```js
{ id, label, name, fsCollection, baseHR, baseBP }
```
- `id` — short key used everywhere (`'A'`, `'B'`, `'C'`)
- `label` — tab display text (`'Patient A'`)
- `name` — human name (`'John D.'`)
- `fsCollection` — Firestore collection string
- `baseHR` / `baseBP` — initial vitals for telemetry seed

### `MAX_PATIENTS = 6`
Hard cap enforced in `addPatient()` and shown as "Ward Full" in the tab bar.

### `initPatient(cfg)` → patient state object
Factory that returns the full per-patient state shape with all vitals, history arrays, risk values, and empty assessments. Called when the app mounts and when a new patient is added.

### `computeRisk(vitals, prevHistory)` → `{ riskScore, riskLevel, riskBreakdown }`
Pure function (no side effects). Called inside the telemetry interval for every patient on every tick. Also called in `triggerStressTest()` to compute risk for the stress vitals before passing to Gemini.

**Algorithm:**
```
hrWeight   = |heartRate - 75| × 1.2   (×1.5 if rising trend > 5 bpm/tick)
bpWeight   = |120 - systolicBP| × 1.5 (×1.8 if falling trend > 5 mmHg/tick)
tropWeight = (troponin / 0.1) × 100
total      = hrWeight + bpWeight + tropWeight
score      = min(round((total / 300) × 100), 99)
level      = score < 30 → 'Low' | score < 70 → 'Moderate' | else → 'Critical'
breakdown  = each weight as % of total
```

### `computeTrendAlerts(history, vitals)` → `string[]`
Pure function. Analyzes the last 10 ticks (15 seconds) of telemetry data. Returns an array of alert strings if it detects continuous, strictly monotonic worsening (e.g., HR continuously rising above 100, BP falling below 90, SpO₂ falling below 94, or any continuous rise in Troponin).

### `formatTimeSince(isoString)` → `string`
Helper used primarily in the Triage Queue. Returns a human-readable string (e.g., `"45s ago"`, `"5m ago"`) for the elapsed time since the timestamp.

### `Sparkline` (React component)
SVG polyline rendering last 20 data points. Props: `data[]`, `color`, `min`, `max`.  
Height is fixed at 28px. Used for HR, BP, SpO₂ trend lines on vital cards.
Height is fixed at 28px. Used for HR, BP, and SpO₂ trend lines on vital cards.

### `getRiskConfig(level)` → style config object
Maps `'Low' | 'Moderate' | 'Critical'` to a set of Tailwind class strings and a boolean `isPulsing` flag.

```js
{
  cardBorder,   // border-* class for the risk status card
  cardBg,       // bg-* class for the risk status card background
  badgeBg,      // bg-* class for the STABLE/MODERATE RISK/CRITICAL badge
  scoreColor,   // text-* class for the score ring number
  ringColor,    // border-* class for the score ring circle
  label,        // 'STABLE' | 'MODERATE RISK' | 'CRITICAL'
  isPulsing,    // true only for Critical — enables animation classes
}
```

---

## React State Variables

All state lives inside the single `App` component.

### Core UI State

| Variable | Type | Purpose |
|---|---|---|
| `showWelcome` | `boolean` | Controls welcome/onboarding modal visibility |
| `viewMode` | `string` | Toggle between `'patient'` (detailed dashboard) and `'triage'` (ranked queue) views |
| `isLive` | `boolean` | Master switch for telemetry simulation interval |
| `activePatient` | `string` | ID of the currently viewed patient tab (`'A'`, `'B'`, etc.) |
| `showHistory` | `boolean` | Collapse/expand state of the Incident History panel |
| `expandedIncidentId` | `string \| null` | Firestore doc ID of the incident row currently expanded |
| `editingNoteId` | `string \| null` | Firestore doc ID of the incident whose Clinical Note textarea is open |
| `noteText` | `string` | Controlled value of the Clinical Note textarea |

### Dynamic Patient Roster

| Variable | Type | Purpose |
|---|---|---|
| `patientList` | `PatientConfig[]` | Ordered array of all active patient config objects. Source of truth for the tab bar and alert bar. |
| `patients` | `{ [id]: PatientState }` | Map of patient ID → all telemetry/assessment state for that patient |

**`PatientState` shape** (per patient, initialized by `initPatient()`):
```js
{
  vitals:          { heartRate, systolicBP, spo2, troponin },
  history:         { heartRate: number[20], systolicBP: number[20], spo2: number[20] },
  history:         { heartRate: number[20], systolicBP: number[20], spo2: number[20], troponin: number[20] },
  riskScore:       number,       // 0–99
  riskLevel:       string,       // 'Low' | 'Moderate' | 'Critical'
  riskBreakdown:   { hr, bp, trop },  // each as % of total risk weight
  assessments:     Assessment[],  // in-session AI assessments (not persisted between page loads)
  aiStatus:        string,        // 'idle' | 'thinking' | 'error'
  isAiThinking:    boolean,       // true while Gemini API call is in flight
  stressTestActive: boolean,      // true during the 15-second crash demo
  pastAssessments: Incident[],    // live-synced from Firestore via onSnapshot
}
```

**`Assessment` shape** (in-memory only, cleared on refresh):
```js
{ id: number, time: string, text: string, recommendations: string[], score: number, level: string }
{ id: number, time: string, text: string, recommendations: string[], score: number, level: string, vitals: object }
```

### Modal State

| Variable | Type | Purpose |
|---|---|---|
| `addModal` | `boolean` | Add Patient modal open/closed |
| `newName` | `string` | Controlled input: patient name in Add Patient modal |
| `newId` | `string` | Controlled input: patient ID in Add Patient modal |
| `idError` | `string` | Inline validation error shown in Add Patient modal (`'ID already in use'`) |
| `dischargeModal` | `string \| null` | Patient ID to discharge; null when modal is closed |

### Refs

| Ref | Type | Purpose |
|---|---|---|
| `patientListRef` | `{ current: PatientConfig[] }` | Mirror of `patientList` that the telemetry `setInterval` reads. Updated synchronously in `addPatient` and `dischargePatient` so the interval sees roster changes without needing to restart. |
| `firestoreUnsubs` | `{ current: { [id]: function } }` | Map of patient ID → Firestore `onSnapshot` unsubscribe function. Allows per-patient subscribe/unsubscribe without tearing down all listeners. |
| `advisoryEndRef` | `{ current: HTMLDivElement }` | Scroll anchor at the bottom of the AI Clinical Advisory list. Auto-scrolls to newest assessment. |

### Derived Values (computed each render, not state)

| Variable | How derived |
|---|---|
| `patientMap` | `Object.fromEntries(patientList.map(...))` — O(1) config lookup by ID |
| `p` | `patients[activePatient] ?? initPatient()` — active patient's telemetry state |
| `riskConfig` | `getRiskConfig(p.riskLevel)` |
| `latestAssessment` | `p.assessments[p.assessments.length - 1]` |
| `anyCritical` | `Object.values(patients).some(pt => pt.riskLevel === 'Critical')` |
| `criticalNames` | Names of all currently Critical patients, for the alert strip |
| `wardFull` | `patientList.length >= MAX_PATIENTS` |

---

## Major Functions

### Patient Management

**`subscribePatient(id, fsCollection)`**  
Sets up a Firestore `onSnapshot` listener for one patient's collection. Stores the unsubscribe function in `firestoreUnsubs.current[id]`. No-ops if already subscribed (idempotent).

**`unsubscribePatient(id)`**  
Calls and deletes `firestoreUnsubs.current[id]`. Safe to call even if not subscribed.

**`addPatient()`**  
Validates name + ID (non-empty, ID not in use, ward not full). Sanitizes the ID. Synchronously updates `patientListRef.current`, then calls `setPatientList`, `setPatients`, `subscribePatient`, and `setActivePatient`. Closes the modal.

**`dischargePatient(id)`**  
Synchronously removes patient from `patientListRef.current`. Calls `unsubscribePatient`. Calls `setPatientList` and `setPatients` (deletes the key with destructuring). If the discharged patient was active, switches to the first remaining patient.

### Firestore Writes

**`saveAssessmentToCloud(fsCollection, text, score, vitals, recommendations)`**  
`addDoc` to the patient's collection. Called after every successful Gemini response. Uses `new Date().toISOString()` for timestamp (not Firestore `serverTimestamp` — intentional, for consistent sorting).

**`saveDoctorNote(fsCollection, incidentId, text)`**  
`updateDoc` on an existing incident document. Adds `doctorNote` (string) and `noteTimestamp` (Firestore `serverTimestamp()`). Clears `editingNoteId` and `noteText` on success.

### AI / Gemini

**`parseGeminiResponse(text)`** → `{ assessment, recommendations }`  
Splits Gemini's raw text at `ASSESSMENT:` and `RECOMMENDATIONS:` markers. Recommendations are parsed as numbered lines matching `/^\d+[.)]\s+/`. Returns `recommendations: []` on old-format responses gracefully.

**`callGeminiAgent(patientId, currentVitals, currentRiskScore, currentRiskLevel)`**  
Async. Sets `isAiThinking: true` on the patient. Calls `gemini-2.5-flash` with a structured prompt. On success: appends to `p.assessments` and calls `saveAssessmentToCloud`. On error: sets `aiStatus: 'error'`. Always clears `isAiThinking` in both paths.  
Note: `currentRiskScore` and `currentRiskLevel` are passed explicitly to avoid stale closure values.

**`triggerStressTest()`**  
Scoped to `activePatient` at click time. Sets `stressTestActive: true`. After 3 seconds, calls `callGeminiAgent` with hardcoded critical vitals `{ HR: 165, BP: 72, SpO₂: 84, troponin: 0.18 }`. After 15 seconds, clears `stressTestActive`.

---

## UI Sections (render order)

1. **Add Patient Modal** (z-200) — Two-field form. Validates and calls `addPatient()`.
2. **Discharge Confirmation Modal** (z-200) — Confirms before calling `dischargePatient()`.
3. **Welcome Modal** (z-100) — Shown on first load. Has "Launch Dashboard" which sets `isLive: true`.
4. **Critical Alert Strip** — Visible only when `anyCritical`. Red pulsing bar naming which patient(s) are critical.
5. **Header** — CEEWS wordmark + Activity icon, "Telemetry Live" indicator (visible when `isLive`), About button, Live Feed / Stop Feed toggle.
6. **Alert Summary Bar** — Single row showing all patients' name + level + score. Background pulses red if any patient is Critical.
7. **Patient Tab Bar** — Horizontally scrollable. Each tab has a colored dot (green/amber/red, pulsing if Critical), label, name. Hover reveals `×` discharge button. "Add Patient" button or "Ward Full" pinned to the right.
8. **Main Dashboard** (scoped to `p = patients[activePatient]`):
   - **Left column (4/12):** Patient badge, Heart Rate card, Systolic BP card, SpO₂ card, Troponin T card. Each vital card has a Sparkline.
   - **Right column (8/12):**
     - Risk Status Card — large STABLE/MODERATE RISK/CRITICAL badge with `clamp()` font, score ring, Trigger Crash Demo button
     - XAI Risk Factor Breakdown — three progress bars (HR, BP, Troponin % contribution)
     - AI Clinical Advisory — scrolling list of in-session assessments with thinking skeleton
     - Clinical Recommendations — numbered list from latest assessment (conditionally shown)
9. **Incident History Panel** — Full-width collapsible. Each Firestore incident row collapses/expands. Expanded view shows: Gemini assessment text, vitals snapshot grid (red-highlighted if abnormal), recommendations list, Clinical Note (add/edit with `updateDoc`).
10. **Footer** — `CEEWS · Cardiac Event Early Warning System · Built at hackUMBC 2025`

---

## CSS / Animations (`src/index.css`)

```css
@keyframes criticalGlow          /* red box-shadow pulse — applied to the risk card */
@keyframes criticalBadgePulse    /* opacity 1 → 0.82 → 1 — applied to badges and alert bars */

.critical-card-glow              /* uses criticalGlow, 1.4s infinite */
.critical-badge-pulse            /* uses criticalBadgePulse, 1s infinite */

.scrollbar-hide                  /* hides scrollbar on the horizontal tab bar */
```

All other colors are Tailwind inline arbitrary values — no CSS variables or theme tokens.

**Key color palette:**
| Semantic | Value |
|---|---|
| Navy primary | `#0a1628` |
| Navy secondary (bars) | `#0d1f3c` |
| Critical red | `#dc2626` |
| Moderate amber | `#d97706` |
| Stable green | `#16a34a` |
| BP blue | `#2563eb` |

---

## Telemetry Simulation

- Runs on a **1500ms interval** for all active patients simultaneously.
- Each tick: HR ±2 bpm, BP ±3 mmHg, SpO₂ ±1%, troponin unchanged (unless stress test active).
- Stress test (15s): HR +5/tick, BP -4/tick, SpO₂ -1/tick, troponin +0.005/tick.
- Bounds: HR 30–∞, BP 60–∞, SpO₂ 70–100, troponin 0.01–0.20.
- History arrays are length-20 circular buffers (slice + push).
- Abnormal thresholds (card turns red): HR >110 or <50, BP >160 or <90, SpO₂ <94, troponin >0.04.

---

## Deployment

```bash
npm run build          # outputs to dist/
npx firebase-tools deploy --only hosting
```

Firebase Hosting is configured as a single-page app (all routes → `index.html`).  
Live URL: `https://er-cardiac-hackathon.web.app`

---

## Known Issues / Incomplete Items

1. **Firebase config is partially redacted** — `messagingSenderId` and `appId` are `"..."` placeholders in the committed source. The app works because Firestore doesn't require these for basic read/write, but they should be filled in for production reliability. The real values are visible in the Firebase console under Project Settings → General → Web apps.

2. **In-session assessments are not persisted across page reloads** — `p.assessments` (the AI Clinical Advisory list) is React state only. Firestore holds `pastAssessments`, but the in-memory session list resets on refresh. These are intentionally separate: Firestore holds cloud-written records, the session list is a real-time log.

3. **Firestore security rules** — Not configured in this repo. Firestore is likely running in test mode (open read/write). Before any real clinical use, rules must be written to restrict writes to authenticated users.

4. **Patient roster resets on page reload** — `patientList` is React state seeded from `INITIAL_PATIENTS`. Dynamically added patients (beyond A/B/C) are lost on refresh. Their Firestore data is retained, but the tab won't reappear. Fix: persist `patientList` to `localStorage` or a Firestore `patients` collection.

5. **No authentication** — Any user who knows the Firebase project ID can read/write all incident data. Appropriate for a hackathon demo; not for production.

6. **Gemini API key is client-side** — `import.meta.env.VITE_GEMINI_API_KEY` is embedded in the built JS bundle, visible to anyone who inspects the page. For production: proxy Gemini calls through a Cloud Function or backend.

7. **Single `isLive` toggle for all patients** — Pausing telemetry pauses all 3+ patients simultaneously. There is no per-patient pause.

8. **Troponin sparkline absent** — HR, BP, SpO₂ have `<Sparkline>` components. Troponin only has a progress bar (by design — range is narrow and less meaningful as a trend line over 20 ticks, but could be added).

9. **`ShieldCheck` icon imported but unused** — Left over from early development. Safe to remove from the lucide import.

---

## Quick Reference: Adding Features

**Add a new vital metric:**  
1. Add to `vitals` shape in `initPatient()`
2. Add history array in `history` shape
3. Update telemetry interval in the `useEffect([isLive])` block
4. Add a vital card in the Left Column JSX
5. Add to `saveAssessmentToCloud` payload and Gemini prompt

**Add a new per-patient UI section:**  
All active-patient data is accessed via `const p = patients[activePatient]`. Add your JSX anywhere in the Right Column or below the main grid.

**Add a new Firestore field to incidents:**  
Update `saveAssessmentToCloud()` to include it, and read `a.yourField` in the Incident History expanded detail JSX. Handle the field being absent on old documents with `a.yourField ?? fallback`.
