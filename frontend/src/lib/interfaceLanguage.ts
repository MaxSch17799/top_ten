// Retain the original key: Fishy and Wavelength already share this preference.
const KEY = 'fishy-ui-language';
const CHANGED = 'game-night-interface-language';
export type InterfaceLanguage = 'en' | 'de';

export function readInterfaceLanguage(): InterfaceLanguage {
  try { return localStorage.getItem(KEY) === 'de' ? 'de' : 'en'; }
  catch { return 'en'; }
}
export function setInterfaceLanguage(value: string) {
  localStorage.setItem(KEY, value === 'de' ? 'de' : 'en');
  window.dispatchEvent(new Event(CHANGED));
}
export function subscribeInterfaceLanguage(changed: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) changed(); };
  window.addEventListener('storage', storage);
  window.addEventListener(CHANGED, changed);
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener(CHANGED, changed);
  };
}
