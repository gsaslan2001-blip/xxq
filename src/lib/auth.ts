/**
 * DUS Bankası — Supabase Auth Yardımcıları
 * Google OAuth + Email/Password giriş, çıkış, device→user merge
 */

import { supabase } from './supabase';
import type { User } from '@supabase/supabase-js';

export type { User };

/** Google OAuth ile giriş — sayfayı Google'a yönlendirir */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  });
  if (error) throw error;
}

/** Email + şifre ile giriş */
export async function signInWithEmail(email: string, password: string): Promise<User> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

/** Yeni hesap oluştur */
export async function signUpWithEmail(email: string, password: string): Promise<User> {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error('Kayıt başarısız: kullanıcı oluşturulamadı.');
  return data.user;
}

/** Çıkış yap */
export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Cihazın anonim istatistiklerini oturum açan kullanıcıya merge eder.
 * DB'deki `merge_device_stats_to_user` PL/pgSQL fonksiyonunu çağırır.
 * Giriş sonrası bir kez çalıştırılmalı — bkz. useAuth.ts
 *
 * @returns Merge edilen satır sayısı
 */
export async function mergeDeviceStatsToUser(
  deviceId: string,
  userId: string
): Promise<number> {
  const { data, error } = await supabase.rpc('merge_device_stats_to_user', {
    p_device_id: deviceId,
    p_user_id: userId,
  });
  if (error) {
    console.warn('[Auth] Merge hatası (kritik değil):', error.message);
    return 0;
  }
  return (data as number) ?? 0;
}
