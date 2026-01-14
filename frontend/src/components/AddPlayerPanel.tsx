import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export interface AddPlayerPanelProps {
  joinUrl: string;
  visible: boolean;
  onClose: () => void;
}

export default function AddPlayerPanel({ joinUrl, visible, onClose }: AddPlayerPanelProps) {
  const [qr, setQr] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setCopied(false);
    void QRCode.toDataURL(joinUrl, {
      margin: 1,
      color: { dark: '#39ff14', light: '#07070f' },
    }).then(setQr);
  }, [joinUrl, visible]);

  if (!visible) {
    return null;
  }

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
          <h3>Invite players</h3>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close invite panel">
            ?
          </button>
        </div>
        {qr && <img src={qr} alt="Join link QR code" className="qr" />}
        <p className="footnote">Share this link or QR to add players mid-game.</p>
        <div className="invite-link">
          <input readOnly value={joinUrl} />
          <button type="button" className="secondary" onClick={handleCopy}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </div>
    </div>
  );
}
