const examples = [
  { label: 'Compare categories', kind: 'bars' },
  { label: 'Follow a trend', kind: 'line' },
  { label: 'Find relationships', kind: 'scatter' }
];

export default function ChartGallery() {
  return <div className="chart-gallery">{examples.map(({ label, kind }, index) => <figure key={kind} className="chart-swatch" data-reveal data-reveal-delay={index * 80}>
    <svg viewBox="0 0 240 170" role="img" focusable="false" aria-label={`${label}: illustrative ${kind === 'bars' ? 'bar' : kind} chart`}>
      <g strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 12H226M14 12V18M226 12V18" stroke="#cbd3c4" />
        {[51, 89, 127].map((y) => <path key={y} d={`M28 ${y}H218`} stroke="#dce1d5" />)}
        <path d="M28 35V137H218" stroke="#a6b69c" fill="none" />
        {kind === 'bars' && [45, 72, 59, 99, 79].map((height, i) => <rect key={i} x={41 + i * 35} y={137 - height} width="18" height={height} rx="1.5" fill={i === 3 ? '#173f35' : '#a1b396'} />)}
        {kind === 'line' && <>
          <path d="M28 120L65 96L103 105L141 69L179 78L218 40V137H28Z" fill="#e4e9dd" />
          <path d="M28 120L65 96L103 105L141 69L179 78L218 40" fill="none" stroke="#173f35" strokeWidth="2.5" />
          <circle cx="218" cy="40" r="4.5" fill="#b35f45" />
        </>}
        {kind === 'scatter' && <>
          <path d="M34 128L215 41" stroke="#a6b69c" strokeWidth="1.5" strokeDasharray="3 5" />
          {[[40,120],[54,97],[76,111],[90,78],[111,89],[127,62],[143,79],[160,48],[175,65],[199,38],[212,52]].map(([x,y],i) => <circle key={i} cx={x} cy={y} r="4" fill={i === 4 ? '#b35f45' : '#527557'} />)}
        </>}
        <g fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace" fontSize="10" fill="#687b65">
          <text x="28" y="158">{kind === 'bars' ? 'A' : kind === 'line' ? 'JAN' : '0'}</text>
          <text x="218" y="158" textAnchor="end">{kind === 'bars' ? 'E' : kind === 'line' ? 'JUN' : '10'}</text>
        </g>
      </g>
    </svg>
    <figcaption><span aria-hidden="true">0{index + 1}</span>{label}</figcaption>
  </figure>)}</div>;
}
