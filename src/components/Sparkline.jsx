export default function Sparkline({ data, color, min, max }) {
  const width = 100;
  const height = 28;
  if (data.length === 0) return null;
  const range = max - min || 1;
  const points = data.map((val, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * width;
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible mt-2" style={{ height: 28 }}>
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  );
}
