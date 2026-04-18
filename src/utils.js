export const getRiskConfig = (level) => {
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

export const computeTrendAlerts = (history, vitals) => {
  const alerts = [];
  const historyLength = 10;

  const checkTrend = (arr, direction) => {
    if (!arr || arr.length < historyLength) return false;
    const recent = arr.slice(-historyLength);
    for (let i = 1; i < recent.length; i++) {
      if (direction === 'rising'  && recent[i] <= recent[i - 1]) return false;
      if (direction === 'falling' && recent[i] >= recent[i - 1]) return false;
    }
    return recent[0] !== recent[recent.length - 1];
  };

  if (checkTrend(history.heartRate,  'rising')  && vitals.heartRate  > 100) alerts.push('↑ HR Sustained Rise');
  if (checkTrend(history.systolicBP, 'rising')  && vitals.systolicBP > 140) alerts.push('↑ BP Sustained Rise');
  else if (checkTrend(history.systolicBP, 'falling') && vitals.systolicBP < 90) alerts.push('↓ BP Sustained Drop');
  if (checkTrend(history.spo2,       'falling') && vitals.spo2       < 94)  alerts.push('↓ SpO2 Sustained Drop');
  if (checkTrend(history.troponin,   'rising'))  alerts.push('↑ Troponin Sustained Rise');

  return alerts;
};

export const formatTimeSince = (isoString) => {
  if (!isoString) return 'Never';
  const seconds = Math.floor((new Date() - new Date(isoString)) / 1000);
  if (seconds < 60)  return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)  return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)    return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export const exportClinicalSummary = (patientCfg, incident) => {
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

  const noteHtml = incident.doctorNote
    ? `<h3>Clinical Note</h3><p>${incident.doctorNote}</p>`
    : '';

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
