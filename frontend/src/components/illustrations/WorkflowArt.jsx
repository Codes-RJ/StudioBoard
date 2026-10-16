import { useId } from 'react';

const ink = '#173f35';
const muted = '#687b65';
const rule = '#cbd3c4';
const paper = '#fbfaf6';
const sage = '#e4e9dd';
const accent = '#b35f45';

function Pane({ x, y, width, height, label, children }) {
  return <g>
    <rect x={x} y={y} width={width} height={height} rx="5" fill={paper} stroke={rule} strokeWidth="1.5" />
    <path d={`M${x} ${y + 32}H${x + width}`} stroke={rule} />
    <circle cx={x + 15} cy={y + 16} r="3" fill={accent} />
    <text x={x + 28} y={y + 21} fill={ink} fontSize="13" letterSpacing="1.2">{label}</text>
    {children}
  </g>;
}

function Trend({ x = 0, y = 0 }) {
  return <g transform={`translate(${x} ${y})`}>
    {[0, 36, 72].map((v) => <path key={v} d={`M0 ${v}H208`} stroke={rule} strokeWidth="1" />)}
    <path d="M0 78L36 57L70 63L105 37L139 45L174 19L208 5V96H0Z" fill={sage} />
    <path d="M0 78L36 57L70 63L105 37L139 45L174 19L208 5" stroke={ink} strokeWidth="2.5" fill="none" />
    <circle cx="208" cy="5" r="4" fill={accent} />
  </g>;
}

