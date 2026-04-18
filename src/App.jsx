import { useState, useEffect, useRef } from 'react';
import { Activity, ShieldCheck, User, Stethoscope, Clock, Zap, ClipboardList, Play, Square, Info, X, AlertTriangle, ChevronDown, ChevronUp, History, Plus, UserMinus, Printer } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, limit, doc, updateDoc, serverTimestamp } from "firebase/firestore";

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

const firebaseConfig = {
  apiKey: "1:92912542646:web:47fb3bd6db0215621b1717",
  authDomain: "er-cardiac-hackathon.firebaseapp.com",
  projectId: "er-cardiac-hackathon",
  storageBucket: "er-cardiac-hackathon.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ── Initial patient roster ───────────────────────────────────────────────────
const INITIAL_PATIENTS = [
  { id: 'A', label: 'Patient A', name: 'John D.',   fsCollection: 'incidents_A', baseHR: 75, baseBP: 120 },
  { id: 'B', label: 'Patient B', name: 'Maria S.',  fsCollection: 'incidents_B', baseHR: 72, baseBP: 118 },
  { id: 'C', label: 'Patient C', name: 'Robert K.', fsCollection: 'incidents_C', baseHR: 80, baseBP: 125 },
];

const MAX_PATIENTS = 6;

const initPatient = ({ baseHR = 75, baseBP = 120 } = {}) => ({
  vitals:          { heartRate: baseHR, systolicBP: baseBP, spo2: 98, troponin: 0.01 },
  history:         { heartRate: Array(20).fill(baseHR), systolicBP: Array(20).fill(baseBP), spo2: Array(20).fill(98), troponin: Array(20).fill(0.01) },
  riskScore:       12,
  riskLevel:       'Low',
  riskBreakdown:   { hr: 33, bp: 33, trop: 34 },
  assessments:     [],
  aiStatus:        'idle',
  isAiThinking:    false,
  stressTestActive: false,
  pastAssessments: [],
});

const computeRisk = (v, prevHistory) => {
  const hrTrend = v.heartRate  - prevHistory.heartRate[prevHistory.heartRate.length - 1];
  const bpTrend = v.systolicBP - prevHistory.systolicBP[prevHistory.systolicBP.length - 1];
  let hrWeight   = Math.abs(v.heartRate - 75) * 1.2;
  let bpWeight   = Math.abs(120 - v.systolicBP) * 1.5;
  let tropWeight = (v.troponin / 0.1) * 100;
  if (hrTrend > 5)  hrWeight *= 1.5;
  if (bpTrend < -5) bpWeight *= 1.8;
  const total = hrWeight + bpWeight + tropWeight || 1;
  const score = Math.min(Math.round((total / 300) * 100), 99);
  return {
    riskScore:     score,
    riskLevel:     score < 30 ? 'Low' : score < 70 ? 'Moderate' : 'Critical',
    riskBreakdown: {
      hr:   Math.round((hrWeight   / total) * 100),
      bp:   Math.round((bpWeight   / total) * 100),
      trop: Math.round((tropWeight / total) * 100),
    },
  };
};

// ── Sub-components ───────────────────────────────────────────────────────────
const Sparkline = ({ data, color, min, max }) => {
  const width = 100; const height = 28;
  if (data.length === 0) return null;
  const range = max - min || 1;
  const points = data.map((val, i) => {
    const x = (i / (Math.max(data.length - 1, 1))) * width;
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible mt-2" style={{ height: 28 }}>
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  );
};

const getRiskConfig = (level) => {
  if (level === 'Low') return {
    cardBorder: 'border-green-300', cardBg: 'bg-green-50',
    badgeBg: 'bg-[#16a34a]', scoreColor: 'text-[#16a34a]', ringColor: 'border-[#16a34a]',
    label: 'STABLE', isPulsing: false,
  };
  if (level === 'Moderate') return {
    cardBorder: 'border-amber-400', cardBg: 'bg-amber-50',
    badgeBg: 'bg-[#d97706]', scoreColor: 'text-[#d97706]', ringColor: 'border-[#d97706]',
    label: 'MODERATE RISK', isPulsing: false,
  };
  return {
    cardBorder: 'border-red-400', cardBg: 'bg-red-50',
    badgeBg: 'bg-[#dc2626]', scoreColor: 'text-[#dc2626]', ringColor: 'border-[#dc2626]',
    label: 'CRITICAL', isPulsing: true,
  };
};

const computeTrendAlerts = (history, vitals) => {
  const alerts = [];
  const historyLength = 10;

  // Helper to check for a strictly monotonic trend over the last `historyLength` points.
  const checkTrend = (arr, direction) => {
    if (!arr || arr.length < historyLength) return false;
    const recentHistory = arr.slice(-historyLength);

    for (let i = 1; i < recentHistory.length; i++) {
      if (direction === 'rising' && recentHistory[i] <= recentHistory[i - 1]) return false;
      if (direction === 'falling' && recentHistory[i] >= recentHistory[i - 1]) return false;
    }
    // A flat line is not a trend, so the strict inequality in the loop is key.
    // If the loop completes, it's a valid trend, but we must ensure there was any change at all.
    return recentHistory[0] !== recentHistory[recentHistory.length - 1];
  };

  // HR Trend: continuously rising above 100
  if (checkTrend(history.heartRate, 'rising') && vitals.heartRate > 100) {
    alerts.push('↑ HR Sustained Rise');
  }

  // BP Trend: continuously rising above 140 or falling below 90
  if (checkTrend(history.systolicBP, 'rising') && vitals.systolicBP > 140) {
    alerts.push('↑ BP Sustained Rise');
  } else if (checkTrend(history.systolicBP, 'falling') && vitals.systolicBP < 90) {
    alerts.push('↓ BP Sustained Drop');
  }

  // SpO2 Trend: continuously falling below 94
  if (checkTrend(history.spo2, 'falling') && vitals.spo2 < 94) {
    alerts.push('↓ SpO2 Sustained Drop');
  }

  // Troponin Trend: any continuous rise
  if (checkTrend(history.troponin, 'rising')) {
    alerts.push('↑ Troponin Sustained Rise');
  }

  return alerts;
};

const formatTimeSince = (isoString) => {
  if (!isoString) return 'Never';
  const now = new Date();
  const past = new Date(isoString);
  const seconds = Math.floor((now - past) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const exportClinicalSummary = (patientCfg, incident) => {
  const level = incident.score >= 70 ? 'Critical' : incident.score >= 30 ? 'Moderate' : 'Low';
  const ts = new Date(incident.timestamp);
  const dateStr = ts.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const vitalsHtml = incident.vitals ? `
    <table>
      <tr><th>Heart Rate</th><td>${incident.vitals.heartRate} bpm</td></tr>
      <tr><th>Systolic BP</th><td>${incident.vitals.systolicBP} mmHg</td></tr>
      <tr><th>SpO₂</th><td>${incident.vitals.spo2}%</td></tr>
      <tr><th>Troponin T</th><td>${incident.vitals.troponin?.toFixed(3)} ng/mL</td></tr>
    </table>` : '';

  const recsHtml = incident.recommendations?.length ? `
    <h3>Recommendations</h3>
    <ol>${incident.recommendations.map(r => `<li>${r}</li>`).join('')}</ol>` : '';

  const noteHtml = incident.doctorNote ? `
    <h3>Clinical Note</h3>
    <p>${incident.doctorNote}</p>` : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Clinical Summary — ${patientCfg?.name ?? 'Patient'}</title>
    <style>
      body { font-family: Georgia, serif; max-width: 700px; margin: 40px auto; color: #111; }
      h1 { font-size: 1.4rem; margin-bottom: 4px; }
      h2 { font-size: 1rem; color: #555; font-weight: normal; margin-bottom: 24px; }
      h3 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: #666; margin: 20px 0 6px; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
      th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #eee; font-size: 0.9rem; }
      th { width: 140px; color: #555; font-weight: normal; }
      p { font-size: 0.95rem; line-height: 1.6; }
      ol { padding-left: 20px; font-size: 0.9rem; line-height: 1.8; }
      .badge { display: inline-block; padding: 2px 10px; border-radius: 4px; font-size: 0.8rem; font-weight: bold;
        background: ${level === 'Critical' ? '#fee2e2' : level === 'Moderate' ? '#fef3c7' : '#dcfce7'};
        color: ${level === 'Critical' ? '#dc2626' : level === 'Moderate' ? '#d97706' : '#16a34a'}; }
      .disclaimer { margin-top: 32px; font-size: 0.75rem; color: #999; border-top: 1px solid #eee; padding-top: 12px; }
      @media print { body { margin: 20px; } }
    </style>
  </head><body>
    <h1>CEEWS Clinical Summary — ${patientCfg?.name ?? 'Unknown Patient'}</h1>
    <h2>${dateStr} at ${timeStr}</h2>
    <span class="badge">${level.toUpperCase()} · Risk Score ${incident.score}</span>
    <h3>Vitals Snapshot</h3>${vitalsHtml}
    <h3>Gemini Clinical Assessment</h3>
    <p>${incident.text}</p>
    ${recsHtml}${noteHtml}
    <p class="disclaimer">AI-generated summary from CEEWS · Cardiac Event Early Warning System · hackUMBC 2025. Verify with clinical judgment before acting.</p>
  </body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  win?.addEventListener('load', () => { win.print(); URL.revokeObjectURL(url); });
};

// ── Main component ───────────────────────────────────────────────────────────
export default function App() {
  // ── Core UI state ──────────────────────────────────────────────────────────
  const [showWelcome,        setShowWelcome]        = useState(true);
  const [viewMode,           setViewMode]           = useState('patient'); // 'patient' | 'triage'
  const [isLive,             setIsLive]             = useState(false);
  const [activePatient,      setActivePatient]      = useState('A');
  const [showHistory,        setShowHistory]        = useState(true);
  const [expandedIncidentId, setExpandedIncidentId] = useState(null);
  const [editingNoteId,      setEditingNoteId]      = useState(null);
  const [noteText,           setNoteText]           = useState('');

  // ── Dynamic patient roster ─────────────────────────────────────────────────
  const [patientList, setPatientList] = useState(INITIAL_PATIENTS);
  const [patients,    setPatients]    = useState(
    Object.fromEntries(INITIAL_PATIENTS.map(cfg => [cfg.id, initPatient(cfg)]))
  );

  // Ref so the telemetry interval always sees the latest roster without restarting
  const patientListRef = useRef(patientList);
  useEffect(() => { patientListRef.current = patientList; }, [patientList]);

  // Derived map for O(1) config lookups by id
  const patientMap = Object.fromEntries(patientList.map(cfg => [cfg.id, cfg]));

  // ── Modal state ────────────────────────────────────────────────────────────
  const [addModal,       setAddModal]       = useState(false);
  const [newName,        setNewName]        = useState('');
  const [newId,          setNewId]          = useState('');
  const [idError,        setIdError]        = useState('');
  const [dischargeModal, setDischargeModal] = useState(null); // patientId | null

  // ── Firestore listener registry ────────────────────────────────────────────
  const firestoreUnsubs = useRef({});

  const subscribePatient = (id, fsCollection) => {
    if (firestoreUnsubs.current[id]) return;
    const q = query(collection(db, fsCollection), orderBy('timestamp', 'desc'), limit(10));
    firestoreUnsubs.current[id] = onSnapshot(q, snapshot => {
      setPatients(prev => ({
        ...prev,
        [id]: { ...prev[id], pastAssessments: snapshot.docs.map(d => ({ id: d.id, ...d.data() })) },
      }));
    });
  };

  const unsubscribePatient = (id) => {
    firestoreUnsubs.current[id]?.();
    delete firestoreUnsubs.current[id];
  };

  // Subscribe to all initial patients on mount; cleanup all on unmount
  useEffect(() => {
    INITIAL_PATIENTS.forEach(cfg => subscribePatient(cfg.id, cfg.fsCollection));
    return () => Object.values(firestoreUnsubs.current).forEach(u => u());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Telemetry interval — all patients run simultaneously ───────────────────
  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => {
      setPatients(prev => {
        const next = {};
        // Always carry over the full previous state first
        Object.assign(next, prev);
        patientListRef.current.forEach(cfg => {
          const p = prev[cfg.id];
          if (!p) return;
          let newHR   = p.vitals.heartRate  + (Math.random() * 4 - 2);
          let newBP   = p.vitals.systolicBP + (Math.random() * 6 - 3);
          let newSpo2 = Math.min(100, p.vitals.spo2 + (Math.random() * 2 - 1));
          let newTrop = p.vitals.troponin;
          if (p.stressTestActive) { newHR += 5; newBP -= 4; newSpo2 -= 1; newTrop += 0.005; }
          const nextVitals = {
            heartRate:  Math.max(30,  Math.round(newHR)),
            systolicBP: Math.max(60,  Math.round(newBP)),
            spo2:       Math.max(70,  Math.round(newSpo2)),
            troponin:   Math.min(0.2, Math.max(0.01, parseFloat(newTrop.toFixed(3)))),
          };
          const nextHistory = {
            heartRate:  [...p.history.heartRate.slice(1),  nextVitals.heartRate],
            systolicBP: [...p.history.systolicBP.slice(1), nextVitals.systolicBP],
            spo2:       [...p.history.spo2.slice(1),       nextVitals.spo2],
            troponin:   [...p.history.troponin.slice(1),   nextVitals.troponin],
          };
          next[cfg.id] = { ...p, vitals: nextVitals, history: nextHistory, ...computeRisk(nextVitals, p.history) };
        });
        return next;
      });
    }, 1500);
    return () => clearInterval(interval);
  }, [isLive]);

  // ── Patient management ─────────────────────────────────────────────────────
  const addPatient = () => {
    const sanitized = newId.trim().toUpperCase().replace(/\s+/g, '_');
    if (!sanitized || !newName.trim()) return;
    if (patientMap[sanitized]) { setIdError('ID already in use'); return; }
    if (patientList.length >= MAX_PATIENTS) return;

    const cfg = {
      id:           sanitized,
      label:        `Patient ${sanitized}`,
      name:         newName.trim(),
      fsCollection: `incidents_${sanitized}`,
      baseHR:       75,
      baseBP:       120,
    };

    // Sync ref immediately so the next interval tick picks up the new patient
    patientListRef.current = [...patientListRef.current, cfg];
    setPatientList(prev => [...prev, cfg]);
    setPatients(prev => ({ ...prev, [sanitized]: initPatient(cfg) }));
    subscribePatient(sanitized, cfg.fsCollection);
    setActivePatient(sanitized);

    setAddModal(false);
    setNewName('');
    setNewId('');
    setIdError('');
  };

  const dischargePatient = (id) => {
    const remaining = patientList.filter(cfg => cfg.id !== id);

    // Sync ref immediately before the next interval tick
    patientListRef.current = remaining;
    unsubscribePatient(id);
    setPatientList(remaining);
    setPatients(prev => {
      const { [id]: _dropped, ...rest } = prev;
      return rest;
    });

    if (activePatient === id) {
      setActivePatient(remaining[0]?.id ?? null);
      setExpandedIncidentId(null);
      setEditingNoteId(null);
      setNoteText('');
    }
    setDischargeModal(null);
  };

  // ── Cloud helpers ──────────────────────────────────────────────────────────
  const saveAssessmentToCloud = async (fsCollection, text, score, v, recommendations = []) => {
    try {
      await addDoc(collection(db, fsCollection), { text, score, vitals: v, recommendations, timestamp: new Date().toISOString() });
    } catch (e) { console.error('Firestore error:', e); }
  };

  const saveDoctorNote = async (fsCollection, incidentId, text) => {
    try {
      await updateDoc(doc(db, fsCollection, incidentId), { doctorNote: text.trim(), noteTimestamp: serverTimestamp() });
      setEditingNoteId(null);
      setNoteText('');
    } catch (e) { console.error('Note save error:', e); }
  };

  // ── AI helpers ─────────────────────────────────────────────────────────────
  const parseGeminiResponse = (text) => {
    const assessmentMatch      = text.match(/ASSESSMENT:\s*([\s\S]*?)(?:\n\s*RECOMMENDATIONS:|$)/i);
    const recommendationsMatch = text.match(/RECOMMENDATIONS:\s*([\s\S]*)/i);
    const assessment = assessmentMatch ? assessmentMatch[1].trim() : text.trim();
    let recommendations = [];
    if (recommendationsMatch) {
      recommendations = recommendationsMatch[1]
        .split('\n').map(l => l.trim())
        .filter(l => /^\d+[.)]\s+/.test(l))
        .map(l => l.replace(/^\d+[.)]\s+/, '').trim())
        .filter(Boolean);
    }
    return { assessment, recommendations };
  };

  const callGeminiAgent = async (patientId, currentVitals, currentRiskScore, currentRiskLevel) => {
    setPatients(prev => ({ ...prev, [patientId]: { ...prev[patientId], isAiThinking: true, aiStatus: 'thinking' } }));

    const prompt = `You are an emergency medicine AI advisor. Analyze this patient's telemetry data and provide a structured clinical assessment.

Patient vitals:
- Heart Rate: ${currentVitals.heartRate} bpm
- Systolic BP: ${currentVitals.systolicBP} mmHg
- SpO2: ${currentVitals.spo2}%
- Troponin T: ${currentVitals.troponin} ng/mL

Respond in this exact format (no asterisks, no markdown):

ASSESSMENT: [2-3 sentences of urgent clinical assessment using precise medical terminology. Assess risk of myocardial infarction or hemodynamic collapse.]

RECOMMENDATIONS:
1. [First immediate clinical action]
2. [Second clinical action]
3. [Third clinical action]
4. [Fourth clinical action]
5. [Fifth clinical action]`;

    try {
      const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
      const { assessment, recommendations } = parseGeminiResponse(response.text);
      setPatients(prev => ({
        ...prev,
        [patientId]: {
          ...prev[patientId],
          assessments: [...prev[patientId].assessments, {
            id:    Date.now(),
            time:  new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            text:  assessment,
            recommendations,
            score: currentRiskScore,
            level: currentRiskLevel,
          }],
          isAiThinking: false,
          aiStatus: 'idle',
        },
      }));
      saveAssessmentToCloud(patientMap[patientId]?.fsCollection, assessment, currentRiskScore, currentVitals, recommendations);
    } catch (error) {
      console.error(error);
      setPatients(prev => ({ ...prev, [patientId]: { ...prev[patientId], isAiThinking: false, aiStatus: 'error' } }));
    }
  };

  const triggerStressTest = () => {
    const id = activePatient;
    if (!isLive) setIsLive(true);
    setPatients(prev => ({ ...prev, [id]: { ...prev[id], stressTestActive: true } }));
    const stressVitals = { heartRate: 165, systolicBP: 72, spo2: 84, troponin: 0.18 };
    setTimeout(() => {
      const risk = computeRisk(stressVitals, { heartRate: Array(20).fill(165), systolicBP: Array(20).fill(72), spo2: Array(20).fill(84) });
      callGeminiAgent(id, stressVitals, risk.riskScore, risk.riskLevel);
    }, 3000);
    setTimeout(() => {
      setPatients(prev => ({ ...prev, [id]: { ...prev[id], stressTestActive: false } }));
    }, 15000);
  };

  // ── Derived values for active patient ──────────────────────────────────────
  const advisoryEndRef = useRef(null);
  useEffect(() => {
    advisoryEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [patients[activePatient]?.assessments]);

  const sortedPatients = [...patientList].sort((a, b) => {
    const pA = patients[a.id];
    const pB = patients[b.id];
    if (!pA || !pB) return 0;
    return pB.riskScore - pA.riskScore;
  });

  const p             = patients[activePatient] ?? initPatient();
  const riskConfig    = getRiskConfig(p.riskLevel);
  const trendAlerts   = computeTrendAlerts(p.history, p.vitals);
  const latestAssessment = p.assessments[p.assessments.length - 1];
  const anyCritical   = Object.values(patients).some(pt => pt.riskLevel === 'Critical');
  const criticalNames = patientList
    .filter(cfg => patients[cfg.id]?.riskLevel === 'Critical')
    .map(cfg => cfg.name);
  const wardFull = patientList.length >= MAX_PATIENTS;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a1628] font-sans flex flex-col">

      {/* ── Add Patient Modal ── */}
      {addModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-gray-900">Add Patient</h3>
              <button onClick={() => { setAddModal(false); setIdError(''); setNewName(''); setNewId(''); }}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-full hover:bg-gray-100 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Patient Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addPatient()}
                  placeholder="e.g. Jane D."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#0a1628] focus:ring-1 focus:ring-[#0a1628] placeholder-gray-300"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Patient ID</label>
                <input
                  type="text"
                  value={newId}
                  onChange={e => { setNewId(e.target.value); setIdError(''); }}
                  onKeyDown={e => e.key === 'Enter' && addPatient()}
                  placeholder="e.g. ER-004"
                  className={`w-full border rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 placeholder-gray-300 ${
                    idError ? 'border-red-300 focus:border-red-400 focus:ring-red-300' : 'border-gray-200 focus:border-[#0a1628] focus:ring-[#0a1628]'
                  }`}
                />
                {idError && <p className="text-xs text-red-500 mt-1">{idError}</p>}
                <p className="text-xs text-gray-400 mt-1">Used as the Firestore collection key. Spaces become underscores.</p>
              </div>
            </div>
            <div className="flex gap-2.5 mt-5">
              <button
                onClick={() => { setAddModal(false); setIdError(''); setNewName(''); setNewId(''); }}
                className="flex-1 py-2.5 text-sm text-gray-500 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={addPatient}
                disabled={!newName.trim() || !newId.trim()}
                className="flex-1 py-2.5 text-sm font-bold bg-[#0a1628] text-white rounded-xl hover:bg-[#1a2a48] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Add to Ward
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Discharge Confirmation Modal ── */}
      {dischargeModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                <UserMinus className="w-5 h-5 text-[#dc2626]" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">Discharge Patient</h3>
                <p className="text-xs text-gray-400">This action stops monitoring</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-5 bg-gray-50 rounded-xl p-3 border border-gray-200">
              Remove <strong className="text-gray-900">{patientMap[dischargeModal]?.name}</strong> from active monitoring?
              Incident history will be retained in Firestore.
            </p>
            <div className="flex gap-2.5">
              <button
                onClick={() => setDischargeModal(null)}
                className="flex-1 py-2.5 text-sm text-gray-500 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => dischargePatient(dischargeModal)}
                className="flex-1 py-2.5 text-sm font-bold bg-[#dc2626] text-white rounded-xl hover:bg-red-700 transition-colors"
              >
                Discharge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Welcome Modal ── */}
      {showWelcome && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0a1628]/90 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <div className="bg-[#0a1628] p-2.5 rounded-xl">
                  <Activity className="w-7 h-7 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900">Welcome to CEEWS</h2>
              </div>
              <button onClick={() => setShowWelcome(false)} className="text-gray-400 hover:text-gray-600 p-2 rounded-full hover:bg-gray-100 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-5 text-gray-700">
              <p className="text-base leading-relaxed">
                <strong className="text-gray-900">Cardiac Event Early Warning System (CEEWS)</strong> is an agentic AI dashboard designed to prevent myocardial infarctions by analyzing the first 60 minutes of patient telemetry in the ER.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                  <div className="flex items-start space-x-3">
                    <Zap className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold text-gray-900 mb-1">The Problem</p>
                      <p className="text-sm text-gray-600">By the time a doctor reviews standard ICU telemetry, it is often too late to prevent a critical cardiac event.</p>
                    </div>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                  <div className="flex items-start space-x-3">
                    <ShieldCheck className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold text-gray-900 mb-1">The Solution</p>
                      <p className="text-sm text-gray-600">CEEWS uses <strong className="text-gray-800">Gemini 2.5 Flash</strong> to continuously monitor vitals, calculating risk scores and providing actionable clinical reasoning.</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-sm text-blue-900"><strong>Quick Start:</strong> Click "Trigger Crash Demo" on the dashboard to simulate vital deterioration and watch the AI Clinical Advisory respond in real time.</p>
              </div>
            </div>
            <button
              onClick={() => { setShowWelcome(false); setIsLive(true); }}
              className="w-full mt-6 bg-[#0a1628] text-white font-bold py-4 rounded-xl hover:bg-[#1a2a48] transition-colors flex items-center justify-center space-x-2"
            >
              <Play className="w-5 h-5" />
              <span>Launch Dashboard</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Critical Alert Strip ── */}
      {anyCritical && (
        <div className="bg-[#dc2626] critical-badge-pulse px-4 py-2 flex items-center justify-center gap-2 text-white text-sm font-semibold">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            CRITICAL ALERT —{' '}
            {criticalNames.join(' & ')}{' '}
            {criticalNames.length === 1 ? 'requires' : 'require'} immediate attention
          </span>
        </div>
      )}

      {/* ── Header ── */}
      <header className="bg-[#0a1628] border-b border-white/10 px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <div className="bg-white/10 p-2 rounded-lg">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-lg font-black text-white tracking-tight leading-none">CEEWS</h1>
              <span className="text-[10px] px-1.5 py-0.5 bg-white/10 text-white/40 rounded font-medium">v2.0</span>
            </div>
            <p className="text-[11px] text-white/35 tracking-wide mt-0.5">Cardiac Event Early Warning System</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {/* View Mode Toggle */}
          <div className="hidden md:flex items-center bg-white/10 p-1 rounded-lg">
            <button
              onClick={() => setViewMode('patient')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${viewMode === 'patient' ? 'bg-[#0a1628] text-white' : 'text-white/60 hover:text-white'}`}
            >
              Patient View
            </button>
            <button
              onClick={() => setViewMode('triage')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${viewMode === 'triage' ? 'bg-[#0a1628] text-white' : 'text-white/60 hover:text-white'}`}
            >
              Triage Queue
            </button>
          </div>
          {isLive && (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
              <span className="text-xs text-green-300 font-medium whitespace-nowrap">Telemetry Live</span>
            </div>
          )}
          <button
            onClick={() => setShowWelcome(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-sm text-white/60 hover:text-white transition-all"
          >
            <Info className="w-4 h-4" />
            <span className="hidden md:inline">About</span>
          </button>
          <button
            onClick={() => setIsLive(!isLive)}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-bold transition-all border ${
              isLive
                ? 'bg-red-500/15 text-red-300 border-red-500/30 hover:bg-red-500/25'
                : 'bg-green-500/15 text-green-300 border-green-500/30 hover:bg-green-500/25'
            }`}
          >
            {isLive ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isLive ? 'Stop Feed' : 'Live Feed'}</span>
          </button>
        </div>
      </header>

      {/* ── Alert Summary Bar ── */}
      <div className={`px-4 py-2 flex items-center justify-center gap-2 flex-wrap transition-colors ${anyCritical ? 'bg-[#dc2626] critical-badge-pulse' : 'bg-[#0d1f3c]'}`}>
        {patientList.map((cfg, i) => {
          const pt = patients[cfg.id];
          if (!pt) return null;
          const levelLabel  = pt.riskLevel === 'Low' ? 'STABLE' : pt.riskLevel.toUpperCase();
          const scoreStyles = pt.riskLevel === 'Critical' ? 'bg-white/20 text-white'
            : pt.riskLevel === 'Moderate' ? 'bg-amber-500/25 text-amber-200'
            : 'bg-green-500/20 text-green-200';
          return (
            <span key={cfg.id} className="flex items-center gap-2 text-sm">
              {i > 0 && <span className="text-white/20 select-none hidden sm:inline">|</span>}
              <span className={`font-medium ${anyCritical ? 'text-white/90' : 'text-white/70'}`}>{cfg.name}</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${scoreStyles}`}>{levelLabel} {pt.riskScore}</span>
            </span>
          );
        })}
      </div>

      {/* ── Patient Tab Bar ── */}
      <div className="bg-[#0a1628] border-b border-white/10 flex min-w-0">
        {/* Scrollable tab list */}
        <div className="flex overflow-x-auto scrollbar-hide flex-1 min-w-0">
          {patientList.map(cfg => {
            const pt       = patients[cfg.id];
            const isActive = activePatient === cfg.id;
            const dotColor = pt?.riskLevel === 'Critical' ? 'bg-red-400'
              : pt?.riskLevel === 'Moderate' ? 'bg-amber-400'
              : 'bg-green-400';
            return (
              <div
                key={cfg.id}
                className={`group relative flex items-center gap-2 px-4 py-3 border-b-2 transition-all cursor-pointer shrink-0 ${
                  isActive
                    ? 'border-white text-white'
                    : 'border-transparent text-white/40 hover:text-white/70 hover:border-white/20'
                }`}
                onClick={() => { setActivePatient(cfg.id); setExpandedIncidentId(null); setEditingNoteId(null); setNoteText(''); }}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor} ${pt?.riskLevel === 'Critical' ? 'animate-pulse' : ''}`} />
                <span className="text-sm font-medium whitespace-nowrap">{cfg.label}</span>
                <span className="hidden md:inline text-white/30 text-sm whitespace-nowrap">— {cfg.name}</span>
                {/* Discharge × button */}
                {patientList.length > 1 && (
                  <button
                    onClick={e => { e.stopPropagation(); setDischargeModal(cfg.id); }}
                    className="ml-1 w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/20 transition-all shrink-0"
                    title={`Discharge ${cfg.name}`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Add Patient / Ward Full button — pinned right */}
        <div className="shrink-0 flex items-center border-l border-white/10 px-3">
          {wardFull ? (
            <span className="text-xs text-white/25 font-medium px-3 py-2 whitespace-nowrap">Ward Full</span>
          ) : (
            <button
              onClick={() => setAddModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white/50 hover:text-white hover:bg-white/10 transition-all whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Patient
            </button>
          )}
        </div>
      </div>

      {/* ── Main Dashboard ── */}
      <main className="flex-1 p-4 md:p-5 lg:p-6 xl:p-8">
        {viewMode === 'triage' ? (
          <div className="max-w-7xl mx-auto w-full">
            <div className="bg-[#0d1f3c] rounded-xl p-4 mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Triage Queue</h2>
                <p className="text-xs text-white/40">Patients ranked by real-time risk score</p>
              </div>
              <p className="text-sm text-white/60 font-medium">{patientList.length} Patients Monitored — Updated Live</p>
            </div>
            <div className="space-y-2">
              {sortedPatients.map((cfg, index) => {
                const pt = patients[cfg.id];
                if (!pt) return null;
                const rank = index + 1;
                const level = pt.riskLevel;
                const levelStyles = {
                  Critical: { border: 'border-l-[#dc2626]', bg: 'bg-red-500/5' },
                  Moderate: { border: 'border-l-[#d97706]', bg: 'bg-amber-500/5' },
                  Low:      { border: 'border-l-gray-300', bg: 'bg-white' },
                }[level];
                const riskBadgeStyles = {
                  Critical: 'bg-red-100 text-[#dc2626] border-red-200',
                  Moderate: 'bg-amber-100 text-[#d97706] border-amber-200',
                  Low:      'bg-green-100 text-[#16a34a] border-green-200',
                }[level];
                const lastAssessmentTime = formatTimeSince(pt.pastAssessments[0]?.timestamp);

                return (
                  <div key={cfg.id} className={`grid grid-cols-1 md:grid-cols-12 items-center gap-x-4 gap-y-2 px-4 py-3 rounded-lg border border-gray-200/80 border-l-4 transition-colors ${levelStyles.border} ${levelStyles.bg}`}>
                    {/* Rank & Name */}
                    <div className="md:col-span-2 flex items-center gap-4">
                      <span className="text-lg font-bold text-gray-400 w-6 text-center">{rank}</span>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-500" />
                        <span className="font-bold text-gray-800">{cfg.name}</span>
                      </div>
                    </div>
                    {/* Risk */}
                    <div className="md:col-span-2 flex items-center gap-3">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${riskBadgeStyles}`}>{level.toUpperCase()}</span>
                      <span className="font-mono font-bold text-lg text-gray-700">{pt.riskScore}</span>
                    </div>
                    {/* Vitals */}
                    <div className="md:col-span-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs font-mono">
                      <div className={`flex items-center justify-between ${pt.vitals.heartRate > 110 || pt.vitals.heartRate < 50 ? 'text-red-600' : 'text-gray-600'}`}><span className="text-gray-400 font-sans mr-2">HR</span> <span className="font-semibold">{pt.vitals.heartRate}</span></div>
                      <div className={`flex items-center justify-between ${pt.vitals.systolicBP > 160 || pt.vitals.systolicBP < 90 ? 'text-red-600' : 'text-gray-600'}`}><span className="text-gray-400 font-sans mr-2">BP</span> <span className="font-semibold">{pt.vitals.systolicBP}</span></div>
                      <div className={`flex items-center justify-between ${pt.vitals.spo2 < 94 ? 'text-red-600' : 'text-gray-600'}`}><span className="text-gray-400 font-sans mr-2">SpO₂</span> <span className="font-semibold">{pt.vitals.spo2}%</span></div>
                      <div className={`flex items-center justify-between ${pt.vitals.troponin > 0.04 ? 'text-red-600' : 'text-gray-600'}`}><span className="text-gray-400 font-sans mr-2">Trop</span> <span className="font-semibold">{pt.vitals.troponin.toFixed(3)}</span></div>
                    </div>
                    {/* Last Assessment */}
                    <div className="md:col-span-2 flex items-center gap-2 text-xs text-gray-500">
                      <Clock className="w-3.5 h-3.5" />
                      <span>AI Note: {lastAssessmentTime}</span>
                    </div>
                    {/* Actions */}
                    <div className="md:col-span-2 flex items-center justify-end gap-2">
                      <button
                        onClick={() => callGeminiAgent(cfg.id, pt.vitals, pt.riskScore, pt.riskLevel)}
                        disabled={pt.isAiThinking}
                        className="px-3 py-2 text-xs font-semibold bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 disabled:opacity-50 disabled:cursor-wait flex items-center gap-1.5"
                      >
                        <Stethoscope className="w-3.5 h-3.5" />
                        {pt.isAiThinking ? 'Working...' : 'Assess'}
                      </button>
                      <button
                        onClick={() => { setViewMode('patient'); setActivePatient(cfg.id); }}
                        className="px-3 py-2 text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                      >
                        View
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

              {/* Left Column: Vitals */}
              <div className="lg:col-span-4 space-y-4">

                {/* Patient badge */}
                <div className="bg-white rounded-xl p-4 border border-gray-200 flex items-center space-x-4">
                  <div className="bg-[#0a1628] w-11 h-11 rounded-full flex items-center justify-center shrink-0">
                    <User className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                      {patientMap[activePatient]?.label ?? 'Patient'}
                    </p>
                    <p className="font-bold text-gray-900">{patientMap[activePatient]?.name}</p>
                    <div className="flex items-center space-x-1.5 mt-0.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
                      <span className="text-xs text-gray-400">{isLive ? 'Live monitoring' : 'Feed paused'}</span>
                    </div>
                  </div>
                </div>

                {/* Heart Rate */}
                <div className="bg-white rounded-xl p-4 border border-gray-200">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Heart Rate</span>
                    <span className={`text-3xl font-mono font-bold ${p.vitals.heartRate > 110 || p.vitals.heartRate < 50 ? 'text-[#dc2626]' : 'text-[#16a34a]'}`}>
                      {p.vitals.heartRate}<span className="text-sm font-sans text-gray-400 ml-1 font-normal">bpm</span>
                    </span>
                  </div>
                  <Sparkline data={p.history.heartRate} color={p.vitals.heartRate > 110 || p.vitals.heartRate < 50 ? '#dc2626' : '#16a34a'} min={40} max={160} />
                </div>

                {/* Systolic BP */}
                <div className="bg-white rounded-xl p-4 border border-gray-200">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Systolic BP</span>
                    <span className={`text-3xl font-mono font-bold ${p.vitals.systolicBP > 160 || p.vitals.systolicBP < 90 ? 'text-[#dc2626]' : 'text-gray-800'}`}>
                      {p.vitals.systolicBP}<span className="text-sm font-sans text-gray-400 ml-1 font-normal">mmHg</span>
                    </span>
                  </div>
                  <Sparkline data={p.history.systolicBP} color={p.vitals.systolicBP > 160 || p.vitals.systolicBP < 90 ? '#dc2626' : '#2563eb'} min={60} max={200} />
                </div>

                {/* SpO2 */}
                <div className="bg-white rounded-xl p-4 border border-gray-200">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">SpO₂</span>
                    <span className={`text-3xl font-mono font-bold ${p.vitals.spo2 < 94 ? 'text-[#dc2626]' : 'text-[#16a34a]'}`}>
                      {p.vitals.spo2}<span className="text-sm font-sans text-gray-400 ml-1 font-normal">%</span>
                    </span>
                  </div>
                  <Sparkline data={p.history.spo2} color={p.vitals.spo2 < 94 ? '#dc2626' : '#16a34a'} min={70} max={100} />
                </div>

                {/* Troponin T */}
                <div className="bg-white rounded-xl p-4 border border-gray-200">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Troponin T</span>
                    <span className={`text-3xl font-mono font-bold ${p.vitals.troponin > 0.04 ? 'text-[#dc2626]' : 'text-[#d97706]'}`}>
                      {p.vitals.troponin.toFixed(3)}<span className="text-sm font-sans text-gray-400 ml-1 font-normal">ng/mL</span>
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${p.vitals.troponin > 0.04 ? 'bg-[#dc2626]' : 'bg-[#d97706]'}`}
                      style={{ width: `${Math.min((p.vitals.troponin / 0.1) * 100, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1.5">
                    <span className="text-xs text-gray-300">0.00</span>
                    <span className="text-xs text-gray-400">Normal &lt;0.04 ng/mL</span>
                    <span className="text-xs text-gray-300">0.10+</span>
                  </div>
                </div>

                {/* Trend Alerts */}
                <div className="bg-white rounded-xl p-4 border border-gray-200">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Trend Alerts</h3>
                  {trendAlerts.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {trendAlerts.map((alertText, i) => (
                        <span key={i} className="px-2.5 py-1 text-xs font-semibold text-amber-800 bg-amber-100 border border-amber-200 rounded-full">
                          {alertText}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <ShieldCheck className="w-4 h-4 text-green-500 shrink-0" />
                      <p>All vitals trending stable.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Risk + AI */}
              <div className="lg:col-span-8 space-y-5">

                {/* Risk Status Card */}
                <div className={`rounded-2xl border-2 p-6 transition-all duration-500 ${riskConfig.cardBg} ${riskConfig.cardBorder} ${riskConfig.isPulsing ? 'critical-card-glow' : ''}`}>
                  <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">60-Min AI Risk Assessment</p>
                      <div
                        className={`inline-flex items-center rounded-2xl px-5 lg:px-7 py-2.5 lg:py-3 mb-5 ${riskConfig.badgeBg} ${riskConfig.isPulsing ? 'critical-badge-pulse' : ''}`}
                        style={{ fontSize: 'clamp(1.6rem, 3.5vw, 3rem)', fontWeight: 900, lineHeight: 1.05, color: 'white', letterSpacing: '-0.01em' }}
                      >
                        {riskConfig.isPulsing && <AlertTriangle className="w-7 h-7 lg:w-9 lg:h-9 mr-2.5 shrink-0" style={{ color: 'white' }} />}
                        {riskConfig.label}
                      </div>
                      <p className="text-sm text-gray-500 mb-5 leading-relaxed">
                        Gemini 2.5 Flash — continuous analysis of temporal vital dynamics and troponin biomarkers.
                      </p>
                      <button
                        onClick={triggerStressTest}
                        disabled={p.stressTestActive}
                        className={`flex items-center space-x-2 px-6 py-3 rounded-xl font-bold text-sm transition-all ${
                          p.stressTestActive ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#0a1628] text-white hover:bg-[#1a2a48]'
                        }`}
                      >
                        <Zap className={`w-4 h-4 ${p.stressTestActive ? '' : 'text-amber-400'}`} />
                        <span>{p.stressTestActive ? 'Analysis Pipeline Active...' : 'Trigger Crash Demo'}</span>
                      </button>
                    </div>
                    <div className={`flex-shrink-0 w-36 h-36 rounded-full border-4 ${riskConfig.ringColor} flex flex-col items-center justify-center bg-white shadow-md`}>
                      <span className={`font-black font-mono leading-none ${riskConfig.scoreColor}`} style={{ fontSize: '3.5rem' }}>
                        {p.riskScore}
                      </span>
                      <span className="text-xs text-gray-400 font-semibold mt-1 uppercase tracking-wider">Risk Score</span>
                    </div>
                  </div>
                </div>

                {/* XAI Risk Factor Breakdown */}
                <div className="bg-white rounded-xl p-5 border border-gray-200">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4 flex items-center">
                    <Zap className="w-3.5 h-3.5 mr-2 text-[#d97706]" />Risk Factor Analysis (XAI)
                  </h3>
                  <div className="space-y-3">
                    {[
                      { label: 'Heart Rate',     value: p.riskBreakdown.hr,   color: 'bg-[#16a34a]' },
                      { label: 'Blood Pressure', value: p.riskBreakdown.bp,   color: 'bg-[#2563eb]' },
                      { label: 'Troponin T',     value: p.riskBreakdown.trop, color: 'bg-[#d97706]' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="flex items-center space-x-3">
                        <span className="text-gray-500 text-xs w-28 shrink-0">{label}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-2">
                          <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${value}%` }} />
                        </div>
                        <span className="text-gray-600 text-xs font-mono w-8 text-right">{value}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* AI Clinical Advisory */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-5 py-3.5 bg-[#0a1628] flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-white">
                      <Stethoscope className="w-4 h-4" />
                      <span className="font-semibold text-sm tracking-wide">AI Clinical Advisory</span>
                    </div>
                    {p.isAiThinking ? (
                      <span className="text-xs px-2.5 py-1 bg-amber-500/20 text-amber-300 rounded-full animate-pulse flex items-center">
                        <Activity className="w-3 h-3 mr-1.5" />Analyzing vitals...
                      </span>
                    ) : p.aiStatus === 'error' ? (
                      <span className="text-xs px-2.5 py-1 bg-red-500/20 text-red-300 rounded-full">API Error</span>
                    ) : (
                      <span className="text-xs px-2.5 py-1 bg-white/10 text-white/50 rounded-full">
                        {p.assessments.length > 0 ? `${p.assessments.length} assessment${p.assessments.length > 1 ? 's' : ''}` : 'Awaiting analysis'}
                      </span>
                    )}
                  </div>
                  <div className="p-5">
                    {p.assessments.length === 0 && !p.isAiThinking ? (
                      <div className="text-center py-10">
                        <Stethoscope className="w-10 h-10 mx-auto mb-3 text-gray-200" />
                        <p className="text-sm text-gray-400">No assessments yet.</p>
                        <p className="text-xs text-gray-300 mt-1">Click "Trigger Crash Demo" to consult the AI.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {p.assessments.map((a) => (
                          <div key={a.id} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Assessment — {a.time}</span>
                              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                                a.level === 'Critical' ? 'bg-red-50 text-[#dc2626]' :
                                a.level === 'Moderate' ? 'bg-amber-50 text-[#d97706]' : 'bg-green-50 text-[#16a34a]'
                              }`}>Score {a.score}</span>
                            </div>
                            <p className="text-gray-700 text-sm leading-relaxed">{a.text}</p>
                          </div>
                        ))}
                        {p.isAiThinking && (
                          <div className="bg-gray-50 rounded-lg p-4 border border-amber-200 space-y-2 animate-pulse">
                            <div className="h-3 bg-gray-200 rounded w-1/3" />
                            <div className="h-3 bg-gray-200 rounded w-full" />
                            <div className="h-3 bg-gray-200 rounded w-5/6" />
                          </div>
                        )}
                        <div ref={advisoryEndRef} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Clinical Recommendations */}
                {latestAssessment && latestAssessment.recommendations.length > 0 && (
                  <div className="bg-white rounded-xl border-2 border-[#0a1628] overflow-hidden">
                    <div className="px-5 py-3.5 bg-[#0a1628] flex items-center justify-between">
                      <div className="flex items-center space-x-2 text-white">
                        <ClipboardList className="w-4 h-4" />
                        <span className="font-semibold text-sm tracking-wide">Clinical Recommendations</span>
                      </div>
                      <span className="text-xs text-white/40">Last assessment · {latestAssessment.time}</span>
                    </div>
                    <div className="p-5 bg-blue-50/40">
                      <ol className="space-y-3">
                        {latestAssessment.recommendations.map((rec, i) => (
                          <li key={i} className="flex items-start space-x-3">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#0a1628] text-white text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                            <span className="text-gray-800 text-sm leading-relaxed">{rec}</span>
                          </li>
                        ))}
                      </ol>
                      <p className="text-xs text-gray-400 mt-4 pt-3 border-t border-blue-100">
                        AI-generated recommendations — verify with clinical judgment before acting.
                      </p>
                    </div>
                  </div>
                )}

              </div>
            </div>

            {/* ── Incident History Panel ── */}
            <div className="mt-5">
              <button
                onClick={() => setShowHistory(h => !h)}
                className="w-full flex items-center justify-between px-5 py-3.5 bg-[#0a1628] rounded-xl text-white hover:bg-[#1a2a48] transition-colors"
              >
                <div className="flex items-center space-x-2">
                  <History className="w-4 h-4 text-white/60" />
                  <span className="font-semibold text-sm tracking-wide">Incident History</span>
                  <span className="text-xs text-white/30">— {patientMap[activePatient]?.name}</span>
                  {p.pastAssessments.length > 0 && (
                    <span className="text-xs px-2 py-0.5 bg-white/10 text-white/50 rounded-full">
                      {p.pastAssessments.length} record{p.pastAssessments.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {showHistory ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
              </button>

              {showHistory && (
                <div className="mt-3">
                  {p.pastAssessments.length === 0 ? (
                    <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
                      <Clock className="w-8 h-8 mx-auto mb-3 text-gray-200" />
                      <p className="text-sm text-gray-400">No incident records yet for {patientMap[activePatient]?.name}.</p>
                      <p className="text-xs text-gray-300 mt-1">Assessments will appear here once saved to the cloud.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {p.pastAssessments.map((a) => {
                        const level = a.score >= 70 ? 'Critical' : a.score >= 30 ? 'Moderate' : 'Low';
                        const isExpanded = expandedIncidentId === a.id;
                        const ts      = new Date(a.timestamp);
                        const dateStr = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                        const timeStr = ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                        const levelStyles = {
                          Critical: { badge: 'bg-red-100 text-[#dc2626] border-red-200',   border: 'border-l-[#dc2626]' },
                          Moderate: { badge: 'bg-amber-100 text-[#d97706] border-amber-200', border: 'border-l-[#d97706]' },
                          Low:      { badge: 'bg-green-100 text-[#16a34a] border-green-200', border: 'border-l-[#16a34a]' },
                        }[level];

                        return (
                          <div key={a.id} className={`bg-white rounded-xl border border-gray-200 border-l-4 ${levelStyles.border} overflow-hidden`}>
                            <button
                              onClick={() => setExpandedIncidentId(isExpanded ? null : a.id)}
                              className="w-full text-left px-5 py-3.5 flex items-center gap-4 hover:bg-gray-50 transition-colors"
                            >
                              <div className="shrink-0 text-left">
                                <p className="text-xs font-semibold text-gray-800">{dateStr}</p>
                                <p className="text-xs text-gray-400 font-mono">{timeStr}</p>
                              </div>
                              <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-lg border ${levelStyles.badge}`}>
                                {level} · {a.score}
                              </span>
                              {a.vitals && (
                                <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                                  <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded font-mono">HR {a.vitals.heartRate} bpm</span>
                                  <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded font-mono">BP {a.vitals.systolicBP} mmHg</span>
                                  <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded font-mono">SpO₂ {a.vitals.spo2}%</span>
                                  <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded font-mono">Trop {a.vitals.troponin?.toFixed(3)} ng/mL</span>
                                </div>
                              )}
                              {!isExpanded && <p className="hidden lg:block text-xs text-gray-400 truncate max-w-xs shrink-0">{a.text}</p>}
                              <ChevronDown className={`w-4 h-4 text-gray-300 shrink-0 ml-auto transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>

                            {isExpanded && (
                              <div className="px-5 pb-5 border-t border-gray-100 space-y-4 pt-4 relative">
                                <div className="absolute top-4 right-5 hidden sm:block">
                                  <button
                                    onClick={() => exportClinicalSummary(patientMap[activePatient], a)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200 rounded-lg transition-colors text-xs font-semibold"
                                  >
                                    <Printer className="w-3.5 h-3.5" />
                                    Export
                                  </button>
                                </div>
                                <div className="sm:hidden">
                                  <button
                                    onClick={() => exportClinicalSummary(patientMap[activePatient], a)}
                                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200 rounded-lg transition-colors text-xs font-semibold"
                                  >
                                    <Printer className="w-3.5 h-3.5" />
                                    Export Summary
                                  </button>
                                </div>
                                <div className="sm:pr-24">
                                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 flex items-center">
                                    <Stethoscope className="w-3.5 h-3.5 mr-1.5" />Gemini Clinical Assessment
                                  </p>
                                  <p className="text-sm text-gray-700 leading-relaxed bg-gray-50 rounded-lg p-3 border border-gray-200">{a.text}</p>
                                </div>
                                {a.vitals && (
                                  <div>
                                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center">
                                      <Activity className="w-3.5 h-3.5 mr-1.5" />Vitals Snapshot
                                    </p>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                      {[
                                        { label: 'Heart Rate',  value: `${a.vitals.heartRate} bpm`,          alert: a.vitals.heartRate > 110 || a.vitals.heartRate < 50 },
                                        { label: 'Systolic BP', value: `${a.vitals.systolicBP} mmHg`,         alert: a.vitals.systolicBP > 160 || a.vitals.systolicBP < 90 },
                                        { label: 'SpO₂',        value: `${a.vitals.spo2}%`,                  alert: a.vitals.spo2 < 94 },
                                        { label: 'Troponin T',  value: `${a.vitals.troponin?.toFixed(3)} ng/mL`, alert: a.vitals.troponin > 0.04 },
                                      ].map(({ label, value, alert }) => (
                                        <div key={label} className={`rounded-lg p-2.5 border text-center ${alert ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                                          <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                                          <p className={`text-sm font-mono font-bold ${alert ? 'text-[#dc2626]' : 'text-gray-800'}`}>{value}</p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {a.recommendations && a.recommendations.length > 0 && (
                                  <div>
                                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center">
                                      <ClipboardList className="w-3.5 h-3.5 mr-1.5" />Recommendations
                                    </p>
                                    <ol className="space-y-1.5">
                                      {a.recommendations.map((rec, i) => (
                                        <li key={i} className="flex items-start space-x-2.5">
                                          <span className="shrink-0 w-5 h-5 rounded-full bg-[#0a1628] text-white text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                                          <span className="text-sm text-gray-700 leading-relaxed">{rec}</span>
                                        </li>
                                      ))}
                                    </ol>
                                  </div>
                                )}

                                {/* Clinical Note */}
                                <div className="border-t border-gray-100 pt-4">
                                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center">
                                    <Stethoscope className="w-3.5 h-3.5 mr-1.5" />Clinical Note
                                  </p>
                                  {editingNoteId === a.id ? (
                                    <div className="space-y-2">
                                      <textarea
                                        rows={2}
                                        value={noteText}
                                        onChange={e => setNoteText(e.target.value)}
                                        placeholder="Add clinical observation..."
                                        className="w-full text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-[#0a1628] focus:ring-1 focus:ring-[#0a1628] placeholder-gray-300"
                                      />
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={() => saveDoctorNote(patientMap[activePatient]?.fsCollection, a.id, noteText)}
                                          disabled={!noteText.trim()}
                                          className="px-3 py-1.5 bg-[#0a1628] text-white text-xs font-semibold rounded-lg hover:bg-[#1a2a48] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                        >
                                          Save Note
                                        </button>
                                        <button
                                          onClick={() => { setEditingNoteId(null); setNoteText(''); }}
                                          className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  ) : a.doctorNote ? (
                                    <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5 flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="text-sm text-gray-800 leading-relaxed">{a.doctorNote}</p>
                                        {a.noteTimestamp && (
                                          <p className="text-xs text-gray-400 mt-1">
                                            Saved {a.noteTimestamp.toDate?.().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) ?? '—'}
                                          </p>
                                        )}
                                      </div>
                                      <button
                                        onClick={() => { setEditingNoteId(a.id); setNoteText(a.doctorNote); }}
                                        className="shrink-0 text-xs text-[#0a1628] font-semibold hover:underline"
                                      >
                                        Edit
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => { setEditingNoteId(a.id); setNoteText(''); }}
                                      className="w-full text-left px-3 py-2 border border-dashed border-gray-200 rounded-lg text-xs text-gray-400 hover:border-gray-300 hover:text-gray-500 transition-colors"
                                    >
                                      + Add clinical observation...
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-white/10 px-6 py-4 flex items-center justify-center">
        <p className="text-xs text-white/25 tracking-wide text-center">
          CEEWS &nbsp;·&nbsp; Cardiac Event Early Warning System &nbsp;·&nbsp; Built at hackUMBC 2025
        </p>
      </footer>
    </div>
  );
}
