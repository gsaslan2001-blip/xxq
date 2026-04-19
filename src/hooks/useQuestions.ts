import { useState, useCallback, useRef } from 'react';
import {
  fetchQuestions,
  fetchQuestionMetadata,
  fetchQuestionsByUnit,
  rowToQuestion,
  deleteQuestion as deleteQuestionRemote,
  toggleFavoriteInCloud,
  updateQuestion as updateQuestionRemote,
  flagQuestion as flagQuestionRemote,
  type QuestionMetadata,
} from '../lib/supabase';
import { syncStatsDown } from '../lib/stats';
import type { Question } from '../data';

export type LoadingState = 'idle' | 'loading' | 'loaded' | 'error';

export type UseQuestionsResult = {
  questions: Question[];
  metadata: QuestionMetadata[];
  setQuestions: React.Dispatch<React.SetStateAction<Question[]>>;
  /** @deprecated `loadStatus === 'loading'` kullan */
  loading: boolean;
  loadStatus: LoadingState;
  loadError: string;
  reload: (forceSync?: boolean, flaggedOnly?: boolean) => Promise<void>;
  loadMetadata: () => Promise<void>;
  loadUnitQuestions: (lesson: string, unit: string) => Promise<void>;
  updateQuestion: (edited: Question) => Promise<void>;
  deleteQuestion: (id: string) => Promise<void>;
  toggleFavorite: (id: string, newStatus: boolean) => Promise<void>;
  flagQuestion: (id: string, reason: string) => Promise<void>;
};

/**
 * Questions CRUD hook — tek source-of-truth `questions` state'i tutar.
 * Mutasyonlar optimistic; Supabase hatasında exception throw edilir.
 */
export function useQuestions(): UseQuestionsResult {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [metadata, setMetadata] = useState<QuestionMetadata[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadingState>('idle');
  const [loadError, setLoadError] = useState('');
  const isFirstLoad = useRef(true);

  // Performans Krizi Çözümü 1: Sadece ders/ünite listesini (metadata) yükler
  const loadMetadata = useCallback(async () => {
    setLoadStatus('loading');
    setLoadError('');
    try {
      const meta = await fetchQuestionMetadata();
      setMetadata(meta);
      setLoadStatus('loaded');
      if (isFirstLoad.current) {
        syncStatsDown().catch(() => { });
        isFirstLoad.current = false;
      }
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setLoadStatus('error');
    }
  }, []);

  // Performans Krizi Çözümü 2: Seçili ünitenin metinlerini lazy olarak çeker
  const loadUnitQuestions = useCallback(async (lesson: string, unit: string) => {
    setLoadStatus('loading');
    setLoadError('');
    try {
      const rows = await fetchQuestionsByUnit(lesson, unit);
      setQuestions(rows.map(rowToQuestion));
      setLoadStatus('loaded');
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setLoadStatus('error');
    }
  }, []);

  const reload = useCallback(async (forceSync = false, flaggedOnly = false) => {
    setLoadStatus('loading');
    setLoadError('');
    try {
      const rows = await fetchQuestions(flaggedOnly);
      setQuestions(rows.map(rowToQuestion));
      setLoadStatus('loaded');
      if (isFirstLoad.current || forceSync) {
        syncStatsDown().catch(() => { });
        isFirstLoad.current = false;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error
        ? e.message
        : (e as { message?: string })?.message ?? JSON.stringify(e);
      setLoadError(msg);
      setLoadStatus('error');
    }
  }, []);

  // NOT: useEffect kaldırıldı, App.tsx startup'ta loadMetadata'yı tetikleyecek.

  const updateQuestion = useCallback(async (edited: Question) => {
    // Optimistic UI
    const previousState = [...questions];
    setQuestions(prev => prev.map(q => q.id === edited.id ? edited : q));

    try {
      await updateQuestionRemote(edited.id, {
        question: edited.question,
        option_a: edited.options.A,
        option_b: edited.options.B,
        option_c: edited.options.C,
        option_d: edited.options.D,
        option_e: edited.options.E,
        correct_answer: edited.correctAnswer,
        explanation: edited.explanation,
      });
    } catch (error) {
      setQuestions(previousState);
      throw error;
    }
  }, [questions]);

  const deleteQuestion = useCallback(async (id: string) => {
    const previousState = [...questions];
    setQuestions(prev => prev.filter(q => q.id !== id));

    try {
      await deleteQuestionRemote(id);
    } catch (error) {
      setQuestions(previousState);
      throw error;
    }
  }, [questions]);

  const toggleFavorite = useCallback(async (id: string, newStatus: boolean) => {
    const previousState = [...questions];
    setQuestions(prev => prev.map(x => x.id === id ? { ...x, is_favorite: newStatus } : x));

    try {
      await toggleFavoriteInCloud(id, newStatus);
    } catch (error) {
      setQuestions(previousState);
      throw error;
    }
  }, [questions]);

  const flagQuestion = useCallback(async (id: string, reason: string) => {
    const previousState = [...questions];
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, flagged: true, flag_reason: reason } : q));

    try {
      await flagQuestionRemote(id, reason);
    } catch (error) {
      setQuestions(previousState);
      throw error;
    }
  }, [questions]);

  return {
    questions,
    metadata,
    setQuestions,
    loading: loadStatus === 'loading',
    loadStatus,
    loadError,
    reload,
    loadMetadata,
    loadUnitQuestions,
    updateQuestion,
    deleteQuestion,
    toggleFavorite,
    flagQuestion,
  };
}
