/** Original vector artwork. One component renders the entire deck and its reverse. */
export default function SkyCard({ value, back = false }: { value?: number | null; back?: boolean }) {
  const hidden = back || value === null || value === undefined;
  const color = hidden ? '#b2a2ed' : value < 0 ? '#b6e6d3' : value === 0 ? '#b8dbf4' : value <= 4 ? '#d6c9f4' : value <= 8 ? '#f3d782' : '#f3ac94';
  return <svg className={`sky-card ${hidden ? 'sky-card-back' : ''}`} viewBox="0 0 120 160" role="img" aria-label={hidden ? 'Face-down card' : `Card ${value}`}>
    <rect x="2" y="2" width="116" height="156" rx="13" fill={hidden ? '#332c50' : '#faf6e9'} stroke={color} strokeWidth="3" />
    {hidden ? <>
      <rect x="10" y="10" width="100" height="140" rx="8" fill="none" stroke="#b2a2ed" strokeOpacity=".4" />
      {[0, 1, 2, 3].map(i => <ellipse key={i} cx="60" cy="77" rx={21 + i * 10} ry={21 + i * 10} fill="none" stroke={color} strokeOpacity={.8 - i * .18} transform={`rotate(${i * 15} 60 77)`} />)}
      <path d="M60 48 67 69 88 77 67 84 60 106 53 84 32 77 53 69Z" fill={color} />
      <text x="60" y="137" textAnchor="middle" fill={color} fontFamily="system-ui,sans-serif" fontSize="9" fontWeight="800" letterSpacing="3">SKYJO</text>
    </> : <>
      <path d="M3 114 Q60 65 117 114V145Q117 157 104 157H16Q3 157 3 144Z" fill={color} />
      <circle cx="99" cy="134" r="32" fill="none" stroke="#302b3c" strokeOpacity=".08" strokeWidth="11" />
      <text x="14" y="27" fill="#302b3c" fontFamily="system-ui,sans-serif" fontSize="18" fontWeight="800">{value}</text>
      <text x="60" y="100" textAnchor="middle" fill="#302b3c" fontFamily="system-ui,sans-serif" fontSize={Number(value) < 0 ? 59 : 66} fontWeight="850" letterSpacing="-4">{value}</text>
      <text x="106" y="143" textAnchor="end" fill="#302b3c" fontFamily="system-ui,sans-serif" fontSize="18" fontWeight="800">{value}</text>
      <path d="m14 136 4-7 4 7-4 7Z" fill="#302b3c" opacity=".6" />
    </>}
  </svg>;
}
