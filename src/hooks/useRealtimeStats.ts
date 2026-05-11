/**
 * DUS Bankası — Realtime Stats Hook
 * Supabase Realtime ile question_stats tablosunu dinler.
 * Başka bir cihazdan gelen FSRS güncellemeleri anlık olarak callback ile iletilir.
 */

import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { CloudStat } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

type StatPayload = {
  device_id: string;
  question_id: string;
  attempts: number;
  corrects: number;
  last_seen: string;
  wrong_choices?: Array<{ selected: string; timestamp: string }>;
  stability?: number | null;
  difficulty?: number | null;
  last_review?: string | null;
  scheduled_days?: number | null;
  fsrs_reps?: number | null;
};

export type UseRealtimeStatsOptions = {
  /** Giriş yapılmışsa user UUID, yoksa null */
  userId: string | null;
  /** Anonim cihaz ID'si */
  deviceId: string;
  /** Her güncelleme geldiğinde çağrılır */
  onStatUpdate: (questionId: string, stat: CloudStat) => void;
  /** false ise subscription açılmaz (gerektiğinde geçici olarak durdur) */
  enabled?: boolean;
};

function rowToCloudStat(row: StatPayload): CloudStat {
  return {
    attempts: row.attempts,
    corrects: row.corrects,
    lastSeen: row.last_seen,
    wrongChoices: row.wrong_choices ?? [],
    stability: row.stability ?? undefined,
    difficulty: row.difficulty ?? undefined,
    lastReview: row.last_review ?? undefined,
    scheduledDays: row.scheduled_days ?? undefined,
    fsrsReps: row.fsrs_reps ?? undefined,
  };
}

/**
 * Supabase Realtime ile question_stats değişikliklerini anlık dinler.
 * Aynı kullanıcının başka cihazlarından gelen FSRS güncellemelerini yakalar.
 *
 * Örnek kullanım:
 * ```tsx
 * useRealtimeStats({
 *   userId: user?.id ?? null,
 *   deviceId: getDeviceId(),
 *   onStatUpdate: (qId, stat) => { ... localStorage güncelle ... },
 * });
 * ```
 */
export function useRealtimeStats({
  userId,
  deviceId,
  onStatUpdate,
  enabled = true,
}: UseRealtimeStatsOptions): void {
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Stale closure önlemi — callback her render'da güncel kalır
  const callbackRef = useRef(onStatUpdate);
  callbackRef.current = onStatUpdate;
  // Retry state — exponential backoff
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    // Önceki timer varsa temizle
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    // Önceki channel varsa temizle
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    // user_id varsa user bazlı filtrele; yoksa device_id bazlı
    const filter = userId
      ? `user_id=eq.${userId}`
      : `device_id=eq.${deviceId}`;

    const channelName = `stats-${userId ?? deviceId}`;

    const handlePayload = (payload: { new: unknown }) => {
      const row = payload.new as StatPayload;
      // Kendi cihazının değişikliklerini yok say (push→realtime loop engelleme)
      if (row.device_id && row.device_id === deviceId) return;
      if (row?.question_id) {
        callbackRef.current(row.question_id, rowToCloudStat(row));
      }
    };

    /** CHANNEL_ERROR'da exponential backoff ile retry (max 3: 2sn, 4sn, 8sn) */
    const attemptRetry = () => {
      if (retryCountRef.current >= 3) {
        console.error(`[Realtime] ${channelName} — 3 retry denemesi başarısız, kalıcı hata`);
        return;
      }
      retryCountRef.current += 1;
      const delayMs = Math.pow(2, retryCountRef.current) * 1000; // 2, 4, 8 sn
      console.log(
        `[Realtime] ${channelName} — ${delayMs / 1000}sn sonra retry (${retryCountRef.current}/3)`
      );

      retryTimerRef.current = setTimeout(() => {
        // Eski channel'ı temizle
        if (channelRef.current) {
          supabase.removeChannel(channelRef.current);
        }
        // Yeni channel oluştur ve bağlan
        channelRef.current = supabase
          .channel(channelName)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'question_stats', filter },
            handlePayload
          )
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'question_stats', filter },
            handlePayload
          )
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              console.log(`[Realtime] Stats kanalı aktif → ${channelName}`);
              retryCountRef.current = 0; // Başarılı bağlantıda sayacı sıfırla
            } else if (status === 'CHANNEL_ERROR') {
              console.warn(`[Realtime] Kanal hatası → ${channelName}`);
              attemptRetry();
            }
          });
      }, delayMs);
    };

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'question_stats', filter },
        handlePayload
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'question_stats', filter },
        handlePayload
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[Realtime] Stats kanalı aktif → ${channelName}`);
          retryCountRef.current = 0; // Başarılı bağlantıda sayacı sıfırla
        } else if (status === 'CHANNEL_ERROR') {
          console.warn(`[Realtime] Kanal hatası → ${channelName}`);
          attemptRetry();
        }
      });

    channelRef.current = channel;

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [userId, deviceId, enabled]);
}
