import { useState } from 'react';
import { checkedFlipSettings, CLASSIC_FLIP_RULES, FLIP_PROFILES, type FlipRules, type FlipSettings as Settings } from '../../../shared/flip7';
import { loadFlipProfiles, saveFlipProfiles } from '../lib/flipProfiles';

export function FlipRulesSummary({ settings }: { settings: Settings }) {
  const r = settings.rules;
  const house = r.bonus !== 15 || r.unique !== 7 || !!r.fixedRounds || r.freeze !== 3 || r.flipThree !== 3 || r.secondChance !== 3;
  return <p className="f7-rules-summary">{r.fixedRounds ? `${r.fixedRounds} rounds + tie-breaks` : `First to ${r.target}`} · {r.unique} unique numbers · +{r.bonus} bonus · {house ? 'House rules' : 'Standard mechanics'}{r.turnSeconds ? ` · ${r.turnSeconds}s turns` : ''}{r.actionSeconds ? ` · ${r.actionSeconds}s targeting` : ''}</p>;
}
export default function FlipSettings({ settings, busy, apply }: { settings: Settings; busy: boolean; apply: (s: Settings) => Promise<boolean> }) {
  const [draft, setDraft] = useState(settings), [profiles, setProfiles] = useState(loadFlipProfiles),
    [profileName, setProfileName] = useState(''), [message, setMessage] = useState('');
  const all = [...FLIP_PROFILES, ...profiles];
  const setRule = (key: keyof FlipRules, value: number | string) => setDraft(d => ({ ...d, rules: { ...d.rules, [key]: value } }));
  const persist = (next: typeof profiles) => { saveFlipProfiles(next); setProfiles(next); };
  const save = (duplicate: boolean) => {
    try {
      const valid = checkedFlipSettings(draft), custom = draft.profileId.startsWith('custom-');
      const name = profileName.trim();
      if (!name) { setMessage('Enter a profile name first.'); return; }
      const id = !duplicate && custom ? draft.profileId : `custom-${crypto.randomUUID()}`;
      if (profiles.length >= 30 && !profiles.some(p => p.id === id)) throw new Error('Delete a profile before adding another (maximum 30).');
      persist([...profiles.filter(p => p.id !== id), { id, name, rules: valid.rules }]);
      setDraft(d => ({ ...d, profileId: id })); setMessage('Profile saved on this browser. Apply rules to use it in this lobby.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not save profile'); }
  };
  const numberField = (key: Exclude<keyof FlipRules, 'timeout'>, label: string, min: number, max: number) => <label className="field" key={key}>
    <span>{label}</span><input className="input" type="number" min={min} max={max} value={draft.rules[key]} onChange={e => setRule(key, Number(e.target.value))} />
  </label>;
  const changed = JSON.stringify(draft) !== JSON.stringify(settings);
  return <section className="f7-settings" aria-label="Rules settings"><h3>Make it your game</h3>
    <label className="field"><span>Rules profile</span><select className="input" value={draft.profileId} onChange={e => {
      const p = all.find(p => p.id === e.target.value); if (p) { setDraft(d => ({ ...d, profileId: p.id, rules: { ...p.rules } })); setProfileName(p.name); }
    }}>{all.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <FlipRulesSummary settings={draft} />
    <details><summary>Advanced settings · unofficial options</summary><div className="f7-settings-grid">
      {numberField('target', 'Winning score', 1, 10000)}{numberField('bonus', 'Flip bonus', 0, 100)}
      {numberField('unique', 'Unique numbers to flip', 3, 13)}{numberField('fixedRounds', 'Fixed rounds (0 = points target)', 0, 100)}
      {numberField('turnSeconds', 'Turn timer seconds (0 = off)', 0, 300)}{numberField('actionSeconds', 'Target timer seconds (0 = off)', 0, 300)}
      {numberField('freeze', 'Freeze cards', 0, 9)}{numberField('flipThree', 'Flip Three cards', 0, 9)}{numberField('secondChance', 'Second Chance cards', 0, 9)}
      <label className="field"><span>Turn timeout choice</span><select className="input" value={draft.rules.timeout} onChange={e => setRule('timeout', e.target.value)}><option value="stay">Stay (Hit if no card)</option><option value="hit">Hit</option></select></label>
    </div><p className="f7-help">Target timeouts choose yourself when eligible, otherwise the next eligible player in seat order. Ties always include everyone in another round.</p>
    <button className="secondary" type="button" onClick={() => setDraft(d => ({ ...d, profileId: 'classic', rules: { ...CLASSIC_FLIP_RULES } }))}>Reset to Classic</button></details>
    <label className="f7-check"><input type="checkbox" checked={draft.autoNext} onChange={e => setDraft(d => ({ ...d, autoNext: e.target.checked }))} />Automatically start the next round after 10 seconds</label>
    <details><summary>Saved profiles</summary><p className="f7-help">Save, rename, or edit this browser’s profiles. Built-in profiles can be duplicated.</p>
      <label className="field"><span>Profile name</span><input className="input" maxLength={40} value={profileName} onChange={e => setProfileName(e.target.value)} /></label>
      <div className="f7-buttons"><button className="secondary" onClick={() => save(false)}>Save / update profile</button><button className="secondary" onClick={() => save(true)}>Duplicate profile</button>
        {draft.profileId.startsWith('custom-') && <button className="secondary" onClick={() => { try { persist(profiles.filter(p => p.id !== draft.profileId)); setDraft(d => ({ ...d, profileId: 'classic', rules: { ...CLASSIC_FLIP_RULES } })); setMessage('Profile deleted from this browser.'); } catch { setMessage('Browser storage is unavailable.'); } }}>Delete profile</button>}
      </div></details>
    <button className="primary" disabled={busy || !changed} onClick={async () => { try { const valid = checkedFlipSettings(draft); if (await apply(valid)) setMessage('Rules applied to the lobby.'); } catch (e) { setMessage(e instanceof Error ? e.message : 'Invalid rules'); } }}>Apply rules</button>
    {changed && <p className="f7-help">You have unapplied rules. Apply them before starting.</p>}{message && <p role="status">{message}</p>}
  </section>;
}
