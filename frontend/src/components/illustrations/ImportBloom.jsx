export default function ImportBloom() {
  return <svg className="import-bloom" viewBox="0 0 420 420" aria-hidden="true" focusable="false">
    <g transform="translate(210 210)" fill="#cbdab9" fillOpacity=".6" stroke="#6e8962" strokeOpacity=".35" strokeWidth="1.2">
      {Array.from({ length: 8 }, (_, i) => <ellipse key={i} cx="0" cy="-93" rx="45" ry="105" transform={`rotate(${i * 45})`} />)}
      <circle r="28" fill="#a2b88f" /><circle r="13" fill="#edf0e5" />
    </g>
  </svg>;
}
