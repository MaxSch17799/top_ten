import { flipLabel, FLIP_LABELS, type FlipCard as Card } from '../../../shared/flip7';

/** One original vector template for the entire deck, including its back. */
export default function FlipCard({ card, back = false, highlight = false }: { card?: Card; back?: boolean; highlight?: boolean }) {
  const kind = card?.kind ?? 'number';
  const color = back ? '#83e5b5' : kind === 'number' ? ['#a7e6d4', '#b8b4f5', '#f4b39a'][Math.floor((card?.value ?? 0) / 5)]
    : kind === 'freeze' ? '#91d9f4' : kind === 'flip-three' ? '#f2ab91' : kind === 'second-chance' ? '#b7e695' : '#f1d784';
  const symbol = back ? '7' : kind === 'number' || kind === 'bonus' || kind === 'double' ? flipLabel(card!) : kind === 'freeze' ? '❄' : kind === 'flip-three' ? '3' : '↻';
  return <svg viewBox="0 0 120 172" className={`f7-card ${highlight ? 'f7-card-match' : ''}`} role="img"
    aria-label={back ? 'Flip 7 card back' : `${FLIP_LABELS[kind]} ${flipLabel(card!)}`} data-flip-card-id={card?.id}>
    <rect x="2" y="2" width="116" height="168" rx="13" fill={back ? '#163e36' : '#f6f1df'} stroke={color} strokeWidth="3" />
    <rect x="9" y="9" width="102" height="154" rx="8" fill="none" stroke={back ? '#83e5b5' : '#19372f'} strokeOpacity=".4" />
    <path d="M10 94L110 29V82L10 147Z" fill={color} opacity={back ? '.14' : '.85'} />
    <circle cx="60" cy="85" r="37" fill={back ? '#163e36' : '#f6f1df'} stroke={color} strokeWidth="3" />
    <text x="14" y="29" fill={back ? color : '#173a32'} fontSize="15" fontWeight="800" fontFamily="system-ui, sans-serif">{back ? 'F7' : kind === 'number' ? card?.value : kind === 'bonus' ? `+${card?.value}` : kind === 'double' ? '×2' : kind === 'freeze' ? '❄' : kind === 'flip-three' ? '3' : '↻'}</text>
    <text x="60" y="104" textAnchor="middle" fill={back ? color : '#173a32'} fontSize={symbol.length > 2 ? '42' : '53'} fontFamily="system-ui, sans-serif" fontWeight="900">{symbol}</text>
    <text x="60" y="148" textAnchor="middle" fill={back ? color : '#173a32'} fontSize="8.3" fontFamily="system-ui, sans-serif" fontWeight="800" letterSpacing="1">{back ? 'ONE MORE?' : kind === 'number' ? 'FLIP SEVEN' : FLIP_LABELS[kind].toUpperCase()}</text>
    <circle cx="100" cy="22" r="3" fill={color} /><circle cx="20" cy="151" r="3" fill={color} />
  </svg>;
}
