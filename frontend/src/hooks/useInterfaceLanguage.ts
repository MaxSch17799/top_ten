import { useSyncExternalStore } from 'react';
import { readInterfaceLanguage, setInterfaceLanguage, subscribeInterfaceLanguage } from '../lib/interfaceLanguage';

/** Shared interface preference; content packs and game dictionaries remain independent. */
export function useInterfaceLanguage() {
  const language = useSyncExternalStore(subscribeInterfaceLanguage, readInterfaceLanguage, () => 'en' as const);
  return { language, setLanguage: setInterfaceLanguage };
}
