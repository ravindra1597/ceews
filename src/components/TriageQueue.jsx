import { User, Clock, Stethoscope } from 'lucide-react';
import { formatTimeSince } from '../utils.js';

export default function TriageQueue({ sortedPatients, patients, callGeminiAdvisor, setViewMode, setActivePatient }) {
  return (
    <div className="max-w-7xl mx-auto w-full">
      <div className="bg-[#0d1f3c] rounded-xl p-4 mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Triage Queue</h2>
          <p className="text-xs text-white/40">Patients ranked by real-time risk score</p>
        </div>
        <p className="text-sm text-white/60 font-medium">{sortedPatients.length} Patients Monitored — Updated Live</p>
      </div>
      <div className="space-y-2">
        {sortedPatients.map((cfg, index) => {
          const pt = patients[cfg.id];
          if (!pt) return null;
          const rank = index + 1;
          const level = pt.riskLevel;
          const levelStyles = {
            Critical: { border: 'border-l-[#dc2626]', bg: 'bg-red-500/5',    nameColor: 'text-white' },
            Moderate: { border: 'border-l-[#d97706]', bg: 'bg-amber-500/5',  nameColor: 'text-white' },
            Low:      { border: 'border-l-gray-300',  bg: 'bg-white',         nameColor: 'text-gray-900' },
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
                  <span className={`font-semibold text-sm ${levelStyles.nameColor}`}>{cfg.name}</span>
                </div>
              </div>
              {/* Risk */}
              <div className="md:col-span-2 flex items-center gap-3">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${riskBadgeStyles}`}>{level.toUpperCase()}</span>
                <span className="font-mono font-bold text-lg text-gray-700">{pt.riskScore}</span>
              </div>
              {/* Vitals */}
              <div className="md:col-span-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs font-mono">
                <div className={`flex items-center justify-between ${pt.vitals.heartRate > 110 || pt.vitals.heartRate < 50 ? 'text-red-600' : 'text-gray-600'}`}>
                  <span className="text-gray-400 font-sans mr-2">HR</span><span className="font-semibold">{pt.vitals.heartRate}</span>
                </div>
                <div className={`flex items-center justify-between ${pt.vitals.systolicBP > 160 || pt.vitals.systolicBP < 90 ? 'text-red-600' : 'text-gray-600'}`}>
                  <span className="text-gray-400 font-sans mr-2">BP</span><span className="font-semibold">{pt.vitals.systolicBP}</span>
                </div>
                <div className={`flex items-center justify-between ${pt.vitals.spo2 < 94 ? 'text-red-600' : 'text-gray-600'}`}>
                  <span className="text-gray-400 font-sans mr-2">SpO₂</span><span className="font-semibold">{pt.vitals.spo2}%</span>
                </div>
                <div className={`flex items-center justify-between ${pt.vitals.troponin > 0.04 ? 'text-red-600' : 'text-gray-600'}`}>
                  <span className="text-gray-400 font-sans mr-2">Trop</span><span className="font-semibold">{pt.vitals.troponin.toFixed(3)}</span>
                </div>
              </div>
              {/* Last Assessment */}
              <div className="md:col-span-2 flex items-center gap-2 text-xs text-gray-500">
                <Clock className="w-3.5 h-3.5" />
                <span>AI Note: {lastAssessmentTime}</span>
              </div>
              {/* Actions */}
              <div className="md:col-span-2 flex items-center justify-end gap-2">
                <button
                  onClick={() => callGeminiAdvisor(cfg.id, pt.vitals, pt.riskScore, pt.riskLevel)}
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
  );
}
