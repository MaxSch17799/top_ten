import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminReauthorize, ApiError, BACKEND_BASE, createGame, request } from '../api';
import { loadOverrideToken, saveOverrideToken } from '../lib/adminSession';
import { saveSession } from '../lib/session';
import { defaultFishySettings, type FishyBankSummary } from '../../../shared/soundsFishy';
import { fishyRules, useFishyLanguage } from '../lib/fishyI18n';
import PasswordPromptDialog from './PasswordPromptDialog';

export default function SoundsFishyHome() {
  const navigate = useNavigate(), { language, setLanguage, t } = useFishyLanguage();
  const [nickname, setNickname] = useState(''), [code, setCode] = useState('');
  const [banks, setBanks] = useState<FishyBankSummary[]>([]);
  const [bankId, setBankId] = useState(localStorage.getItem('fishy-bank') ?? defaultFishySettings.bankId);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [override, setOverride] = useState(false), [password, setPassword] = useState('');
  useEffect(() => {
    let live = true;
    request<{ banks: FishyBankSummary[] }>(`${BACKEND_BASE}/api/sounds-fishy/banks`).then(data => {
      if (!live) return;
      setBanks(data.banks); setBankId(id => data.banks.some(b => b.bankId === id) ? id : data.banks[0]?.bankId ?? '');
    }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'Retry connection'); });
    return () => { live = false; };
  }, []);
  const create = async (token?: string | null) => {
    const result = await createGame({ gameType: 'sounds-fishy', hostNickname: nickname.trim(), overrideToken: token ?? undefined, settings: { ...defaultFishySettings, bankId } });
    saveSession({ gameId: result.gameId, playerId: result.playerId, playerToken: result.playerToken, hostToken: result.hostToken, role: 'HOST' });
    localStorage.setItem('fishy-bank', bankId); navigate(`/g/${result.gameId}`);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await create(loadOverrideToken()); }
    catch (e) { if (e instanceof ApiError && e.code === 'LIMIT_NEAR') setOverride(true); else setError(e instanceof Error ? e.message : 'Retry connection'); }
    finally { setBusy(false); }
  };
  return <main className="page sheet sounds-fishy"><section className="hero sf-home">
    <nav className="sf-top"><Link to="/">← {t('All games')}</Link><select aria-label={t('Interface language')} value={language} onChange={e => setLanguage(e.target.value)}><option value="en">English</option><option value="de">Deutsch</option></select></nav>
    <span className="sf-emblem" aria-hidden="true">&gt;&lt;&gt;</span>
    <p className="eyebrow">{t('Party game for 4–10 players')}</p><h1>Sounds Fishy</h1>
    <p className="tagline">{t('One truth. A sea of lies.')}</p>
    <form className="stack home-create" onSubmit={submit}>
      <label className="field"><span>{t('Your nickname')}</span><input className="input" maxLength={20} required autoComplete="nickname" value={nickname} onChange={e => setNickname(e.target.value)} /></label>
      <label className="field"><span>{t('Question bank')}</span><select className="input" value={bankId} onChange={e => setBankId(e.target.value)}>{banks.map(b => <option key={b.bankId} value={b.bankId}>{b.title}</option>)}</select></label>
      <button className="primary" disabled={busy || !banks.length}>{t(busy ? 'Creating…' : 'Create Sounds Fishy lobby')}</button>
    </form>
    {banks.find(b => b.bankId === bankId)?.development && <p className="warning-banner">{t('Sample questions only · full English and German banks are still to be supplied.')}</p>}
    <form className="join-inline" onSubmit={e => { e.preventDefault(); navigate(`/g/${code}`); }}><label className="field"><span>{t('Have an invite code?')}</span><input className="input" aria-label={t('4-digit code')} required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))} /></label><button className="secondary">{t('Join')}</button></form>
    {error && <p role="alert" className="error">{t(error)}</p>}
    <details className="sf-rules"><summary>{t('How to play')}</summary><p>{fishyRules[language === 'de' ? 'de' : 'en']}</p><a href="https://gameon.mt/wp-content/uploads/2025/11/Sounds_Fishy_Rules.pdf" target="_blank" rel="noreferrer">{t('Rules')} ↗</a></details>
    {override && <PasswordPromptDialog title="Usage override" message="The configured usage limit requires an admin override." password={password} loading={busy} error={error} confirmLabel={t('Create Sounds Fishy lobby')} onPasswordChange={setPassword} onClose={() => setOverride(false)} onSubmit={async () => { setBusy(true); try { const auth = await adminReauthorize(password); saveOverrideToken(auth.token); await create(auth.token); } catch(e) { setError(e instanceof Error ? e.message : 'Retry connection'); } finally { setBusy(false); } }} />}
  </section></main>;
}
