'use client';
import { createContext, useContext } from 'react';
import type { Session } from '../lib/api';

export const SessionContext = createContext<Session | null>(null);
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw Error('Session required');
  return session;
}
