import type { FishyView } from '../../../shared/soundsFishy';
import type { FishyTranslate } from '../lib/fishyI18n';
export type FishyAct = (type: string, payload?: Record<string, unknown>) => Promise<boolean>;

export default function SoundsFishySettings({ state: s, act, busy, t }: { state: FishyView; act: FishyAct; busy: boolean; t: FishyTranslate }) {
  const settings = s.settings, locked = s.phase !== 'LOBBY';
  const change = (key: string, value: unknown) => void act('settings', { [key]: value });
  const count = s.players.filter(p => p.participating && !p.pending).length;
  return <div className="sf-settings stack">
    <label className="field"><span>{t('Play mode')}</span><select className="input" disabled={busy} value={settings.mode} onChange={e => change('mode', e.target.value)}><option value="party">{t('Party / Verbal')}</option><option value="written">{t('Remote / Written')}</option></select></label>
    <label className="field"><span>{t('Question bank')}</span><select className="input" disabled={busy} value={settings.bankId} onChange={e => change('bankId', e.target.value)}>{s.banks.map(b => <option key={b.bankId} value={b.bankId}>{b.title}</option>)}</select></label>
    <details><summary>{t('Advanced settings')}</summary><div className="stack sf-advanced">
      <p className="footnote">{t('Standard scoring')}</p>
      <label className="field"><span>{t('Game length')}</span><select className="input" disabled={busy || locked} value={settings.lengthMode} onChange={e => change('lengthMode', e.target.value)}><option value="official">{t('Official rotation')}</option><option value="rotations">{t('Full rotations')}</option><option value="rounds">{t('Custom rounds')}</option></select></label>
      {settings.lengthMode !== 'official' && <label className="field"><span>{t(settings.lengthMode === 'rotations' ? 'Rotations' : 'Number of rounds')}</span><input className="input" key={`${settings.lengthMode}-${settings.rotations}-${settings.rounds}`} type="number" min={1} max={settings.lengthMode === 'rotations' ? 20 : 200} defaultValue={settings.lengthMode === 'rotations' ? settings.rotations : settings.rounds} disabled={busy || locked} onBlur={e => { if (e.target.checkValidity()) change(settings.lengthMode === 'rotations' ? 'rotations' : 'rounds', Number(e.target.value)); }} /></label>}
      {count > 0 && s.totalRounds % count !== 0 && <p className="warning-banner">{t('Unequal rotation: some players will guess more often.')}</p>}
      {!locked && <label className="field"><span>{t('Starting Guesser')}</span><select className="input" value={s.nextGuesserId ?? ''} disabled={busy} onChange={e => { if (e.target.value) void act('starting-player', { playerId: e.target.value }); }}><option value="">{t('First seat')}</option>{s.players.filter(p => p.participating).map(p => <option key={p.playerId} value={p.playerId}>{p.nickname}</option>)}</select></label>}
      <label className="field"><span>{t('Preparation timer')}</span><select className="input" value={settings.preparationSeconds} disabled={busy} onChange={e => change('preparationSeconds', Number(e.target.value))}>{[0, 15, 30, 45, 60].map(n => <option key={n} value={n}>{n ? `${n} s` : t('Off')}</option>)}</select></label>
      <label className="field"><span>{t('Decision timer')}</span><select className="input" value={settings.decisionSeconds} disabled={busy} onChange={e => change('decisionSeconds', Number(e.target.value))}>{[0, 30, 60, 90, 120].map(n => <option key={n} value={n}>{n ? `${n} s` : t('Off')}</option>)}</select></label>
      <label className="sf-check"><input type="checkbox" checked={settings.autoNext} disabled={busy} onChange={e => change('autoNext', e.target.checked)} />{t('Automatic next round (8 seconds)')}</label>
      <label className="sf-check"><input type="checkbox" checked={settings.facilitator} disabled={busy} onChange={e => change('facilitator', e.target.checked)} />{t('Host may carry out spoken choices')}</label>
      {locked && <p className="footnote">{t('Settings apply next round. Game length is locked until restart.')}</p>}
    </div></details>
  </div>;
}
