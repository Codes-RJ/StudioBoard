const axis = <path d="M10 6V44H114" fill="none" stroke="#cbd5e1" strokeWidth="1.5" />;
const dots = [[22, 35, 3], [39, 26, 4], [58, 31, 3], [76, 17, 5], [98, 11, 3]];

export default function ChartTypePreview({ type }) {
  let artwork;
  if (['line', 'spline', 'stepLine', 'waveform', 'sineWave', 'multiSpline'].includes(type)) {
    const path = type === 'stepLine' ? 'M12 36H35V27H60V31H82V13H112' :
      type === 'sineWave' || type === 'waveform' ? 'M10 27C20 4 30 4 40 27S60 50 70 27 90 4 110 27' :
        'M12 38C30 34 32 16 50 23S72 39 83 19 100 9 112 13';
    artwork = <>{axis}<path d={path} fill="none" stroke="#24523f" strokeWidth="3" strokeLinejoin="round" />{type === 'multiSpline' && <path d="M12 31C30 12 48 40 65 24S95 34 112 20" fill="none" stroke="#bc674d" strokeWidth="2" />}</>;
  } else if (['area', 'smoothArea', 'rangeArea', 'streamgraph'].includes(type)) {
    artwork = <>{axis}<path d="M11 39C26 34 35 12 52 21S76 38 88 18 104 12 113 15V44H11Z" fill="#90aa89" opacity=".45"/><path d="M11 39C26 34 35 12 52 21S76 38 88 18 104 12 113 15" fill="none" stroke="#24523f" strokeWidth="2.5"/>{type === 'rangeArea' && <path d="M11 32C30 27 38 8 55 15S84 25 113 9" fill="none" stroke="#bc674d" strokeWidth="2"/>}</>;
  } else if (['bar', 'histogram', 'waterfall', 'stackedBar'].includes(type)) {
    artwork = <>{axis}{[18, 39, 60, 81, 102].map((x, i) => <g key={x}><rect x={x} y={42-[15,27,20,34,25][i]} width="13" height={[15,27,20,34,25][i]} rx="2" fill={i % 2 ? '#24523f' : '#90aa89'}/>{type === 'stackedBar' && <rect x={x} y={42-[15,27,20,34,25][i]} width="13" height="7" rx="2" fill="#bc674d"/>}</g>)}</>;
  } else if (type === 'horizontalBar') {
    artwork = <>{axis}{[12,24,36].map((y,i)=><rect key={y} x="14" y={y} width={[73,96,52][i]} height="7" rx="2" fill={i===1?'#24523f':'#90aa89'}/>)}</>;
  } else if (['pie', 'donut'].includes(type)) {
    artwork = <g transform="translate(60 26)"><circle r="20" fill="#dce5d5"/><path d="M0 0V-20A20 20 0 0 1 17.3 10Z" fill="#24523f"/><path d="M0 0L17.3 10A20 20 0 0 1 -17 11Z" fill="#bc674d"/>{type === 'donut' && <circle r="9" fill="white"/>}</g>;
  } else if (['scatter', 'bubble', 'density'].includes(type)) {
    artwork = <>{axis}{dots.map(([cx,cy,r],i)=><circle key={cx} cx={cx} cy={cy} r={type==='bubble'?r*1.6:r} fill={i>2?'#24523f':'#90aa89'} opacity={type==='density'?'.45':'.85'}/>)}{type==='density' && <><ellipse cx="70" cy="24" rx="30" ry="15" fill="none" stroke="#24523f"/><ellipse cx="70" cy="24" rx="19" ry="9" fill="none" stroke="#90aa89"/></>}</>;
  } else if (type === 'heatmap') {
    const colors = ['#3b4cc0','#8db0fe','#f7f7f7','#f49a7b','#b40426'];
    artwork = <g transform="translate(31 2)">{Array.from({length:16},(_,i)=><rect key={i} x={(i%4)*13} y={Math.floor(i/4)*12} width="12" height="11" fill={colors[(i*3+Math.floor(i/4))%colors.length]}/>)}</g>;
  } else if (['box', 'violin', 'strip', 'ecdf'].includes(type)) {
    artwork = <>{axis}{type==='box' && [35,75].map((x)=><g key={x}><line x1={x} y1="9" x2={x} y2="41" stroke="#24523f"/><rect x={x-9} y="17" width="18" height="16" fill="#dce5d5" stroke="#24523f"/><line x1={x-9} y1="25" x2={x+9} y2="25" stroke="#24523f"/></g>)}{type==='violin' && <path d="M58 7C43 14 47 23 36 26 47 30 43 40 58 45 73 40 69 30 80 26 69 23 73 14 58 7Z" fill="#dce5d5" stroke="#24523f"/>}{type==='strip' && dots.map(([x,y],i)=><circle key={x} cx={x} cy={y} r="3" fill="#24523f"/>)}{type==='ecdf' && <path d="M12 40H28V34H47V25H68V18H91V9H113" fill="none" stroke="#24523f" strokeWidth="3"/>}</>;
  } else if (['radar', 'polarScatter', 'radialBar'].includes(type)) {
    artwork = <g transform="translate(60 26)"><circle r="21" fill="none" stroke="#cbd5e1"/><circle r="12" fill="none" stroke="#e2e8f0"/><path d="M0-21L20 7 12 17-14 16-20-7Z" fill="#90aa89" opacity=".45" stroke="#24523f"/>{type==='polarScatter' && dots.slice(0,4).map(([x,y],i)=><circle key={i} cx={(x-55)/2} cy={(y-25)/2} r="3" fill="#24523f"/>)}</g>;
  } else if (['scatter3d', 'surface3d', 'mesh3d', 'bubble4d', 'contour'].includes(type)) {
    artwork = <g><path d="M27 39L58 9 103 18 74 44Z" fill="#dce5d5" stroke="#24523f"/><path d="M27 39L67 27 103 18M58 9L67 27 74 44" fill="none" stroke="#90aa89"/>{type.includes('bubble') || type.includes('scatter') ? dots.slice(0,4).map(([x,y,r])=><circle key={x} cx={x} cy={y} r={r} fill="#24523f"/>):null}</g>;
  } else if (type === 'parallelCoordinates') {
    artwork = <>{[20,45,70,95].map(x=><line key={x} x1={x} y1="6" x2={x} y2="46" stroke="#cbd5e1"/>)}{['M20 35L45 12 70 31 95 17','M20 16L45 35 70 20 95 39'].map((d,i)=><path key={d} d={d} fill="none" stroke={i?'#bc674d':'#24523f'} strokeWidth="2"/>)}</>;
  } else if (type === 'candlestick') {
    artwork = <>{axis}{[27,48,69,90].map((x,i)=><g key={x}><line x1={x} y1={8+i*3} x2={x} y2={40-i*2} stroke="#334155"/><rect x={x-5} y={15+i*3} width="10" height="13" fill={i%2?'#ef4444':'#22c55e'}/></g>)}</>;
  } else if (type === 'gauge') {
    artwork = <g transform="translate(60 38)"><path d="M-32 0A32 32 0 0 1 32 0" fill="none" stroke="#e2e8f0" strokeWidth="11"/><path d="M-32 0A32 32 0 0 1 17-27" fill="none" stroke="#24523f" strokeWidth="11"/><line x1="0" y1="0" x2="16" y2="-17" stroke="#0f172a" strokeWidth="2"/></g>;
  } else if (type === 'funnel') {
    artwork = <g>{[[15,9,90],[27,21,66],[38,33,44]].map(([x,y,w],i)=><path key={y} d={`M${x} ${y}H${x+w}L${x+w-7} ${y+9}H${x+7}Z`} fill={['#24523f','#90aa89','#bc674d'][i]}/>)}</g>;
  } else if (['treemap', 'sunburst', 'sankey'].includes(type)) {
    artwork = type==='treemap' ? <g><rect x="12" y="6" width="58" height="40" fill="#24523f"/><rect x="72" y="6" width="36" height="23" fill="#90aa89"/><rect x="72" y="31" width="36" height="15" fill="#bc674d"/></g> : type==='sunburst' ? <g transform="translate(60 26)"><circle r="21" fill="#dce5d5"/><path d="M0 0V-21A21 21 0 0 1 20 7Z" fill="#24523f"/><circle r="9" fill="white"/></g> : <g><rect x="12" y="8" width="10" height="14" fill="#24523f"/><rect x="12" y="31" width="10" height="14" fill="#90aa89"/><rect x="98" y="16" width="10" height="24" fill="#bc674d"/><path d="M22 15C55 15 66 25 98 25M22 38C55 38 66 31 98 31" fill="none" stroke="#90aa89" strokeWidth="7" opacity=".55"/></g>;
  } else if (type === 'table') {
    artwork = <g>{[8,20,32,44].map((y)=><line key={y} x1="12" y1={y} x2="108" y2={y} stroke="#cbd5e1"/>)}{[12,45,78,108].map((x)=><line key={x} x1={x} y1="8" x2={x} y2="44" stroke="#cbd5e1"/>)}</g>;
  } else if (type === 'kpi') {
    artwork = <g><text x="60" y="30" textAnchor="middle" fill="#24523f" fontSize="24" fontWeight="800">42.8K</text><path d="M40 39H80" stroke="#dce5d5" strokeWidth="4"/></g>;
  } else artwork = <>{axis}<path d="M12 38L36 24 58 31 82 13 112 19" fill="none" stroke="#24523f" strokeWidth="3"/></>;

  return <svg data-preview-type={type} viewBox="0 0 120 52" className="h-12 w-full text-indigo-600" aria-hidden="true" preserveAspectRatio="xMidYMid meet">{artwork}</svg>;
}
