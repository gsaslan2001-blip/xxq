/**
 * DUS Bankası — Auth Hook
 * Supabase oturum durumunu dinler, giriş sonrası device→user merge yapar.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { mergeDeviceStatsToUser, signOut as authSignOut } from '../lib/auth';
import { getDeviceId } from '../lib/stats';
import type { User } from '@supabase/supabase-js';

/** localStorage key: her kullanıcı için merge yapılıp yapılmadığını saklar */
const MERGE_DONE_PREFIX = 'dus_merge_done_';

export type AuthState = {
  user: User | null;
  authLoading: boolean;
  signOut: () => Promise<void>;
};

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  /**
   * Giriş sonrası device istatistiklerini kullanıcıya taşı.
   * Her kullanıcı için sadece bir kez çalışır (localStorage flag ile).
   */
  const runMergeIfNeeded = useCallback(async (u: User) => {
    const key = MERGE_DONE_PREFIX + u.id;
    if (localStorage.getItem(key)) return; // Zaten yapıldı
    try {
      const deviceId = getDeviceId();
      const count = await mergeDeviceStatsToUser(deviceId, u.id);
      console.log(`[Auth] ${count} istatistik kullanıcıya merge edildi (device: ${deviceId})`);
      localStorage.setItem(key, '1');
    } catch (err) {
      console.warn('[Auth] Merge başarısız (kritik değil, sonraki girişte yeniden denenecek):', err);
    }
  }, []);

  useEffect(() => {
    // Mevcut session'ı yükle (sayfa yenilenmesinde)
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      setAuthLoading(false);
      if (u) runMergeIfNeeded(u);
    });

    // Auth değişikliklerini dinle (giriş/çıkış/token yenileme)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      setAuthLoading(false);
      if (u) runMergeIfNeeded(u);
    });

    return () => subscription.unsubscribe();
  }, [runMergeIfNeeded]);

  const signOut = useCallback(async () => {
    await authSignOut();
    setUser(null);
  }, []);

  return { user, authLoading, signOut };
}