// A family of editorial diagrams. Labels describe examples, never live controls.
export default function WorkflowArt({ kind = 'import', className = '' }) {
  const id = useId();
  const labels = {
    overview: 'Illustration of files moving through review into a chart',
    import: 'Illustration of spreadsheet files entering a browser workspace',
    review: 'Illustration of a missing table value highlighted for your review',
    explore: 'Illustration of a workspace combining a trend and category chart',
    backup: 'Illustration of a workspace exported as a portable backup, with optional encryption'
  };
  return <svg viewBox="0 0 560 340" role="img" aria-labelledby={id} focusable="false" className={`workflow-art ${className}`}>
    <title id={id}>{labels[kind]}</title>
    <g fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 25H540M20 315H540" stroke={rule} />
      <text x="20" y="16" fontSize="11" fill={muted} letterSpacing="2">WORKSPACE / {kind === 'overview' ? 'AT A GLANCE' : kind.toUpperCase()}</text>
      <path d="M20 25V33M540 25V33M20 307V315M540 307V315" stroke={muted} />

      {kind === 'overview' && <>
        <path d="M95 211H468" stroke={rule} strokeDasharray="3 7" />
        <g transform="translate(27 87)">
          <rect x="0" y="7" width="104" height="136" rx="3" fill={sage} stroke={rule} transform="rotate(-6 52 75)" />
          <path d="M14 0H88L111 23V132H14Z" fill={paper} stroke={ink} strokeWidth="1.5" />
          <path d="M88 0V23H111M30 48H92M30 65H92M30 82H92M30 99H70" fill="none" stroke={rule} />
          <path d="M30 48H92" stroke={ink} strokeWidth="3" />
          <text x="14" y="165" fill={muted} fontSize="13">01 / IMPORT</text>
        </g>
        <path d="M155 156H192M185 149L192 156L185 163" stroke={accent} strokeWidth="2" fill="none" />
        <Pane x={209} y={103} width={118} height={106} label="REVIEW">
          {[151, 173, 195].map((y, i) => <g key={y}><path d={`M225 ${y}H268`} stroke={rule} strokeWidth="3" /><path d={`M284 ${y - 3}L288 ${y + 1}L296 ${y - 7}`} stroke={i === 1 ? accent : ink} fill="none" strokeWidth="2" /></g>)}
        </Pane>
        <text x="209" y="252" fill={muted} fontSize="13">02 / CHECK</text>
        <path d="M342 156H375M368 149L375 156L368 163" stroke={accent} strokeWidth="2" fill="none" />
        <Pane x={390} y={70} width={150} height={156} label="EXPLORE">
          <g transform="translate(408 124) scale(.55)"><Trend /></g>
          <path d="M408 196H520" stroke={rule} />
        </Pane>
        <text x="390" y="252" fill={muted} fontSize="13">03 / SEE</text>
      </>}

      {kind === 'import' && <>
        <rect x="47" y="82" width="124" height="158" rx="4" fill={sage} stroke={rule} transform="rotate(-7 109 161)" />
        <path d="M69 66H153L182 95V250H69Z" fill={paper} stroke={ink} strokeWidth="1.5" />
        <path d="M153 66V95H182" fill={sage} stroke={ink} strokeWidth="1.5" />
        <text x="87" y="127" fill={ink} fontSize="17">CSV</text>
        {[149, 173, 197, 221].map((y) => <path key={y} d={`M87 ${y}H163`} stroke={rule} />)}
        <path d="M114 149V221M139 149V221" stroke={rule} />
        <path d="M201 163H259M251 155L259 163L251 171" fill="none" stroke={accent} strokeWidth="2" />
        <Pane x={279} y={77} width={244} height={194} label="YOUR WORKSPACE">
          <rect x="297" y="130" width="208" height="28" rx="2" fill={sage} />
          <g fill={ink} fontSize="14"><text x="309" y="149">sales.csv</text><text x="309" y="187">forecast.xlsx</text><text x="309" y="225">notes.md</text></g>
          {[144, 182, 220].map((y) => <path key={y} d={`M478 ${y}H489`} stroke={muted} strokeWidth="2" />)}
        </Pane>
        <text x="69" y="289" fill={muted} fontSize="12">FILES &amp; FOLDERS</text>
      </>}

      {kind === 'review' && <>
        <Pane x={42} y={65} width={476} height={214} label="SOURCE REVIEW">
          <g fill={muted} fontSize="13"><text x="63" y="125">REGION</text><text x="236" y="125">REVENUE</text><text x="392" y="125">STATUS</text></g>
          {[137, 180, 223, 266].map((y) => <path key={y} d={`M60 ${y}H500`} stroke={rule} />)}
          <rect x="225" y="187" width="128" height="28" rx="2" fill="#f1e2d5" />
          <g fontSize="16" fill={ink}><text x="63" y="164">North</text><text x="63" y="207">South</text><text x="63" y="250">West</text><text x="236" y="164">12,480</text><text x="236" y="250">18,620</text></g>
          <text x="236" y="207" fontSize="14" fill="#8f4c34">missing</text>
          {[158, 244].map((y) => <path key={y} d={`M395 ${y}L401 ${y + 6}L412 ${y - 7}`} stroke={ink} strokeWidth="2" fill="none" />)}
          <circle cx="403" cy="201" r="8" stroke={accent} fill="none" strokeWidth="1.5" /><path d="M403 197V201M403 205V205.5" stroke={accent} strokeWidth="1.5" />
        </Pane>
        <text x="42" y="299" fill={muted} fontSize="12">INSPECT FIRST. CHANGES ARE YOUR CHOICE.</text>
      </>}

      {kind === 'explore' && <>
        <Pane x={34} y={63} width={492} height={224} label="A VIEW OF YOUR DATA">
          <text x="54" y="121" fill={muted} fontSize="12">REVENUE OVER TIME</text>
          <Trend x={54} y={143} />
          <path d="M288 112V266" stroke={rule} />
          <text x="310" y="121" fill={muted} fontSize="12">BY REGION</text>
          {[88, 132, 108].map((width, i) => <rect key={i} x="310" y={145 + i * 36} width={width} height="18" rx="2" fill={i === 1 ? ink : '#a1b396'} />)}
          <text x="54" y="263" fill={muted} fontSize="11">JAN</text><text x="237" y="263" fill={muted} fontSize="11">JUN</text>
          <path d="M310 253H493" stroke={rule} />
        </Pane>
      </>}

      {kind === 'backup' && <>
        <Pane x={35} y={73} width={226} height={190} label="WORKSPACE">
          {[133, 171, 209].map((y, i) => <g key={y}><rect x="54" y={y - 9} width="19" height="23" rx="2" fill={i === 2 ? '#f1e2d5' : sage} stroke={rule} /><path d={`M87 ${y}H231M87 ${y + 9}H${i === 1 ? 174 : 196}`} stroke={rule} strokeWidth="2" /></g>)}
        </Pane>
        <path d="M280 167H337M329 159L337 167L329 175" fill="none" stroke={accent} strokeWidth="2" />
        <path d="M365 68H473L507 102V257H365Z" fill={paper} stroke={ink} strokeWidth="1.5" />
        <path d="M473 68V102H507" fill={sage} stroke={ink} strokeWidth="1.5" />
        <path d="M398 115V162M389 153L398 162L407 153" fill="none" stroke={ink} strokeWidth="2" />
        <text x="383" y="190" fill={ink} fontSize="15">BACKUP</text><text x="383" y="214" fill={muted} fontSize="12">PORTABLE COPY</text>
        <text x="35" y="293" fill={muted} fontSize="12">OPTIONAL PASSPHRASE / KEEP A SEPARATE COPY</text>
      </>}
    </g>
  </svg>;
}
