# CEEWS — Cardiac Event Early Warning System

> **AI-powered cardiac monitoring for the critical first 60 minutes**

---

## 🚨 Live Demo

**[er-cardiac-hackathon.web.app](https://er-cardiac-hackathon.web.app)**

Click **"Trigger Crash Demo"** on any patient card to simulate rapid hemodynamic collapse and watch Gemini respond with a full clinical advisory in real time.

---

## The Problem

In a busy ER, doctors managing multiple patients simultaneously can miss early warning signs of cardiac events — standard monitoring tools fire threshold-based alerts too late, after deterioration has already become a crisis. The first 60 minutes of a cardiac event are the most critical window for intervention, and detection latency is the bottleneck that costs lives. Every minute of delay in identifying a patient trending toward collapse narrows the window for a successful outcome.

---

## What CEEWS Does

CEEWS is a real-time AI dashboard that continuously monitors up to six simulated ER patients simultaneously, streaming telemetry — heart rate, blood pressure, SpO₂, and troponin — at 1.5-second intervals and computing a live risk score for each patient. When risk escalates, clinicians can trigger an AI Clinical Assessment powered by Google Gemini 2.5 Flash, which returns a structured narrative assessment plus five prioritized clinical recommendations in seconds. A unified Triage Queue ranks all patients by risk so the most critical case is always visible at a glance. Every assessment is persisted to Firebase Firestore, building a longitudinal record that doctors can annotate with free-text notes.

---

## Key Features

- **Multi-patient monitoring** — up to 6 simultaneous patients on a single dashboard
- **Real-time risk scoring (0–99)** — weighted algorithm across HR, BP, SpO₂, and troponin with trend multipliers that catch deterioration direction, not just static thresholds
- **AI Clinical Advisory** powered by Google Gemini 2.5 Flash — structured narrative assessment with 5 prioritized clinical recommendations per incident
- **Explainable AI (XAI) breakdown** — real-time bar chart showing each vital's percentage contribution to the risk score so clinicians understand every number
- **Triage Queue** — all patients ranked by current risk score, most critical always first
- **Incident History** — every AI assessment persisted to Firestore with timestamp, raw vitals, risk score, and doctor note capability
- **Vital Trend Alerts** — flags sustained deterioration across 10+ consecutive readings
- **Assessment Export** — printable clinical summary per incident
- **Crash Demo Mode** — one-click simulation of rapid hemodynamic collapse for demonstration and training

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19 + Vite |
| Styling | Tailwind CSS 4 |
| AI | Google Gemini 2.5 Flash |
| Database | Firebase Firestore (real-time) |
| Hosting | Firebase Hosting |
| Icons | Lucide React |

---

## How the Risk Score Works

The risk engine applies weighted deviations from healthy baselines with trend amplification for worsening vitals. Heart rate deviation from 75 bpm is multiplied by 1.2, and by 1.5 if the rate is rising. Systolic BP deviation from 120 mmHg is multiplied by 1.5, and by 1.8 if it is falling. Troponin elevation above the 0.10 ng/mL threshold is multiplied by 100. The sum is normalized to a 0–99 scale and categorized as **Low** (< 30), **Moderate** (30–69), or **Critical** (70+). The XAI panel shows each vital's percentage contribution so clinicians understand exactly why the system is alarmed — the score is never a black box.

---

## How Patient Data Works

Patient telemetry is fully simulated: each patient runs an independent state machine that emits new vitals every 1.5 seconds with realistic physiological noise layered on top of a baseline trajectory. The Crash Demo mode overrides a patient's trajectory into rapid hemodynamic collapse — plummeting blood pressure, spiking heart rate, falling SpO₂ — to demonstrate the full alert-to-assessment flow. In a production deployment, the telemetry engine would be replaced by HL7 FHIR API feeds or direct integrations with bedside monitor manufacturers, leaving the risk scoring, AI advisory, and persistence layers unchanged.

---

## Screenshots

![CEEWS Dashboard](dashboard.png)

---

## Built By

**Ravindranath** — MS Applied Data Science student at UMBC
Solo build · hackUMBC Mini Hackathon 2026

---

## Disclaimer

CEEWS is a proof-of-concept built at a hackathon. It is not a validated clinical tool and should not be used for actual medical decision-making.
