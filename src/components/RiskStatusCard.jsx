import { AlertTriangle, Zap } from 'lucide-react';

export default function RiskStatusCard({ riskConfig, riskScore, riskBreakdown, stressTestActive, triggerStressTest }) {
  return (
    <>
      {/* Risk badge + score ring */}
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
              disabled={stressTestActive}
              className={`flex items-center space-x-2 px-6 py-3 rounded-xl font-bold text-sm transition-all ${
                stressTestActive ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#0a1628] text-white hover:bg-[#1a2a48]'
              }`}
            >
              <Zap className={`w-4 h-4 ${stressTestActive ? '' : 'text-amber-400'}`} />
              <span>{stressTestActive ? 'Analysis Pipeline Active...' : 'Trigger Crash Demo'}</span>
            </button>
          </div>
          <div className={`flex-shrink-0 w-36 h-36 rounded-full border-4 ${riskConfig.ringColor} flex flex-col items-center justify-center bg-white shadow-md`}>
            <span className={`font-black font-mono leading-none ${riskConfig.scoreColor}`} style={{ fontSize: '3.5rem' }}>
              {riskScore}
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
            { label: 'Heart Rate',     value: riskBreakdown.hr,   color: 'bg-[#16a34a]' },
            { label: 'Blood Pressure', value: riskBreakdown.bp,   color: 'bg-[#2563eb]' },
            { label: 'Troponin T',     value: riskBreakdown.trop, color: 'bg-[#d97706]' },
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
    </>
  );
}
