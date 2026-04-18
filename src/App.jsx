import { useState, useEffect, useRef } from 'react';
import { Activity, ShieldCheck, User, Zap, Play, Square, Info, X, AlertTriangle, Plus } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, limit, doc, updateDoc, serverTimestamp } from 'firebase/firestore';

import { getRiskConfig, computeTrendAlerts } from './utils.js';
import PatientModals   from './components/PatientModals.jsx';
import TriageQueue     from './components/TriageQueue.jsx';
import VitalCard       from './components/VitalCard.jsx';
import RiskStatusCard  from './components/RiskStatusCard.jsx';
import ClinicalAdvisory from './components/ClinicalAdvisory.jsx';
import IncidentHistory from './components/IncidentHistory.jsx';

// ── Firebase + AI init ────────────────────────────────────────────────────────
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

const firebaseConfig = {
  apiKey: "1:92912542646:web:47fb3bd6db0215621b1717",
  authDomain: "er-cardiac-hackathon.firebaseapp.com",
  projectId: "er-cardiac-hackathon",
  storageBucket: "er-cardiac-hackathon.appspot.com",
  messagingSenderId: "...",
  appId: "...",
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ── Constants ─────────────────────────────────────────────────────────────────
const INITIAL_PATIENTS = [
  { id: 'A', label: 'Patient A', name: 'John D.',   fsCollection: 'incidents_A', baseHR: 75, baseBP: 120 },
  { id: 'B', label: 'Patient B', name: 'Maria S.',  fsCollection: 'incidents_B', baseHR: 72, baseBP: 118 },
  { id: 'C', label: 'Patient C', name: 'Robert K.', fsCollection: 'incidents_C', baseHR: 80, baseBP: 125 },
];
const MAX_PATIENTS = 6;

const initPatient = ({ baseHR = 75, baseBP = 120 } = {}) => ({
  vitals:           { heartRate: baseHR, systolicBP: baseBP, spo2: 98, troponin: 0.01 },
  history:          { heartRate: Array(20).fill(baseHR), systolicBP: Array(20).fill(baseBP), spo2: Array(20).fill(98), troponin: Array(20).fill(0.01) },
  riskScore:        12,
  riskLevel:        'Low',
  riskBreakdown:    { hr: 33, bp: 33, trop: 34 },
  assessments:      [],
  aiStatus:         'idle',
  isAiThinking:     false,
  stressTestActive: false,
  pastAssessments:  [],
});

const computeRisk = (v, prevHistory) => {
  const hrTrend  = v.heartRate  - prevHistory.heartRate[prevHistory.heartRate.length - 1];
  const bpTrend  = v.systolicBP - prevHistory.systolicBP[prevHistory.systolicBP.length - 1];
  let hrWeight   = Math.abs(v.heartRate - 75) * 1.2;
  let bpWeight   = Math.abs(120 - v.systolicBP) * 1.5;
  let tropWeight = (v.troponin / 0.1) * 100;
  if (hrTrend > 5)  hrWeight  *= 1.5;
  if (bpTrend < -5) bpWeight  *= 1.8;
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

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  // Core UI state
  const [showWelcome,        setShowWelcome]        = useState(true);
  const [viewMode,           setViewMode]           = useState('patient');
  const [isLive,             setIsLive]             = useState(false);
  const [activePatient,      setActivePatient]      = useState('A');
  const [showHistory,        setShowHistory]        = useState(true);
  const [expandedIncidentId, setExpandedIncidentId] = useState(null);
  const [editingNoteId,      setEditingNoteId]      = useState(null);
  const [noteText,           setNoteText]           = useState('');

  // Dynamic patient roster
  const [patientList, setPatientList] = useState(INITIAL_PATIENTS);
  const [patients,    setPatients]    = useState(
    Object.fromEntries(INITIAL_PATIENTS.map(cfg => [cfg.id, initPatient(cfg)]))
  );

  const patientListRef = useRef(patientList);
  useEffect(() => { patientListRef.current = patientList; }, [patientList]);

  const patientMap = Object.fromEntries(patientList.map(cfg => [cfg.id, cfg]));

  // Modal state
  const [addModal,       setAddModal]       = useState(false);
  const [newName,        setNewName]        = useState('');
  const [newId,          setNewId]          = useState('');
  const [idError,        setIdError]        = useState('');
  const [dischargeModal, setDischargeModal] = useState(null);

  // Firestore
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

  useEffect(() => {
    INITIAL_PATIENTS.forEach(cfg => subscribePatient(cfg.id, cfg.fsCollection));
    return () => Object.values(firestoreUnsubs.current).forEach(u => u());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Telemetry interval — all patients run simultaneously at 1.5 s
  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => {
      setPatients(prev => {
        const next = { ...prev };
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

  // Patient management
  const addPatient = () => {
    const sanitized = newId.trim().toUpperCase().replace(/\s+/g, '_');
    if (!sanitized || !newName.trim()) return;
    if (patientMap[sanitized]) { setIdError('ID already in use'); return; }
    if (patientList.length >= MAX_PATIENTS) return;
    const cfg = { id: sanitized, label: `Patient ${sanitized}`, name: newName.trim(), fsCollection: `incidents_${sanitized}`, baseHR: 75, baseBP: 120 };
    patientListRef.current = [...patientListRef.current, cfg];
    setPatientList(prev => [...prev, cfg]);
    setPatients(prev => ({ ...prev, [sanitized]: initPatient(cfg) }));
    subscribePatient(sanitized, cfg.fsCollection);
    setActivePatient(sanitized);
    setAddModal(false); setNewName(''); setNewId(''); setIdError('');
  };

  const dischargePatient = (id) => {
    const remaining = patientList.filter(cfg => cfg.id !== id);
    patientListRef.current = remaining;
    unsubscribePatient(id);
    setPatientList(remaining);
    setPatients(prev => { const { [id]: _dropped, ...rest } = prev; return rest; });
    if (activePatient === id) {
      setActivePatient(remaining[0]?.id ?? null);
      setExpandedIncidentId(null); setEditingNoteId(null); setNoteText('');
    }
    setDischargeModal(null);
  };

  // Cloud helpers
  const saveAssessmentToCloud = async (fsCollection, text, score, v, recommendations = []) => {
    try { await addDoc(collection(db, fsCollection), { text, score, vitals: v, recommendations, timestamp: new Date().toISOString() }); }
    catch (e) { console.error('Firestore error:', e); }
  };

  const saveDoctorNote = async (fsCollection, incidentId, text) => {
    try {
      await updateDoc(doc(db, fsCollection, incidentId), { doctorNote: text.trim(), noteTimestamp: serverTimestamp() });
      setEditingNoteId(null); setNoteText('');
    } catch (e) { console.error('Note save error:', e); }
  };

  // AI helpers
  const callGeminiAdvisor = async (patientId, currentVitals, currentRiskScore, currentRiskLevel) => {
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
            id: Date.now(), time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            text: assessment, recommendations, score: currentRiskScore, level: currentRiskLevel,
          }],
          isAiThinking: false, aiStatus: 'idle',
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
      callGeminiAdvisor(id, stressVitals, risk.riskScore, risk.riskLevel);
    }, 3000);
    setTimeout(() => setPatients(prev => ({ ...prev, [id]: { ...prev[id], stressTestActive: false } })), 15000);
  };

  // Derived values
  const advisoryEndRef = useRef(null);
  useEffect(() => { advisoryEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [patients[activePatient]?.assessments]);

  const sortedPatients = [...patientList].sort((a, b) => (patients[b.id]?.riskScore ?? 0) - (patients[a.id]?.riskScore ?? 0));
  const p            = patients[activePatient] ?? initPatient();
  const riskConfig   = getRiskConfig(p.riskLevel);
  const trendAlerts  = computeTrendAlerts(p.history, p.vitals);
  const anyCritical  = Object.values(patients).some(pt => pt.riskLevel === 'Critical');
  const criticalNames = patientList.filter(cfg => patients[cfg.id]?.riskLevel === 'Critical').map(cfg => cfg.name);
  const wardFull     = patientList.length >= MAX_PATIENTS;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a1628] font-sans flex flex-col">

      <PatientModals
        addModal={addModal} setAddModal={setAddModal}
        newName={newName} setNewName={setNewName}
        newId={newId} setNewId={setNewId}
        idError={idError} setIdError={setIdError}
        addPatient={addPatient}
        dischargeModal={dischargeModal} setDischargeModal={setDischargeModal}
        patientMap={patientMap}
        dischargePatient={dischargePatient}
      />

      {/* Welcome Modal */}
      {showWelcome && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0a1628]/90 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <div className="bg-[#0a1628] p-2.5 rounded-xl"><Activity className="w-7 h-7 text-white" /></div>
                <h2 className="text-2xl font-bold text-gray-900">Welcome to CEEWS</h2>
              </div>
              <button onClick={() => setShowWelcome(false)} className="text-gray-400 hover:text-gray-600 p-2 rounded-full hover:bg-gray-100 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-5 text-gray-700">
              <p className="text-base leading-relaxed">
                <strong className="text-gray-900">Cardiac Event Early Warning System (CEEWS)</strong> is an AI Clinical Advisory dashboard designed to prevent myocardial infarctions by analyzing the first 60 minutes of patient telemetry in the ER.
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

      {/* Critical Alert Strip */}
      {anyCritical && (
        <div className="bg-[#dc2626] critical-badge-pulse px-4 py-2 flex items-center justify-center gap-2 text-white text-sm font-semibold">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>CRITICAL ALERT — {criticalNames.join(' & ')} {criticalNames.length === 1 ? 'requires' : 'require'} immediate attention</span>
        </div>
      )}

      {/* Header */}
      <header className="bg-[#0a1628] border-b border-white/10 px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <div className="bg-white/10 p-2 rounded-lg"><Activity className="w-5 h-5 text-white" /></div>
          <div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-lg font-black text-white tracking-tight leading-none">CEEWS</h1>
              <span className="text-[10px] px-1.5 py-0.5 bg-white/10 text-white/40 rounded font-medium">v2.0</span>
            </div>
            <p className="text-[11px] text-white/35 tracking-wide mt-0.5">Cardiac Event Early Warning System</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden md:flex items-center bg-white/10 p-1 rounded-lg">
            <button onClick={() => setViewMode('patient')} className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${viewMode === 'patient' ? 'bg-[#0a1628] text-white' : 'text-white/60 hover:text-white'}`}>Patient View</button>
            <button onClick={() => setViewMode('triage')} className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${viewMode === 'triage' ? 'bg-[#0a1628] text-white' : 'text-white/60 hover:text-white'}`}>Triage Queue</button>
          </div>
          {isLive && (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
              <span className="text-xs text-green-300 font-medium whitespace-nowrap">Telemetry Live</span>
            </div>
          )}
          <button onClick={() => setShowWelcome(true)} className="flex items-center gap-1.5 px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-sm text-white/60 hover:text-white transition-all">
            <Info className="w-4 h-4" /><span className="hidden md:inline">About</span>
          </button>
          <button
            onClick={() => setIsLive(!isLive)}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-bold transition-all border ${isLive ? 'bg-red-500/15 text-red-300 border-red-500/30 hover:bg-red-500/25' : 'bg-green-500/15 text-green-300 border-green-500/30 hover:bg-green-500/25'}`}
          >
            {isLive ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isLive ? 'Stop Feed' : 'Live Feed'}</span>
          </button>
        </div>
      </header>

      {/* Alert Summary Bar */}
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

      {/* Patient Tab Bar */}
      <div className="bg-[#0a1628] border-b border-white/10 flex min-w-0">
        <div className="flex overflow-x-auto scrollbar-hide flex-1 min-w-0">
          {patientList.map(cfg => {
            const pt       = patients[cfg.id];
            const isActive = activePatient === cfg.id;
            const dotColor = pt?.riskLevel === 'Critical' ? 'bg-red-400' : pt?.riskLevel === 'Moderate' ? 'bg-amber-400' : 'bg-green-400';
            return (
              <div
                key={cfg.id}
                className={`group relative flex items-center gap-2 px-4 py-3 border-b-2 transition-all cursor-pointer shrink-0 ${isActive ? 'border-white text-white' : 'border-transparent text-white/40 hover:text-white/70 hover:border-white/20'}`}
                onClick={() => { setActivePatient(cfg.id); setExpandedIncidentId(null); setEditingNoteId(null); setNoteText(''); }}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor} ${pt?.riskLevel === 'Critical' ? 'animate-pulse' : ''}`} />
                <span className="text-sm font-medium whitespace-nowrap">{cfg.label}</span>
                <span className="hidden md:inline text-white/30 text-sm whitespace-nowrap">— {cfg.name}</span>
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
        <div className="shrink-0 flex items-center border-l border-white/10 px-3">
          {wardFull ? (
            <span className="text-xs text-white/25 font-medium px-3 py-2 whitespace-nowrap">Ward Full</span>
          ) : (
            <button onClick={() => setAddModal(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white/50 hover:text-white hover:bg-white/10 transition-all whitespace-nowrap">
              <Plus className="w-3.5 h-3.5" />Add Patient
            </button>
          )}
        </div>
      </div>

      {/* Main Dashboard */}
      <main className="flex-1 p-4 md:p-5 lg:p-6 xl:p-8">
        {viewMode === 'triage' ? (
          <TriageQueue
            sortedPatients={sortedPatients}
            patients={patients}
            callGeminiAdvisor={callGeminiAdvisor}
            setViewMode={setViewMode}
            setActivePatient={setActivePatient}
          />
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
                    <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">{patientMap[activePatient]?.label ?? 'Patient'}</p>
                    <p className="font-bold text-gray-900">{patientMap[activePatient]?.name}</p>
                    <div className="flex items-center space-x-1.5 mt-0.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
                      <span className="text-xs text-gray-400">{isLive ? 'Live monitoring' : 'Feed paused'}</span>
                    </div>
                  </div>
                </div>

                <VitalCard
                  label="Heart Rate" value={p.vitals.heartRate} unit="bpm"
                  history={p.history.heartRate} min={40} max={160}
                  isAbnormal={p.vitals.heartRate > 110 || p.vitals.heartRate < 50}
                  color={p.vitals.heartRate > 110 || p.vitals.heartRate < 50 ? '#dc2626' : '#16a34a'}
                  valueColor={p.vitals.heartRate > 110 || p.vitals.heartRate < 50 ? 'text-[#dc2626]' : 'text-[#16a34a]'}
                />
                <VitalCard
                  label="Systolic BP" value={p.vitals.systolicBP} unit="mmHg"
                  history={p.history.systolicBP} min={60} max={200}
                  isAbnormal={p.vitals.systolicBP > 160 || p.vitals.systolicBP < 90}
                  color={p.vitals.systolicBP > 160 || p.vitals.systolicBP < 90 ? '#dc2626' : '#2563eb'}
                  valueColor={p.vitals.systolicBP > 160 || p.vitals.systolicBP < 90 ? 'text-[#dc2626]' : 'text-gray-800'}
                />
                <VitalCard
                  label="SpO₂" value={p.vitals.spo2} unit="%"
                  history={p.history.spo2} min={70} max={100}
                  isAbnormal={p.vitals.spo2 < 94}
                  color={p.vitals.spo2 < 94 ? '#dc2626' : '#16a34a'}
                  valueColor={p.vitals.spo2 < 94 ? 'text-[#dc2626]' : 'text-[#16a34a]'}
                />
                <VitalCard
                  label="Troponin T" value={p.vitals.troponin} unit="ng/mL"
                  history={p.history.troponin} min={0} max={0.2}
                  isAbnormal={p.vitals.troponin > 0.04}
                  color="#d97706"
                  valueColor={p.vitals.troponin > 0.04 ? 'text-[#dc2626]' : 'text-[#d97706]'}
                  decimals={3}
                  progressBar={true}
                  progressMax={0.1}
                />

                {/* Trend Alerts */}
                <div className="bg-white rounded-xl p-4 border border-gray-200">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Trend Alerts</h3>
                  {trendAlerts.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {trendAlerts.map((alertText, i) => (
                        <span key={i} className="px-2.5 py-1 text-xs font-semibold text-amber-800 bg-amber-100 border border-amber-200 rounded-full">{alertText}</span>
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
                <RiskStatusCard
                  riskConfig={riskConfig}
                  riskScore={p.riskScore}
                  riskBreakdown={p.riskBreakdown}
                  stressTestActive={p.stressTestActive}
                  triggerStressTest={triggerStressTest}
                />
                <ClinicalAdvisory
                  assessments={p.assessments}
                  isAiThinking={p.isAiThinking}
                  aiStatus={p.aiStatus}
                  advisoryEndRef={advisoryEndRef}
                />
              </div>
            </div>

            <IncidentHistory
              showHistory={showHistory} setShowHistory={setShowHistory}
              pastAssessments={p.pastAssessments}
              patientCfg={patientMap[activePatient]}
              expandedIncidentId={expandedIncidentId} setExpandedIncidentId={setExpandedIncidentId}
              editingNoteId={editingNoteId} setEditingNoteId={setEditingNoteId}
              noteText={noteText} setNoteText={setNoteText}
              saveDoctorNote={saveDoctorNote}
            />
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 px-6 py-4 flex items-center justify-center">
        <p className="text-xs text-white/25 tracking-wide text-center">
          CEEWS &nbsp;·&nbsp; Cardiac Event Early Warning System &nbsp;·&nbsp; Built at hackUMBC 2025
        </p>
      </footer>
    </div>
  );
}
