import { useState, useEffect, useCallback } from 'react';
import { loadSessionFromCloud, deleteSessionFromCloud, saveSessionToCloud } from '../lib/supabase';
import { getDeviceId } from '../lib/stats';
import type { ActiveSessionInfo } from '../types/app';

export type UseResumableSessionResult = {
  resumeSessionData: ActiveSessionInfo | null;
  clearResumableSession: () => Promise<void>;
  saveResumableSession: (session: ActiveSessionInfo) => Promise<void>;
};

// AUDIT: K4 — isValidSession derinleştirildi: sadece tip değil içerik de doğrulanıyor
function isValidSession(session: unknown): session is ActiveSessionInfo {
  if (!session || typeof session !== 'object') return false;
  const s = session as Partial<ActiveSessionInfo>;

  // Temel tip kontrolü
  if (
    !Array.isArray(s.questions) ||
    !Array.isArray(s.answers) ||
    typeof s.currentIndex !== 'number' ||
    (s.mode !== 'quiz' && s.mode !== 'exam')
  ) {
    console.warn('[useResumableSession] Session tip doğrulaması başarısız.');
    return false;
  }

  // Boş soru dizisi geçersiz
  if (s.questions.length === 0) {
    console.warn('[useResumableSession] Session geçersiz: sorular boş.');
    return false;
  }

  // currentIndex sınır kontrolü
  if (s.currentIndex < 0 || s.currentIndex >= s.questions.length) {
    console.warn(`[useResumableSession] Session geçersiz: currentIndex=${s.currentIndex} sınır dışı.`);
    return false;
  }

  // İlk sorunun zorunlu alanları var mı?
  const firstQ = s.questions[0] as Partial<{ id: unknown; question: unknown; options: unknown; correctAnswer: unknown }>;
  if (!firstQ.id || !firstQ.question || !firstQ.options || !firstQ.correctAnswer) {
    console.warn('[useResumableSession] Session geçersiz: ilk soru eksik alan içeriyor.');
    return false;
  }

  // Cevap kayıtlarının zorunlu alanları
  for (const ans of s.answers) {
    const a = ans as Partial<{ question: unknown; state: unknown }>;
    if (!a.question || !a.state) {
      console.warn('[useResumableSession] Session geçersiz: cevap kaydı eksik alan içeriyor.');
      return false;
    }
  }

  return true;
}

/** Cloud active_sessions yönetimi: load + validate + save + delete tek yerde. */
export function useResumableSession(): UseResumableSessionResult {
  const [resumeSessionData, setResumeSessionData] = useState<ActiveSessionInfo | null>(null);

  const loadResumableSession = useCallback(async () => {
    try {
      const deviceId = getDeviceId();
      const cloud = await loadSessionFromCloud(deviceId);
      if (cloud) {
        const session = cloud as ActiveSessionInfo;
        if (!isValidSession(session) || session.answers.length >= session.questions.length) {
          await deleteSessionFromCloud(deviceId);
        } else {
          setResumeSessionData(session);
        }
      }
    } catch (err) {
      console.warn('Oturum yüklenemedi:', err);
    }
  }, []);

  useEffect(() => {
    loadResumableSession();
  }, [loadResumableSession]);

  const clearResumableSession = useCallback(async () => {
    try {
      await deleteSessionFromCloud(getDeviceId());
    } catch {
      // sessiz geç — davranış App.tsx ile aynı
    }
    setResumeSessionData(null);
  }, []);

  const saveResumableSession = useCallback(async (session: ActiveSessionInfo) => {
    if (session.answers.length >= session.questions.length) {
      setResumeSessionData(null);
      try {
        await deleteSessionFromCloud(getDeviceId());
      } catch {
        // sessiz
      }
    } else {
      setResumeSessionData(session);
      try {
        await saveSessionToCloud(getDeviceId(), session);
      } catch {
        // sessiz
      }
    }
  }, []);

  return {
    resumeSessionData,
    clearResumableSession,
    saveResumableSession,
  };
}
