import { addListener as addLibraryListener } from 'expo-media-library';
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { GitHub } from '../core/github';
import { setBackgroundSyncEnabled } from './backgroundSync';
import { createGitHub } from './github';
import { Prefs, StoredSession, clearSession, loadStoredSession, savePrefs, saveSession } from './storage';
import { runSync } from './sync';

type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'ready'; session: StoredSession; github: GitHub };

type SessionContextValue = {
  state: SessionState;
  signIn(session: StoredSession): Promise<void>;
  signOut(): Promise<void>;
  updatePrefs(prefs: Partial<Prefs>): Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const activate = useCallback((session: StoredSession | null) => {
    setState(session ? { status: 'ready', session, github: createGitHub(session.connection) } : { status: 'signedOut' });
  }, []);

  useEffect(() => {
    loadStoredSession().then(activate, () => activate(null));
  }, [activate]);

  const session = state.status === 'ready' ? state.session : null;

  // Back up whenever the app comes to the foreground or a new photo appears.
  useEffect(() => {
    if (!session?.prefs.autoBackup) return;
    const sync = () => runSync(session).catch((e) => console.warn('Backup failed', e));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const debounced = () => {
      clearTimeout(timer);
      timer = setTimeout(sync, 5000);
    };
    sync();
    const appState = AppState.addEventListener('change', (next) => next === 'active' && sync());
    const library = addLibraryListener(debounced);
    return () => {
      clearTimeout(timer);
      appState.remove();
      library.remove();
    };
  }, [session]);

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      async signIn(next) {
        await saveSession(next);
        await setBackgroundSyncEnabled(next.prefs.autoBackup);
        activate(next);
      },
      async signOut() {
        await setBackgroundSyncEnabled(false);
        await clearSession();
        activate(null);
      },
      async updatePrefs(changes) {
        if (!session) return;
        const prefs = { ...session.prefs, ...changes };
        await savePrefs(prefs);
        await setBackgroundSyncEnabled(prefs.autoBackup);
        activate({ ...session, prefs });
      },
    }),
    [state, session, activate],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

// For screens that only render once signed in.
export function useReadySession() {
  const { state, ...rest } = useSession();
  if (state.status !== 'ready') throw new Error('Not signed in');
  return { ...state, ...rest };
}
