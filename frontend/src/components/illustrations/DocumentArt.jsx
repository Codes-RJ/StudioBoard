import { useId } from 'react';

// Local storage is not depicted as encrypted. The legal pages explain its limits.
export default function DocumentArt({ kind = 'privacy' }) {
  const id = useId();
  const missing = kind === 'missing';
  const labels = {
    privacy: 'Data rows kept inside a browser workspace, with a separate backup copy',
    terms: 'An open document describing ownership, care and use of your work',
    missing: 'An incomplete route reconnecting to the home page'
  };
  return <svg className={`document-art ${missing ? 'not-found-art' : ''}`} viewBox="0 0 420 310" role="img" aria-labelledby={id} focusable="false">
    <title id={id}>{labels[kind]}</title>
    <g strokeLinecap="round" strokeLinejoin="round" fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace">
      <path d="M22 28H398M22 280H398" stroke="#cbd3c4" />
      <text x="22" y="19" fontSize="10" fill="#687b65" letterSpacing="2">{missing ? 'WAYFINDING / 404' : kind === 'privacy' ? 'A NOTE ON YOUR DATA' : 'A NOTE ON YOUR WORK'}</text>
      {kind === 'privacy' && <>
        <rect x="34" y="61" width="302" height="173" rx="5" fill="#fbfaf6" stroke="#173f35" strokeWidth="1.5" />
        <path d="M34 92H336" stroke="#cbd3c4" />
        <circle cx="50" cy="77" r="3" fill="#b35f45" /><text x="65" y="81" fontSize="11" fill="#173f35">THIS BROWSER</text>
        <rect x="54" y="111" width="121" height="102" rx="3" fill="#e4e9dd" />
        <g stroke="#a6b69c">{[134, 157, 180].map((y) => <path key={y} d={`M66 ${y}H161`} />)}<path d="M94 123V201M129 123V201" /></g>
        <path d="M195 125H309M195 146H288M195 180H304M195 201H266" stroke="#cbd3c4" strokeWidth="3" />
        <path d="M297 216V250H350" stroke="#b35f45" strokeWidth="1.5" fill="none" strokeDasharray="3 5" />
        <path d="M352 214H377L391 228V264H352Z" fill="#fbfaf6" stroke="#173f35" strokeWidth="1.5" />
        <path d="M377 214V228H391M362 240H381M362 249H376" stroke="#cbd3c4" fill="none" />
        <text x="34" y="260" fill="#687b65" fontSize="11">LOCAL WORKSPACE / PORTABLE COPY</text>
      </>}
      {kind === 'terms' && <>
        <path d="M92 61H292V247H92Z" fill="#e4e9dd" />
        <path d="M111 48H270L309 87V250H111Z" fill="#fbfaf6" stroke="#173f35" strokeWidth="1.5" />
        <path d="M270 48V87H309" fill="#e4e9dd" stroke="#173f35" strokeWidth="1.5" />
        <text x="131" y="108" fontSize="11" fill="#173f35">YOUR WORK. YOUR CHOICES.</text>
        {[133, 168, 203].map((y, i) => <g key={y}><text x="131" y={y} fill="#b35f45" fontSize="11">0{i + 1}</text><path d={`M160 ${y - 4}H286M160 ${y + 7}H${i === 1 ? 248 : 272}`} stroke="#cbd3c4" strokeWidth="2" /></g>)}
        <path d="M131 232H220" stroke="#173f35" /><circle cx="278" cy="232" r="3" fill="#b35f45" />
        <path d="M70 88V247M66 88H74M66 247H74" stroke="#a6b69c" />
      </>}
      {missing && <>
        <text x="29" y="157" fontFamily="Georgia, serif" fontSize="100" letterSpacing="-7" fill="#173f35">404<tspan fill="#b35f45">.</tspan></text>
        <path d="M53 204H147Q167 204 167 224V231Q167 251 187 251H269Q289 251 289 231V132Q289 112 309 112H337" fill="none" stroke="#8d9f81" strokeWidth="2" strokeDasharray="3 7" />
        <circle cx="53" cy="204" r="5" fill="#b35f45" />
        <rect x="318" y="83" width="78" height="62" rx="4" fill="#fbfaf6" stroke="#173f35" strokeWidth="1.5" />
        <path d="M318 100H396M330 111H346M330 122H379M330 133H367" stroke="#cbd3c4" />
        <text x="318" y="171" fontSize="11" fill="#173f35" letterSpacing="1.5">HOME</text>
        <path d="M298 112H310M304 106L310 112L304 118" stroke="#173f35" fill="none" strokeWidth="1.5" />
      </>}
    </g>
  </svg>;
}
