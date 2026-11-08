import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export interface AddPlayerPanelProps {
  joinUrl: string;
  gameCode: string;
  onClose: () => void;
  translate?: (text: string) => string;
}

export default function AddPlayerPanel({ joinUrl, gameCode, onClose, translate: t = (text) => text }: AddPlayerPanelProps) {
  const [qr, setQr] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void QRCode.toDataURL(joinUrl, {
      margin: 1,
      color: { dark: '#39ff14', light: '#07070f' },
    }).then(setQr);
  }, [joinUrl]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="invite-card">
        <div className="invite-header">
          <h3>{t('Invite players')}</h3>
          <button type="button" className="ghost" onClick={onClose} aria-label={t('Close invite panel')}>
            X
          </button>
        </div>
        {qr && <img src={qr} alt={t('Join link QR code')} className="qr" />}
        <p className="footnote">{t('Game code')}: {gameCode}</p>
        <p className="footnote">{t('Share this link or QR to add players mid-game.')}</p>
        <div className="invite-link">
          <input readOnly value={joinUrl} />
          <button type="button" className="secondary" onClick={handleCopy}>
            {t(copied ? 'Copied' : 'Copy link')}
          </button>
        </div>
      </div>
    </div>
  );
}
