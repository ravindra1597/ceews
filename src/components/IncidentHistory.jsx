import { History, ChevronDown, ChevronUp, Clock, Stethoscope, Activity, ClipboardList, Printer } from 'lucide-react';
import { exportClinicalSummary } from '../utils.js';

export default function IncidentHistory({
  showHistory, setShowHistory,
  pastAssessments,
  patientCfg,
  expandedIncidentId, setExpandedIncidentId,
  editingNoteId, setEditingNoteId,
  noteText, setNoteText,
  saveDoctorNote,
}) {
  return (
    <div className="mt-5">
      <button
        onClick={() => setShowHistory(h => !h)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-[#0a1628] rounded-xl text-white hover:bg-[#1a2a48] transition-colors"
      >
        <div className="flex items-center space-x-2">
          <History className="w-4 h-4 text-white/60" />
          <span className="font-semibold text-sm tracking-wide">Incident History</span>
          <span className="text-xs text-white/30">— {patientCfg?.name}</span>
          {pastAssessments.length > 0 && (
            <span className="text-xs px-2 py-0.5 bg-white/10 text-white/50 rounded-full">
              {pastAssessments.length} record{pastAssessments.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {showHistory ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
      </button>

      {showHistory && (
        <div className="mt-3">
          {pastAssessments.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
              <Clock className="w-8 h-8 mx-auto mb-3 text-gray-200" />
              <p className="text-sm text-gray-400">No incident records yet for {patientCfg?.name}.</p>
              <p className="text-xs text-gray-300 mt-1">Assessments will appear here once saved to the cloud.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {pastAssessments.map((a) => {
                const level = a.score >= 70 ? 'Critical' : a.score >= 30 ? 'Moderate' : 'Low';
                const isExpanded = expandedIncidentId === a.id;
                const ts      = new Date(a.timestamp);
                const dateStr = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const timeStr = ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const levelStyles = {
                  Critical: { badge: 'bg-red-100 text-[#dc2626] border-red-200',    border: 'border-l-[#dc2626]' },
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
                            onClick={() => exportClinicalSummary(patientCfg, a)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200 rounded-lg transition-colors text-xs font-semibold"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            Export
                          </button>
                        </div>
                        <div className="sm:hidden">
                          <button
                            onClick={() => exportClinicalSummary(patientCfg, a)}
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
                                { label: 'Heart Rate',  value: `${a.vitals.heartRate} bpm`,              alert: a.vitals.heartRate > 110 || a.vitals.heartRate < 50 },
                                { label: 'Systolic BP', value: `${a.vitals.systolicBP} mmHg`,             alert: a.vitals.systolicBP > 160 || a.vitals.systolicBP < 90 },
                                { label: 'SpO₂',        value: `${a.vitals.spo2}%`,                      alert: a.vitals.spo2 < 94 },
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
                        {a.recommendations?.length > 0 && (
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
                                  onClick={() => saveDoctorNote(patientCfg?.fsCollection, a.id, noteText)}
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
  );
}
