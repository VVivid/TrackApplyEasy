'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, APIError, Session } from '../lib/api';
import { Applications } from './applications';
import { CVLibrary } from './cvs';
import { AnalysisPage } from './analysis';
import { SessionContext } from './session';
export function Workspace({ view }: { view: 'applications' | 'cvs' | 'analysis' }) {
  // undefined: session is unknown; null: confirmed signed out; Session: authenticated.
  // A temporary provider failure must preserve whichever state was already known.
  const [session, setSession] = useState<Session | null | undefined>(undefined),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [theme, setTheme] = useState('dark');
  const lastActivity = useRef(0);
  const authGeneration = useRef(0),
    signingOut = useRef(false);
  const refresh = useCallback(async () => {
    if (signingOut.current) return;
    const generation = ++authGeneration.current;
    try {
      const current = await api<Session>('/session');
      if (generation !== authGeneration.current) return;
      setSession(current);
      lastActivity.current = Date.now();
      setError('');
    } catch (err) {
      if (generation !== authGeneration.current) return;
      if (err instanceof APIError && err.status === 401) {
        setSession(null);
        setError('');
      } else setError(err instanceof Error ? err.message : 'Sign-in unavailable.');
    } finally {
      if (generation === authGeneration.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const saved = localStorage.getItem('trackapplyeasy-theme');
    if (saved === 'light' || saved === 'dark') setTheme(saved);
    void refresh();
  }, [refresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('trackapplyeasy-theme', theme);
  }, [theme]);
  useEffect(() => {
    if (!session) return;
    const activity = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastActivity.current > 60000) {
        lastActivity.current = Date.now();
        void refresh();
      }
    };
    const visible = () => {
      if (document.visibilityState === 'visible') activity();
    };
    window.addEventListener('pointerdown', activity);
    window.addEventListener('keydown', activity);
    window.addEventListener('scroll', activity, { passive: true });
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('pointerdown', activity);
      window.removeEventListener('keydown', activity);
      window.removeEventListener('scroll', activity);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [session, refresh]);
  async function logout() {
    if (!session || signingOut.current) return;
    signingOut.current = true;
    ++authGeneration.current;
    try {
      const res = await fetch('/auth/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrf_token },
        credentials: 'same-origin',
      });
      if (res.ok || res.status === 502) {
        setSession(null);
        setError(
          res.ok ? '' : (await res.json()).error || 'Provider sign-out could not be confirmed.',
        );
      } else setError('Sign-out could not be confirmed. Please retry.');
    } catch {
      setError('Sign-out could not be confirmed. Retry while connected.');
    } finally {
      signingOut.current = false;
    }
  }
  return (
    <main className="workspace">
      <header className="heading">
        <div>
          <p className="eyebrow">TrackApplyEasy</p>
          <h1>
            {view === 'applications' ? 'Applications' : view === 'cvs' ? 'CV library' : 'Analysis'}
          </h1>
        </div>
        <div className="heading-actions">
          <div className="theme-switch" aria-label="Color theme">
            <button aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
              ☀ Light
            </button>
            <button aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
              ☾ Dark
            </button>
          </div>
          {session && (
            <>
              <span className="owner">{session.label}</span>
              <button className="text-button" onClick={logout}>
                Sign out
              </button>
            </>
          )}
        </div>
      </header>
      <nav className="tabs" aria-label="Workspace pages">
        <a href="/" aria-current={view === 'applications' ? 'page' : undefined}>
          Applications
        </a>
        <a href="/cvs/" aria-current={view === 'cvs' ? 'page' : undefined}>
          CV library
        </a>
        <a href="/analysis/" aria-current={view === 'analysis' ? 'page' : undefined}>
          Analysis
        </a>
      </nav>
      {error && (
        <p className="error" role="alert">
          {error}{' '}
          <button className="text-button" onClick={refresh}>
            Retry
          </button>
        </p>
      )}
      {loading ? (
        <p className="empty" role="status">
          Opening your workspace…
        </p>
      ) : session === undefined ? (
        <p className="empty" role="status">
          Your workspace is temporarily unavailable. Retry to reconnect.
        </p>
      ) : !session ? (
        <section className="sign-in">
          <p className="eyebrow">Your private workspace</p>
          <h2>Every application. Its exact CV. The full story.</h2>
          <p>Sign in to track applications, save original PDFs, and understand your progress.</p>
          <a className="primary" href="/auth/login">
            Sign in
          </a>
        </section>
      ) : (
        <SessionContext.Provider value={session}>
          {view === 'applications' ? (
            <Applications />
          ) : view === 'cvs' ? (
            <CVLibrary />
          ) : (
            <AnalysisPage />
          )}
        </SessionContext.Provider>
      )}
      <footer className="footer">
        <span>TrackApplyEasy</span>
        <span>Dates shown in New York time</span>
      </footer>
    </main>
  );
}
