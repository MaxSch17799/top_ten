import { useState } from 'react';
import { checkedSkySettings, CLASSIC_SKY_RULES, SKY_PROFILES, type SkyRules, type SkySettings as Settings } from '../../../shared/skyjo';
import { loadSkyProfiles, saveSkyProfiles } from '../lib/skyProfiles';

export function SkyRulesSummary({ settings }: { settings: Settings }) {
  const r = settings.rules, classic = JSON.stringify(r) === JSON.stringify(CLASSIC_SKY_RULES);
  return <p className="sky-help">{classic ? 'Classic rules' : 'House rules'} · {r.fixedRounds ? `${r.fixedRounds} rounds` : `Finish at ${r.target} points`} · Lowest total wins<br />{r.startingCards} starting flips · Columns {r.columns ? 'clear' : 'stay'} · Doubling {r.penalty ? 'on' : 'off'}{r.turnSeconds ? ` · ${r.turnSeconds}s turns` : ' · No timer'}</p>;
}
export default function SkySettings({ settings, busy, apply }: { settings: Settings; busy: boolean; apply: (s: Settings) => Promise<boolean> }) {
  const [draft, setDraft] = useState(settings), [profiles, setProfiles] = useState(loadSkyProfiles),
    [profileName, setProfileName] = useState(() => loadSkyProfiles().find(p => p.id === settings.profileId)?.name ?? ''), [message, setMessage] = useState('');
  const all = [...SKY_PROFILES, ...profiles];
  const setRule = (key: keyof SkyRules, value: number | string | boolean) => setDraft(d => ({ ...d, rules: { ...d.rules, [key]: value } }));
  const persist = (next: typeof profiles) => { saveSkyProfiles(next); setProfiles(next); };
  const save = (duplicate: boolean) => {
    try {
      const valid = checkedSkySettings(draft), name = profileName.trim(); if (!name) throw new Error('Enter a profile name first.');
      const id = !duplicate && draft.profileId.startsWith('custom-') ? draft.profileId : `custom-${crypto.randomUUID()}`;
      if (profiles.length >= 30 && !profiles.some(p => p.id === id)) throw new Error('Maximum 30 profiles. Delete one to make room.');
      persist([...profiles.filter(p => p.id !== id), { id, name, rules: valid.rules }]);
      setDraft(d => ({ ...d, profileId: id })); setMessage('Saved in this browser. Apply rules to use this profile.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Browser storage is unavailable.'); }
  };
  const numberField = (key: 'target' | 'fixedRounds' | 'startingCards' | 'turnSeconds', label: string, min: number, max: number) => <label className="field" key={key}><span>{label}</span><input className="input" type="number" min={min} max={max} value={draft.rules[key]} onChange={e => setRule(key, Number(e.target.value))} /></label>;
  const changed = JSON.stringify(draft) !== JSON.stringify(settings);
  return <section className="sky-settings" aria-label="Rules settings"><p className="eyebrow">Your table, your rules</p><h2>Make a night of it.</h2>
    <label className="field"><span>Rules profile</span><select className="input" aria-label="Rules profile" value={draft.profileId} onChange={e => { const p = all.find(p => p.id === e.target.value); if (p) { setDraft(d => ({ ...d, profileId: p.id, rules: { ...p.rules } })); setProfileName(p.name); } }}>{all.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <SkyRulesSummary settings={draft} />
    <details><summary>Advanced settings · house rules</summary><div className="sky-settings-grid">
      {numberField('target', 'Game-end score', 1, 10000)}{numberField('fixedRounds', 'Fixed rounds (0 = score threshold)', 0, 100)}
      {numberField('startingCards', 'Starting face-up cards', 1, 11)}{numberField('turnSeconds', 'Turn timer seconds (0 = off)', 0, 300)}
      <label className="sky-check"><input type="checkbox" checked={draft.rules.columns} onChange={e => setRule('columns', e.target.checked)} />Clear matching columns</label>
      <label className="sky-check"><input type="checkbox" checked={draft.rules.penalty} onChange={e => setRule('penalty', e.target.checked)} />Double unsuccessful finisher’s positive score</label>
      <label className="field"><span>When the timer expires</span><select className="input" value={draft.rules.timeout} onChange={e => setRule('timeout', e.target.value)}><option value="pause">Pause game (host resumes)</option><option value="automatic">Complete turn automatically</option></select></label>
    </div><p className="sky-help">The timer covers the whole turn, including card placement. Automatic play draws, discards and reveals the first hidden position. A card already kept or taken replaces the first hidden position, otherwise the first occupied one. Opening reveals use the first hidden positions. Hidden values never influence these choices.</p>
    <button className="secondary" onClick={() => setDraft(d => ({ ...d, profileId: 'classic', rules: { ...CLASSIC_SKY_RULES } }))}>Reset to Classic</button></details>
    <label className="sky-check"><input type="checkbox" checked={draft.autoNext} onChange={e => setDraft(d => ({ ...d, autoNext: e.target.checked }))} />Start the next round after 15 seconds</label>
    <details><summary>Saved profiles</summary><p className="sky-help">Create, edit or rename a profile with Save / update. Duplicate any profile. Profiles stay in this browser for future lobbies.</p>
      <label className="field"><span>Profile name</span><input className="input" maxLength={40} value={profileName} onChange={e => setProfileName(e.target.value)} /></label>
      <div className="sky-buttons"><button className="secondary" onClick={() => save(false)}>Save / update profile</button><button className="secondary" onClick={() => save(true)}>Duplicate profile</button>
        {draft.profileId.startsWith('custom-') && <button className="secondary" onClick={() => { try { persist(profiles.filter(p => p.id !== draft.profileId)); setDraft(d => ({ ...d, profileId: 'classic', rules: { ...CLASSIC_SKY_RULES } })); setMessage('Profile deleted.'); } catch { setMessage('Browser storage is unavailable.'); } }}>Delete profile</button>}
      </div></details>
    <button className="primary" disabled={busy || !changed} onClick={async () => { try { if (await apply(checkedSkySettings(draft))) setMessage('Rules applied.'); } catch (e) { setMessage(e instanceof Error ? e.message : 'Invalid settings'); } }}>Apply rules</button>
    {changed && <p className="sky-help">Apply your changes before starting.</p>}{message && <p role="status">{message}</p>}
  </section>;
}
