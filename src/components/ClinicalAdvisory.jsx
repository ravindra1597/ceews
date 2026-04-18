import { Stethoscope, Activity, ClipboardList, Loader2 } from 'lucide-react';

export default function ClinicalAdvisory({ assessments, isAiThinking, aiStatus, advisoryEndRef }) {
  const latestAssessment = assessments[assessments.length - 1];

  return (
    <>
      {/* AI Clinical Advisory */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3.5 bg-[#0a1628] flex items-center justify-between">
          <div className="flex items-center space-x-2 text-white">
            <Stethoscope className="w-4 h-4" />
            <span className="font-semibold text-sm tracking-wide">AI Clinical Advisory</span>
          </div>
          {isAiThinking ? (
            <span className="text-xs px-2.5 py-1 bg-amber-500/20 text-amber-300 rounded-full animate-pulse flex items-center">
              <Activity className="w-3 h-3 mr-1.5" />Analyzing vitals...
            </span>
          ) : aiStatus === 'error' ? (
            <span className="text-xs px-2.5 py-1 bg-red-500/20 text-red-300 rounded-full">API Error</span>
          ) : (
            <span className="text-xs px-2.5 py-1 bg-white/10 text-white/50 rounded-full">
              {assessments.length > 0 ? `${assessments.length} assessment${assessments.length > 1 ? 's' : ''}` : 'Awaiting analysis'}
            </span>
          )}
        </div>
        <div className="p-5">
          {assessments.length === 0 && !isAiThinking ? (
            <div className="text-center py-10">
              <Stethoscope className="w-10 h-10 mx-auto mb-3 text-gray-200" />
              <p className="text-sm text-gray-400">No assessments yet.</p>
              <p className="text-xs text-gray-300 mt-1">Click "Trigger Crash Demo" to consult the AI.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {assessments.map((a) => (
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
              {isAiThinking && (
                <div className="bg-gray-50 rounded-lg p-4 border border-amber-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-amber-600 uppercase tracking-wider flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Gemini is analyzing vitals...
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-500 border border-amber-200">Pending</span>
                  </div>
                  <div className="space-y-2 animate-pulse">
                    <div className="h-3 bg-amber-100 rounded w-full" />
                    <div className="h-3 bg-amber-100 rounded w-5/6" />
                    <div className="h-3 bg-amber-100 rounded w-4/6" />
                  </div>
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
    </>
  );
}
