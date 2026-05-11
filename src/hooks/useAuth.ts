/**
 * DUS Bankası — Auth Hook
 * Supabase oturum durumunu dinler, giriş sonrası device→user merge yapar.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
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

  // onAuthStateChange zaten ilk yüklemede INITIAL_SESSION ile mevcut session'ı bildirir.
  // Ayrıca getSession() çağırmaya gerek yok — çift render'ı önler.
  const gotSessionRef = useRef(false);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null;

      // İlk auth event'i geldiğinde loading false
      if (!gotSessionRef.current) {
        gotSessionRef.current = true;
        setAuthLoading(false);
      }

      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        setUser(u);
        if (u) runMergeIfNeeded(u);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [runMergeIfNeeded]);

  const signOut = useCallback(async () => {
    await authSignOut();
    setUser(null);
  }, []);

  return { user, authLoading, signOut };
}
