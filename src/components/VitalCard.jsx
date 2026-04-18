import Sparkline from './Sparkline.jsx';

// progressBar=true renders a progress bar instead of a sparkline (used for Troponin).
// progressMax is the value at which the bar is full (default 0.1 ng/mL).
// decimals controls display precision of `value`.
export default function VitalCard({
  label, value, unit, history, color, min, max, isAbnormal,
  valueColor,
  decimals = 0,
  progressBar = false,
  progressMax = 0.1,
}) {
  const displayValue = decimals > 0 ? Number(value).toFixed(decimals) : value;

  return (
    <div className="bg-white rounded-xl p-4 border border-gray-200">
      <div className={`flex items-center justify-between${progressBar ? ' mb-3' : ''}`}>
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
        <span className={`text-3xl font-mono font-bold ${valueColor}`}>
          {displayValue}<span className="text-sm font-sans text-gray-400 ml-1 font-normal">{unit}</span>
        </span>
      </div>
      {progressBar ? (
        <>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className={`h-full rounded-full transition-all duration-500 ${isAbnormal ? 'bg-[#dc2626]' : 'bg-[#d97706]'}`}
              style={{ width: `${Math.min((value / progressMax) * 100, 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-xs text-gray-300">0.00</span>
            <span className="text-xs text-gray-400">Normal &lt;0.04 ng/mL</span>
            <span className="text-xs text-gray-300">0.10+</span>
          </div>
        </>
      ) : (
        <Sparkline data={history} color={color} min={min} max={max} />
      )}
    </div>
  );
}
