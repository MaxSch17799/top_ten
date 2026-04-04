import type { FormEvent } from 'react';

interface PasswordPromptDialogProps {
  title: string;
  message: string;
  password: string;
  loading?: boolean;
  error?: string | null;
  confirmLabel?: string;
  onPasswordChange: (value: string) => void;
  onSubmit: () => Promise<void> | void;
  onClose: () => void;
}

export default function PasswordPromptDialog({
  title,
  message,
  password,
  loading,
  error,
  confirmLabel = 'Confirm',
  onPasswordChange,
  onSubmit,
  onClose,
}: PasswordPromptDialogProps) {
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit();
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="invite-card">
        <div className="invite-header">
          <h3>{title}</h3>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close password prompt">
            X
          </button>
        </div>
        <p className="footnote">{message}</p>
        <form onSubmit={handleSubmit} className="stack">
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              autoFocus
            />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="button-row">
            <button type="submit" className="primary" disabled={loading}>
              {loading ? 'Checking...' : confirmLabel}
            </button>
            <button type="button" className="secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
