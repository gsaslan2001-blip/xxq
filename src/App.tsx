import { useState, useEffect, useCallback } from 'react';
import { importQuestions, deleteQuestionsInLesson, deleteQuestionsInUnit, renameLesson, renameUnit, loadTodaysDailyExam, markDailyExamCompleted, saveExamAnswers, type DailyExamRow } from './lib/supabase';
import { useQuestions } from './hooks/useQuestions';
import { useResumableSession } from './hooks/useResumableSession';
import { useAuth } from './hooks/useAuth';
import { useRealtimeStats } from './hooks/useRealtimeStats';
import { AuthModal } from './components/AuthModal';
import type { Question } from './data';
import { getWeakQuestionIds, getUnitProgress, syncStatsUp, syncStatsDown, loadStreak, getRecentActivity, getDueForReviewIds, migrateAllStatsToFSRSIfNeeded, loadAllStats, getDeviceId, resetAllStats, setSyncUserId, mergeWrongChoices } from './lib/stats';
import ErrorAnalyticsView from './components/ErrorAnalyticsView';
import SimulationResultView from './components/SimulationResultView';
import type { AnswerDetail as SimAnswerDetail } from './components/SimulationResultView';
import DailyPlanView from './components/DailyPlanView';
import { SourceBooksView } from './components/SourceBooksView';
import { buildSmartQueue, getForecastNextDays, buildUnitQueue, buildExamPool, buildSimulationPool } from './lib/adaptive';
import {
  CheckCircle2, XCircle, ArrowRight, ArrowLeft, RotateCcw, BookOpen,
  ChevronRight, ChevronLeft, RefreshCw, LayoutGrid,
  Upload, Download, AlertCircle, CheckCheck, Loader2, Trash2, Pencil, Star,
  AlertTriangle, FileText, Settings, BarChart3, Zap, Brain, Target, Calendar,
  UserCircle, Skull, Microscope, HeartPulse, Brush, Syringe, Hourglass, Layers, ClipboardList
} from 'lucide-react';
import { fisherYates } from './lib/shuffle';
import { todayStr } from './lib/dateUtils';
import { themeColors, type Theme } from './theme';
import type { AppState, AnswerDetail, QuizStatsType, ActiveSessionInfo, UserSettings } from './types/app';
import { QuizView } from './components/quiz/QuizView';

// (Faz 3: window._simTotalSeconds kaldırıldı — simTotalSeconds React state'e taşındı)

// Theme tipi eski yerden (App.tsx) export ediliyordu; geriye dönük uyumluluk için re-export.
export type { Theme } from './theme';

const errMsg = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null) return JSON.stringify(e);
  return String(e);
};

function Logo() {
  return (
    <img
      src="/logo.png"
      alt="DUSBANKASI Logo"
      className="w-9 h-9 rounded-full object-cover drop-shadow-[0_0_8px_rgba(130,90,240,0.5)]"
    />
  );
}

function CountdownWidget() {
  const [daysLeft, setDaysLeft] = useState(0);
  useEffect(() => {
    const calc = () => {
      const TARGET_DATE = new Date('2026-11-01T00:00:00').getTime();
      setDaysLeft(Math.max(0, Math.floor((TARGET_DATE - Date.now()) / (1000 * 60 * 60 * 24))));
    };
    calc();
    const interval = setInterval(calc, 60000); // 1 dk
    return () => clearInterval(interval);
  }, []);
  
  if (daysLeft === 0) {
    return (
      <div className="flex items-center gap-3 pr-5 pl-2.5 py-1.5 rounded-[1.25rem] bg-emerald-500/[0.08] border border-emerald-500/15 mx-4 lg:mx-8 hidden sm:flex shadow-[0_0_20px_rgba(16,185,129,0.05)] backdrop-blur-md relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-transparent blur-xl pointer-events-none" />
        <div className="w-9 h-9 rounded-xl bg-emerald-500/[0.15] flex items-center justify-center border border-emerald-400/20 shadow-lg shadow-emerald-500/20 relative z-10">
          <span className="text-emerald-500 dark:text-emerald-400 font-black text-xs">✓</span>
        </div>
        <div className="flex flex-col relative z-10">
          <span className="text-[10px] font-black tracking-widest text-emerald-600 dark:text-emerald-400 uppercase leading-[1.2] opacity-90 drop-shadow-[0_1px_10px_rgba(255,255,255,0.8)] dark:drop-shadow-none">TEBRİKLER</span>
          <span className="text-sm font-black text-slate-800 dark:text-zinc-100 leading-none drop-shadow-[0_2px_12px_rgba(255,255,255,1)] dark:drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">Sınav Tamamlandı</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 pr-5 pl-2.5 py-1.5 rounded-[1.25rem] bg-indigo-500/[0.08] border border-indigo-500/15 mx-4 lg:mx-8 hidden sm:flex shadow-[0_0_20px_rgba(99,102,241,0.05)] backdrop-blur-md relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 to-transparent blur-xl pointer-events-none" />
      <div className="w-9 h-9 rounded-xl bg-indigo-500/[0.15] flex items-center justify-center border border-indigo-400/20 shadow-lg shadow-indigo-500/20 relative z-10">
        <Hourglass size={18} className="text-indigo-500 dark:text-indigo-400 countdown-spin filter drop-shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
      </div>
      <div className="flex flex-col relative z-10">
        <span className="text-[10px] font-black tracking-widest text-indigo-600 dark:text-indigo-400 uppercase leading-[1.2] opacity-90 drop-shadow-[0_1px_10px_rgba(255,255,255,0.8)] dark:drop-shadow-none">DUS 2026/2</span>
        <span className="text-sm font-black text-slate-800 dark:text-zinc-100 leading-none drop-shadow-[0_2px_12px_rgba(255,255,255,1)] dark:drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">{daysLeft} Gün Kaldı</span>
      </div>
    </div>
  );
}

/* --- MAIN APP --- */
export default function App() {
  const [appState, setAppState] = useState<AppState>('select-lesson');
  const [mode, setMode] = useState<'quiz' | 'exam'>('quiz');
  const [selectedLesson, setSelectedLesson] = useState('');
  const [selectedUnit, setSelectedUnit] = useState('');
  const [examUnits, setExamUnits] = useState<{ lesson: string; unit: string }[]>([]);
  const [examQuestions, setExamQuestions] = useState<Question[]>([]);
  const [unitQuestions, setUnitQuestions] = useState<Question[]>([]);
  const [isFavoritesExam, setIsFavoritesExam] = useState(false);
  const [examLoading, setExamLoading] = useState(false);
  const [quizStats, setQuizStats] = useState<QuizStatsType>({ correct: 0, incorrect: 0, blank: 0, total: 0, details: [] });
  const {
    questions,
    setQuestions,
    loading,
    loadError,
    reload: loadQuestions,
    updateQuestion: updateQuestionInHook,
    deleteQuestion: deleteQuestionInHook,
    toggleFavorite: toggleFavoriteInHook,
    flagQuestion: flagQuestionInHook,
  } = useQuestions();

  // useAuth önce — useResumableSession'a userId geçmek için
  const { user, signOut } = useAuth();

  const {
    resumeSessionData,
    isSessionLoading,
    clearResumableSession,
    saveResumableSession,
  } = useResumableSession(user?.id);
  const [simTotalSeconds, setSimTotalSeconds] = useState<number | null>(null);
  const [simResult, setSimResult] = useState<{ details: SimAnswerDetail[]; totalSeconds: number; usedSeconds: number } | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [reportingQuestion, setReportingQuestion] = useState<Question | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle');
  const [statsVersion, setStatsVersion] = useState(0); // Sync sonrası UI refresh için
  const [showSettings, setShowSettings] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [todaysDailyExam, setTodaysDailyExam] = useState<DailyExamRow | null | 'loading'>('loading');
  const [isDailyExamSession, setIsDailyExamSession] = useState(false);
  const [activeDailyExamId, setActiveDailyExamId] = useState<string | undefined>(undefined);

  // Merkezi Dialog State
  const [dialog, setDialog] = useState<{
    type: 'alert' | 'confirm' | 'prompt';
    title?: string;
    message: string;
    defaultValue?: string;
    onConfirm: (val?: string) => void;
    onCancel?: () => void;
  } | null>(null);

  const showAlert = useCallback((message: string, title?: string) => {
    setDialog({ type: 'alert', message, title, onConfirm: () => setDialog(null) });
  }, []);

  const showConfirm = useCallback((message: string, onConfirm: () => void, title?: string) => {
    setDialog({ type: 'confirm', message, title, onConfirm: () => { onConfirm(); setDialog(null); }, onCancel: () => setDialog(null) });
  }, []);

  const showPrompt = useCallback((message: string, defaultValue: string, onConfirm: (val: string) => void, title?: string) => {
    setDialog({ type: 'prompt', message, defaultValue, title, onConfirm: (val) => { if (val && val.trim()) onConfirm(val.trim()); setDialog(null); }, onCancel: () => setDialog(null) });
  }, []);

  useRealtimeStats({
    userId: user?.id ?? null,
    deviceId: getDeviceId(),
    onStatUpdate: useCallback((questionId: string, stat) => {
      // Başka cihazdan gelen FSRS güncellemesini localStorage'a merge et
      const stats = loadAllStats();
      const local = stats[questionId];
      const localLR = local?.lastReview ?? '';
      const cloudLR = stat.lastReview ?? '';
      if (!local || cloudLR > localLR) {
        stats[questionId] = {
          attempts: Math.max(stat.attempts, local?.attempts ?? 0),
          corrects: Math.max(stat.corrects, local?.corrects ?? 0),
          lastSeen: stat.lastSeen || local?.lastSeen || '',
          stability: stat.stability ?? local?.stability,
          difficulty: stat.difficulty ?? local?.difficulty,
          lastReview: stat.lastReview ?? local?.lastReview ?? '',
          scheduledDays: stat.scheduledDays ?? local?.scheduledDays ?? 1,
          fsrsReps: stat.fsrsReps ?? local?.fsrsReps ?? 0,
          easeFactor: local?.easeFactor ?? 2.5,
          interval: local?.interval ?? 1,
          repetitions: local?.repetitions ?? 0,
          nextReview: local?.nextReview ?? todayStr(),
          wrongChoices: mergeWrongChoices(local?.wrongChoices ?? [], stat.wrongChoices ?? []),
        };
        localStorage.setItem('dus_question_stats', JSON.stringify(stats));
      }
    }, []),
  });

  const [settings, setSettings] = useState<UserSettings>(() => {
    try {
      const saved = localStorage.getItem('dus_settings');
      return saved ? JSON.parse(saved) : { theme: 'dark', fontSize: 'normal' };
    } catch {
      return { theme: 'dark', fontSize: 'normal' };
    }
  });

  useEffect(() => {
    localStorage.setItem('dus_settings', JSON.stringify(settings));
    document.documentElement.className = settings.theme;
  }, [settings]);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  // userId değişiminde sync sistemine bildir (tüm push/pull işlemleri user bazlı olur)
  useEffect(() => {
    setSyncUserId(user?.id ?? null);
    // Giriş yapıldığında cloud'dan güncel veriyi çek (merge sonrası localStorage'ı tazele)
    if (user) {
      syncStatsDown()
        .then(() => setStatsVersion(v => v + 1))
        .catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    if (!user) { setTodaysDailyExam(null); return; }
    let cancelled = false;
    loadTodaysDailyExam(user.id)
      .then(exam => { if (!cancelled) setTodaysDailyExam(exam); })
      .catch(() => { if (!cancelled) setTodaysDailyExam(null); });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    try {
      const result = migrateAllStatsToFSRSIfNeeded();
      if (result.migrated) {
        console.log(`[FSRS Migration] ${result.count} kart migrate edildi.`);
      }
    } catch (err) {
      console.warn('[FSRS Migration] Hata:', err);
    }
  }, []);

  const handleToggleFavorite = async (id: string) => {
    const q = questions.find(x => x.id === id) || examQuestions.find(x => x.id === id) || unitQuestions.find(x => x.id === id);
    if (!q) return;
    const newStatus = !q.is_favorite;
    try {
      await toggleFavoriteInHook(id, newStatus);
      // Also update unitQuestions (quiz mode uses this as activeQuestions)
      setUnitQuestions(prev => prev.map(x => x.id === id ? { ...x, is_favorite: newStatus } : x));
      setExamQuestions(prev => {
        const updated = prev.map(x => x.id === id ? { ...x, is_favorite: newStatus } : x);
        if (!newStatus && isFavoritesExam) return updated.filter(x => x.id !== id);
        return updated;
      });
    } catch (e) { console.error("Buluta kaydedilemedi", e); }
  };

  const handleClearSession = async () => {
    await clearResumableSession();
  };

  const handleResumeSession = () => {
    if (resumeSessionData) {
      setExamQuestions(resumeSessionData.questions);
      setMode(resumeSessionData.mode);
      if (resumeSessionData.dailyExamId) {
        setIsDailyExamSession(true);
        setActiveDailyExamId(resumeSessionData.dailyExamId);
      }
      setAppState('quiz');
    }
  };

  const handleDeleteLesson = async (lesson: string, e: React.MouseEvent) => {
    e.stopPropagation();
    showConfirm(`${lesson} dersini ve tüm sorularını silmek istediğinize emin misiniz?`, async () => {
      try { 
        await deleteQuestionsInLesson(lesson); 
        setQuestions(p => p.filter(q => q.lesson !== lesson)); 
      } catch (err: unknown) { 
        showAlert(errMsg(err), 'Hata'); 
      }
    }, 'Dersi Sil');
  };

  const handleDeleteUnit = async (unit: string, e: React.MouseEvent) => {
    e.stopPropagation();
    showConfirm(`${unit} ünitesini silmek istediğinize emin misiniz?`, async () => {
      try { 
        await deleteQuestionsInUnit(selectedLesson, unit); 
        setQuestions(p => p.filter(q => !(q.lesson === selectedLesson && q.unit === unit))); 
      } catch (err: unknown) { 
        showAlert(errMsg(err), 'Hata'); 
      }
    }, 'Üniteyi Sil');
  };

  const handleDeleteQuestion = async (id: string) => {
    showConfirm('Bu soruyu silmek istediğinize emin misiniz?', async () => {
      try { await deleteQuestionInHook(id); } catch (err: unknown) { showAlert(errMsg(err), 'Hata'); }
    }, 'Soruyu Sil');
  };

  const handleRenameLesson = async (oldLesson: string, e: React.MouseEvent) => {
    e.stopPropagation();
    showPrompt(`${oldLesson} dersi için yeni bir isim girin:`, oldLesson, async (newLesson) => {
      if (newLesson.trim() === '' || newLesson === oldLesson) return;
      try {
        await renameLesson(oldLesson, newLesson.trim());
        setQuestions(p => p.map(q => q.lesson === oldLesson ? { ...q, lesson: newLesson.trim() } : q));
      } catch (err: unknown) { showAlert(errMsg(err), 'Hata'); }
    }, 'Dersi Yeniden Adlandır');
  };

  const handleRenameUnit = async (unit: string, e: React.MouseEvent) => {
    e.stopPropagation();
    showPrompt(`${unit} ünitesi için yeni bir isim girin:`, unit, async (newUnit) => {
      if (newUnit.trim() === '' || newUnit === unit) return;
      try {
        await renameUnit(selectedLesson, unit, newUnit.trim());
        setQuestions(p => p.map(q => q.lesson === selectedLesson && q.unit === unit ? { ...q, unit: newUnit.trim() } : q));
      } catch (err: unknown) { showAlert(errMsg(err), 'Hata'); }
    }, 'Üniteyi Yeniden Adlandır');
  };

  const handleSaveEdit = async (edited: Question) => {
    try {
      await updateQuestionInHook(edited);
      setExamQuestions(prev => prev.map(q => q.id === edited.id ? edited : q));
      setUnitQuestions(prev => prev.map(q => q.id === edited.id ? edited : q));
      setEditingQuestion(null);
    } catch (err: unknown) { showAlert("Güncellenemedi: " + errMsg(err), 'Hata'); }
  };

  const handleSaveReport = async (id: string, reason: string) => {
    try {
      await flagQuestionInHook(id, reason);
      setReportingQuestion(null);
      showAlert("Soru başarıyla raporlandı. Teşekkürler!", 'Başarılı');
    } catch (err: unknown) { showAlert("Raporlanamadı: " + errMsg(err), 'Hata'); }
  };


  const handleSyncStats = async () => {
    setSyncStatus('syncing');
    try {
      const pushResult = await syncStatsUp();   // önce local'i cloud'a push et
      if (pushResult.errors.length > 0) {
        console.error('[Sync] Push hataları:', pushResult.errors);
      }
      await syncStatsDown(); // sonra cloud'dan pull edip merge yap
      setStatsVersion(v => v + 1); // UI'ı tazele (loadAllStats vb. re-render)
      setSyncStatus('done');
      setTimeout(() => setSyncStatus('idle'), 2500);
      if (pushResult.errors.length > 0) {
        showAlert(
          `${pushResult.pushed}/${pushResult.total} kayıt sync edildi.\n${pushResult.errors.length} batch hatası oluştu.`,
          'Kısmi Sync'
        );
      }
    } catch (err) {
      setSyncStatus('error');
      setTimeout(() => setSyncStatus('idle'), 3000);
      showAlert('Sync başarısız: ' + errMsg(err), 'Hata');
    }
  };

  const handleSimulationClick = () => {
    setAppState('simulation-setup');
  };

  const handleDailyExamStart = () => {
    if (isSessionLoading) {
      showAlert('Oturum bilgisi yükleniyor, lütfen bekleyin...', 'Bilgi');
      return;
    }
    if (!todaysDailyExam || todaysDailyExam === 'loading') return;
    const exam = todaysDailyExam as DailyExamRow;

    // Eğer bu sınav için kaydedilmiş yarım oturum varsa, kaldığı yerden devam et
    if (
      resumeSessionData &&
      resumeSessionData.dailyExamId === exam.id &&
      resumeSessionData.answers.length > 0
    ) {
      handleResumeSession();
      return;
    }

    const idSet = new Set(exam.question_ids);
    const dailyQs = questions.filter(q => idSet.has(q.id));
    if (dailyQs.length === 0) {
      showAlert('Bugüne ait günlük deneme sınavı soruları henüz yüklenemedi. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.', 'Bilgi');
      return;
    }
    setExamQuestions(dailyQs);
    setMode('exam');
    setIsDailyExamSession(true);
    setActiveDailyExamId(exam.id);
    setAppState('quiz');
  };

  const handleResetStats = async () => {
    showConfirm('Tüm istatistikler (FSRS, doğruluk, streak, aktivite) kalıcı olarak silinecek. Emin misiniz?', async () => {
      try {
        await resetAllStats();
        showAlert('Tüm istatistikler sıfırlandı.', 'Başarılı');
      } catch (e) {
        showAlert('Sıfırlama hatası: ' + errMsg(e), 'Hata');
      }
    }, 'İstatistikleri Sıfırla');
  };

  const availableLessons = Array.from(new Set(questions.map((q) => q.lesson)));
  const unitsForLesson = Array.from(new Set(questions.filter((q) => q.lesson === selectedLesson).map((q) => q.unit)));

  const handleLessonSelect = (lesson: string) => { setSelectedLesson(lesson); setAppState('select-unit'); };
  const handleUnitSelect = async (unit: string) => {
    setSelectedUnit(unit);
    const allStats = loadAllStats();
    const unitQs = questions.filter(q => q.unit === unit && q.lesson === selectedLesson);
    const unseen = fisherYates(unitQs.filter(q => !allStats[q.id] || allStats[q.id].attempts === 0));
    const seen   = fisherYates(unitQs.filter(q => allStats[q.id] && allStats[q.id].attempts > 0));
    setUnitQuestions([...unseen, ...seen]);
    setMode('quiz');
    setAppState('quiz');
  };

  const handleComplete = (answers: AnswerDetail[]) => {
    const correct = answers.filter(a => a.state === 'correct').length;
    const incorrect = answers.filter(a => a.state === 'incorrect').length;
    const blank = answers.filter(a => a.state === 'blank').length;
    setQuizStats({ correct, incorrect, blank, total: answers.length, details: answers });
    setAppState('result');
    clearResumableSession().catch(() => { });
    if (isDailyExamSession && activeDailyExamId) {
      // Faz 5: Deneme cevaplarını kalıcı olarak kaydet
      if (user) {
        saveExamAnswers(activeDailyExamId, user.id, answers).catch(() => {});
      }
      markDailyExamCompleted(activeDailyExamId).catch(() => {});
      setTodaysDailyExam(null);
      setIsDailyExamSession(false);
      setActiveDailyExamId(undefined);
    }
  };
  const handleReturnToHome = () => { setIsDailyExamSession(false); setActiveDailyExamId(undefined); setAppState('select-lesson'); setSelectedLesson(''); setSelectedUnit(''); setMode('quiz'); setUnitQuestions([]); };


  const handleExportPDF = (selection: Question[], title: string) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert('Popup engellendi. Tarayıcı ayarlarından popup izni verin.'); return; }
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const date = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
    const PER_PAGE = 6;

    const chunks: Question[][] = [];
    for (let i = 0; i < selection.length; i += PER_PAGE) chunks.push(selection.slice(i, i + PER_PAGE));

    const renderQuestionPage = (chunk: Question[], chunkIndex: number) => {
      const offset = chunkIndex * PER_PAGE;
      return `
<div class="page questions-page">
  <div class="page-header">
    <span class="page-title">📚 ${esc(title)}</span>
    <span class="page-meta">SORULAR ${offset + 1}–${offset + chunk.length} · ${selection.length} Soru · ${date}</span>
  </div>
  <div class="q-grid">
    ${chunk.map((q, i) => `
    <div class="qblock">
      <div class="qnum">SORU ${offset + i + 1}</div>
      <div class="qtext">${esc(q.question)}</div>
      <div class="opts">
        ${(['A','B','C','D','E'] as const).map(k => q.options[k] ? `
        <div class="opt"><span class="opt-key">${k}</span><span class="opt-text">${esc(q.options[k] || '')}</span></div>` : '').join('')}
      </div>
    </div>`).join('')}
  </div>
  <div class="page-footer">DUSBANKASI — ${date} · ${offset + 1}–${offset + chunk.length} / ${selection.length}</div>
</div>`;
    };

    const renderAnswerPage = (chunk: Question[], chunkIndex: number) => {
      const offset = chunkIndex * PER_PAGE;
      return `
<div class="page answer-page">
  <div class="page-header">
    <span class="page-title">✅ Cevap Anahtarı &amp; Açıklamalar</span>
    <span class="page-meta">${esc(title)} · ${offset + 1}–${offset + chunk.length}</span>
  </div>
  <div class="answer-key-grid">
    ${chunk.map((q, i) => `
    <div class="answer-badge">
      <span class="ans-num">${offset + i + 1}</span>
      <span class="ans-val">${q.correctAnswer}</span>
    </div>`).join('')}
  </div>
  <div class="exp-list">
    ${chunk.map((q, i) => `
    <div class="exp-block">
      <div class="exp-header">
        <span class="exp-num">${offset + i + 1}</span>
        <span class="exp-correct">Cevap: ${q.correctAnswer}</span>
      </div>
      ${q.explanation ? `<div class="exp-text">${esc(q.explanation).replace(/\n/g, '<br>')}</div>` : '<div class="exp-text exp-empty">Açıklama bulunmuyor.</div>'}
    </div>`).join('')}
  </div>
  <div class="page-footer">DUSBANKASI — ${date} · Sayfa ${chunkIndex + 1}</div>
</div>`;
    };

    const html = `<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8"><title>${esc(title)} — DUSBANKASI</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,Arial,sans-serif;color:#1a1a2e;font-size:11px;line-height:1.55;background:#fff}
.page{width:100%;padding:16px 20px;page-break-after:always}
.page:last-child{page-break-after:auto}
.page-header{display:flex;justify-content:space-between;align-items:center;padding-bottom:8px;margin-bottom:12px;border-bottom:2px solid #6366f1}
.page-title{font-size:12px;font-weight:900;color:#4f46e5}
.page-meta{font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em}
.page-footer{margin-top:10px;padding-top:6px;border-top:1px solid #e5e7eb;font-size:8.5px;color:#9ca3af;text-align:center;letter-spacing:.05em}
.questions-page{background:#fff}
.q-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px 14px}
.qblock{border:1px solid #e8e8f0;border-radius:10px;padding:10px 11px;break-inside:avoid;background:#fcfcff}
.qblock:nth-child(odd){border-left:3px solid #6366f1}
.qblock:nth-child(even){border-left:3px solid #a855f7}
.qnum{font-size:8.5px;font-weight:900;letter-spacing:.15em;color:#6366f1;text-transform:uppercase;margin-bottom:5px}
.qtext{font-weight:600;font-size:10.5px;margin-bottom:7px;color:#111827;line-height:1.5}
.opts{display:flex;flex-direction:column;gap:2.5px}
.opt{display:flex;align-items:flex-start;gap:6px;font-size:10px;padding:2px 0;line-height:1.4}
.opt-key{font-weight:900;color:#4f46e5;min-width:14px;flex-shrink:0;background:#eef2ff;border-radius:3px;text-align:center;padding:0 3px}
.opt-text{color:#374151}
.answer-page{background:#f8f8ff}
.answer-key-grid{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:14px;padding:12px 14px;background:#fff;border:1px solid #e0e0f0;border-radius:10px}
.answer-badge{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:36px}
.ans-num{font-size:8px;font-weight:900;color:#9ca3af;letter-spacing:.05em}
.ans-val{font-size:14px;font-weight:900;color:#fff;background:linear-gradient(135deg,#059669,#10b981);border-radius:7px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(16,185,129,.25)}
.exp-list{display:grid;grid-template-columns:1fr 1fr;gap:7px 12px}
.exp-block{background:#fff;border:1px solid #e0e0f0;border-radius:9px;padding:9px 11px;break-inside:avoid}
.exp-header{display:flex;align-items:center;gap:7px;margin-bottom:5px}
.exp-num{font-size:10px;font-weight:900;color:#fff;background:#6366f1;border-radius:5px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.exp-correct{font-size:9.5px;font-weight:900;color:#059669;background:#d1fae5;border-radius:4px;padding:2px 7px}
.exp-text{font-size:9.5px;color:#374151;line-height:1.55}
.exp-empty{color:#9ca3af;font-style:italic}
@media print{
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{padding:10px 14px}
  @page{margin:6mm;size:A4}
}
</style></head><body>
${chunks.map((chunk, ci) => renderQuestionPage(chunk, ci) + renderAnswerPage(chunk, ci)).join('')}
</body></html>`;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); }, 700);
  };


  const handleWeakQuestionsClick = () => {
    const weakIds = getWeakQuestionIds();
    const weakQs = questions.filter(q => weakIds.includes(q.id));
    if (weakQs.length === 0) {
      showAlert('Henüz zayıf soru bulunamadı. En az 2 kez çözülmüş ve %50 altı doğru oranlı sorular burada görünecek.', 'Bilgi');
      return;
    }
    setExamQuestions(fisherYates(weakQs));
    setMode('exam');
    setAppState('quiz');
  };

  const handleDueReviewClick = () => {
    const dueIds = getDueForReviewIds();
    const dueQs = questions.filter(q => dueIds.includes(q.id));
    if (dueQs.length === 0) {
      alert('Bugün tekrar edilmesi gereken soru bulunamadı. FSRS-5 algoritmasına göre zamanı gelen sorular burada görünecek.');
      return;
    }
    setExamQuestions(fisherYates(dueQs));
    setMode('exam');
    setAppState('quiz');
  };

  const handleRetryIncorrect = (incorrectDetails: AnswerDetail[]) => {
    const retryQs = incorrectDetails.map(d => d.question);
    setExamQuestions(fisherYates(retryQs));
    setMode('exam');
    setAppState('quiz');
  };

  const handleGoBack = useCallback(() => {
    switch (appState) {
      case 'quiz':
        setUnitQuestions([]);
        setIsDailyExamSession(false);
        setActiveDailyExamId(undefined);
        setAppState(mode === 'exam' ? 'select-lesson' : 'select-unit');
        break;
      case 'select-unit':
      case 'select-deneme':
      case 'select-favorites':
      case 'weak-questions':
      case 'analytics':
      case 'due-review':
      case 'import':
      case 'result':
      case 'error-analysis':
      case 'simulation-setup':
      case 'simulation-result':
      case 'smart-study':
      case 'daily-plan':
        setAppState('select-lesson');
        break;
      case 'select-deneme-amount':
        setAppState(isFavoritesExam ? 'select-favorites' : 'select-deneme');
        break;
      default:
        setAppState('select-lesson');
    }
  }, [appState, mode, isFavoritesExam]);

  useEffect(() => {
    if (appState !== 'select-lesson') {
      window.history.pushState({ appState }, '');
    }
    const onPopState = () => {
      handleGoBack();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [appState, handleGoBack]);

  const handleImportDone = () => { loadQuestions(); setAppState('select-lesson'); setMode('quiz'); };

  const handleExport = () => {
    const dataStr = JSON.stringify(questions, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dus_bankasi_yedek_${todayStr()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleStartExam = (amount: number) => {
    setExamLoading(true);
    try {
      const pool = buildExamPool(
        questions,
        examUnits,
        loadAllStats(),
        amount,
        isFavoritesExam ? (q: Question) => !!q.is_favorite : undefined,
      );
      setExamQuestions(pool);
      setMode('exam');
      setAppState('quiz');
      clearResumableSession().catch(() => { });
    } catch (e) {
      alert('Sınav havuzu oluşturulamadı: ' + errMsg(e));
    } finally {
      setExamLoading(false);
    }
  };

  const activeQuestions = mode === 'exam'
    ? examQuestions
    : (unitQuestions.length > 0 ? unitQuestions : questions.filter(q => q.unit === selectedUnit && q.lesson === selectedLesson));

  const theme = themeColors[settings.theme];

  return (
    <div className={`h-screen ${theme.bg} ${theme.text} selection:bg-indigo-500/20 font-sans overflow-hidden flex flex-col`}>
      <header className={`${theme.headerBg} backdrop-blur-2xl border-b ${theme.border} z-50 shrink-0`}>
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5 cursor-pointer group" onClick={handleGoBack}>
            {appState !== 'select-lesson' && (
              <ArrowLeft size={20} strokeWidth={2} className="text-indigo-400 group-hover:-translate-x-0.5 transition-transform" />
            )}
            <Logo />
            <h1 className="text-xl font-black tracking-tighter hidden lg:block text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">DUSBANKASI<sup className="text-[10px] font-bold text-zinc-300 ml-0.5">®</sup></h1>
          </div>
          
          <CountdownWidget />
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleSyncStats}
              className={`p-2 rounded-xl transition-all ${syncStatus === 'syncing' ? 'text-indigo-400 bg-indigo-500/10 animate-pulse' : `${theme.subtext} hover:bg-white/[0.06]`}`}
              title="Bulut Sync (Veri Yedekle)"
              disabled={syncStatus === 'syncing'}
            >
              <RefreshCw size={18} className={syncStatus === 'syncing' ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => setAppState('analytics')}
              className={`p-2 rounded-xl transition-all ${appState === 'analytics' ? 'text-indigo-400 bg-indigo-500/10' : `${theme.subtext} hover:bg-white/[0.06]`}`}
              title="İstatistikler"
            >
              <BarChart3 size={18} />
            </button>
            <button
              onClick={() => setAppState('error-analysis')}
              className={`p-2 rounded-xl transition-all ${appState === 'error-analysis' ? 'text-red-400 bg-red-500/10' : `${theme.subtext} hover:bg-white/[0.06]`}`}
              title="Hata Analizi"
            >
              <AlertTriangle size={18} />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className={`p-2 rounded-xl transition-all ${theme.subtext} hover:bg-white/[0.06]`}
              title="Ayarlar"
            >
              <Settings size={18} />
            </button>
            <button
              onClick={() => setShowAuth(true)}
              className={`p-2 rounded-xl transition-all ${user ? 'text-indigo-400 hover:bg-indigo-500/10' : `${theme.subtext} hover:bg-white/[0.06]`}`}
              title={user ? (user.email ?? 'Hesabım') : 'Giriş Yap'}
            >
              {user && user.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url as string}
                  className="w-5 h-5 rounded-full object-cover"
                  alt="Profil"
                />
              ) : (
                <UserCircle size={18} />
              )}
            </button>
            {appState === 'select-unit' && (
              <button onClick={() => setAppState('select-lesson')} className="btn btn-secondary btn-sm ml-1">
                <ChevronLeft size={14} /> Dersler
              </button>
            )}
          </div>
        </div>
      </header>

      <main key={statsVersion} className="flex-1 overflow-y-auto w-full max-w-[1400px] mx-auto px-4 sm:px-6">
        <div className="min-h-full py-5 flex flex-col">
          {appState === 'import' ? (
            <ImportView onDone={handleImportDone} theme={theme} />
          ) : loading ? (
            <div className="flex-1 flex items-center justify-center flex-col gap-4">
              <div className="relative">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center">
                  <Loader2 size={24} className="animate-spin text-indigo-400" />
                </div>
              </div>
              <p className={`${theme.subtext} text-sm font-medium`}>Sorular yükleniyor…</p>
            </div>
          ) : loadError ? (
            <div className="flex-1 flex items-center justify-center flex-col gap-4">
              <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center">
                <AlertCircle size={24} className="text-red-400" />
              </div>
              <p className="text-red-400 text-sm font-bold">Bağlantı Hatası</p>
              <p className={`${theme.subtext} text-xs max-w-sm text-center`}>{loadError}</p>
              <button onClick={() => loadQuestions()} className="btn btn-secondary btn-sm mt-2">Tekrar Dene</button>
            </div>
          ) : appState === 'analytics' ? (
            <AnalyticsDashboard questions={questions} theme={theme} />
          ) : appState === 'error-analysis' ? (
          <ErrorAnalyticsView
            questions={questions}
            stats={loadAllStats()}
            onStartWeakUnit={(lesson, unit) => {
              setSelectedLesson(lesson);
              setSelectedUnit(unit);
              setUnitQuestions(questions.filter(q => q.unit === unit && q.lesson === lesson));
              setMode('quiz');
              setAppState('quiz');
            }}
            theme={theme}
          />
          ) : appState === 'simulation-setup' ? (
            <SimulationSetup
              questions={questions}
              onStart={(qs, totalSecs) => {
                setExamQuestions(qs);
                setMode('exam');
                setSimResult(null);
                setSimTotalSeconds(totalSecs);
                setAppState('quiz');
              }}
              onCancel={() => setAppState('select-lesson')}
              theme={theme}
            />
          ) : appState === 'simulation-result' && simResult ? (
            <SimulationResultView
              details={simResult.details}
              totalSeconds={simResult.totalSeconds}
              usedSeconds={simResult.usedSeconds}
              onRestart={() => { setSimResult(null); setAppState('select-lesson'); }}
              onRetryIncorrect={() => {
                const incorrectQs = simResult.details
                  .filter(d => d.state === 'incorrect')
                  .map(d => d.question);
                setExamQuestions(incorrectQs);
                setMode('exam');
                setSimResult(null);
                setAppState('quiz');
              }}
              theme={theme}
            />
          ) : appState === 'select-lesson' ? (
            <LessonSelection
              questions={questions}
              lessons={availableLessons}
              onSelect={handleLessonSelect}
              totalQuestions={questions.length}
              onDelete={handleDeleteLesson}
              onRename={handleRenameLesson}
              onDenemeClick={() => setAppState('select-deneme')}
              onFavoritesClick={() => setAppState('select-favorites')}
              hasResume={!!resumeSessionData}
              resumeInfo={resumeSessionData ? {
                answeredCount: resumeSessionData.answers.length,
                totalCount: resumeSessionData.questions.length,
                remaining: resumeSessionData.questions.length - resumeSessionData.answers.length
              } : null}
              onResumeClick={handleResumeSession}
              onResumeClear={handleClearSession}
              favoritesCount={questions.filter(q => q.is_favorite).length}
              weakCount={getWeakQuestionIds().length}
              onWeakClick={handleWeakQuestionsClick}
              dueCount={getDueForReviewIds().length}
              onDueClick={handleDueReviewClick}
              onSimulationClick={handleSimulationClick}
              onDailyPlanClick={() => setAppState('daily-plan')}
              onDailyExamClick={handleDailyExamStart}
              dailyExamStatus={
                !user ? 'no-user' :
                (todaysDailyExam === 'loading' || isSessionLoading) ? 'loading' :
                todaysDailyExam === null ? 'not-ready' :
                {
                  dayNumber: (todaysDailyExam as DailyExamRow).day_number,
                  questionCount: (todaysDailyExam as DailyExamRow).question_ids.length,
                  resumeAt: (resumeSessionData?.dailyExamId === (todaysDailyExam as DailyExamRow).id && (resumeSessionData?.answers.length ?? 0) > 0)
                    ? resumeSessionData!.answers.length
                    : undefined,
                }
              }
              onSmartStudyClick={() => {
                const queue = buildSmartQueue(questions, loadAllStats(), { limit: 40 });
                setExamQuestions(queue.questions);
                setMode('exam');
                setAppState('smart-study');
              }}
              theme={theme}
            />
          ) : appState === 'source-books' ? (
            <SourceBooksView questions={questions} onBack={() => setAppState('select-lesson')} theme={theme} />
          ) : appState === 'select-deneme' ? (
            <DenemeSelection questions={questions} onNext={(units) => { setExamUnits(units); setIsFavoritesExam(false); setAppState('select-deneme-amount'); }} onCancel={() => setAppState('select-lesson')} isFavoritesMode={false} theme={theme} />
          ) : appState === 'select-favorites' ? (
            <DenemeSelection questions={questions.filter(q => q.is_favorite)} onNext={(units) => { setExamUnits(units); setIsFavoritesExam(true); setAppState('select-deneme-amount'); }} onCancel={() => setAppState('select-lesson')} isFavoritesMode={true} theme={theme} />
          ) : appState === 'select-deneme-amount' ? (
            <DenemeAmountSelection selectedUnits={examUnits} questions={isFavoritesExam ? questions.filter(q => q.is_favorite) : questions} loading={examLoading} onStart={handleStartExam} onCancel={() => setAppState('select-deneme')} theme={theme} />
          ) : appState === 'select-unit' ? (
            <UnitSelection 
              lesson={selectedLesson} 
              units={unitsForLesson} 
              questions={questions}
              onSelect={handleUnitSelect} 
              onDelete={handleDeleteUnit} 
              onRename={handleRenameUnit} 
              onExportPDF={handleExportPDF} 
              theme={theme} 
            />
          ) : appState === 'quiz' ? (
            <QuizView
              mode={mode}
              unit={mode === 'exam' ? (simTotalSeconds ? 'DUS Simülasyonu' : 'Deneme Sınavı') : selectedUnit}
              questions={activeQuestions}
              initialSession={mode === 'exam' && !simTotalSeconds ? resumeSessionData : null}
              onComplete={handleComplete}
              onDeleteQuestion={handleDeleteQuestion}
              onFinishEarly={handleComplete}
              onToggleFavorite={handleToggleFavorite}
              onEditQuestion={setEditingQuestion}
              onReportQuestion={setReportingQuestion}
              onSaveSession={(mode === 'quiz' || (mode === 'exam' && !simTotalSeconds)) ? (session: ActiveSessionInfo) => {
                saveResumableSession(session).catch(() => { });
              } : undefined}
              timedSeconds={simTotalSeconds ?? undefined}
              onSimulationComplete={(details, usedSecs) => {
                if (simTotalSeconds == null) {
                  console.error('Simülasyon süresi alınamadı');
                  return;
                }
                const total = simTotalSeconds;
                setSimTotalSeconds(null);
                setSimResult({ details: details as SimAnswerDetail[], totalSeconds: total, usedSeconds: usedSecs });
                setAppState('simulation-result');
              }}
              onExportPDF={handleExportPDF}
              theme={theme}
              settings={settings}
              dailyExamId={isDailyExamSession ? activeDailyExamId : undefined}
            />
          ) : appState === 'result' ? (
            <ResultView stats={quizStats} onRestart={handleReturnToHome} onRetryIncorrect={handleRetryIncorrect} onExportPDF={handleExportPDF} theme={theme} />
          ) : appState === 'daily-plan' ? (
            <DailyPlanView
              questions={questions}
              stats={loadAllStats()}
              dueCount={getDueForReviewIds().length}
              onStartReview={handleDueReviewClick}
              onStartWeakUnit={(lesson, unit) => {
                setSelectedLesson(lesson);
                setSelectedUnit(unit);
                setUnitQuestions(buildUnitQueue(questions, lesson, unit, loadAllStats()));
                setMode('quiz');
                setAppState('quiz');
              }}
              onStartSmartStudy={() => {
                const queue = buildSmartQueue(questions, loadAllStats(), { limit: 40 });
                setExamQuestions(queue.questions);
                setMode('exam');
                setAppState('smart-study');
              }}
              theme={theme}
            />
          ) : appState === 'smart-study' ? (
            <QuizView
              mode="exam"
              unit="Akıllı Çalışma"
              questions={examQuestions}
              onComplete={handleComplete}
              onDeleteQuestion={handleDeleteQuestion}
              onFinishEarly={handleComplete}
              onToggleFavorite={handleToggleFavorite}
              onEditQuestion={setEditingQuestion}
              onReportQuestion={setReportingQuestion}
              onExportPDF={handleExportPDF}
              theme={theme}
              settings={settings}
            />
          ) : null}
        </div>
      </main>

      {editingQuestion && <EditModal question={editingQuestion} onSave={handleSaveEdit} onClose={() => setEditingQuestion(null)} theme={theme} />}
      {reportingQuestion && <ReportModal questionId={reportingQuestion.id} onSave={handleSaveReport} onClose={() => setReportingQuestion(null)} theme={theme} />}
      {showSettings && <SettingsModal settings={settings} setSettings={setSettings} onClose={() => setShowSettings(false)} theme={theme} onExport={handleExport} onImport={() => { setAppState('import'); setShowSettings(false); }} onSourceBooks={() => { setAppState('source-books'); setShowSettings(false); }} onResetStats={handleResetStats} />}
      {showAuth && <AuthModal user={user} onClose={() => setShowAuth(false)} onSignOut={signOut} theme={theme} />}
      
      {dialog && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm anim-fade-in">
          <div className={`${theme.cardSolid} border ${theme.border} w-full max-w-sm rounded-[1.5rem] shadow-2xl overflow-hidden flex flex-col`}>
            <div className="p-6">
              <h3 className={`text-lg font-bold mb-2 ${theme.text}`}>{dialog.title || 'Uyarı'}</h3>
              <p className={`text-sm ${theme.subtext} leading-relaxed`}>{dialog.message}</p>
              {dialog.type === 'prompt' && (
                <input
                  type="text"
                  autoFocus
                  defaultValue={dialog.defaultValue}
                  className={`mt-4 w-full ${theme.inputBg} border ${theme.border} rounded-xl px-4 py-2.5 text-sm ${theme.text} focus:outline-none focus:border-indigo-500`}
                  onKeyDown={e => {
                    if (e.key === 'Enter') dialog.onConfirm((e.target as HTMLInputElement).value);
                    if (e.key === 'Escape' && dialog.onCancel) dialog.onCancel();
                  }}
                  id="dialog-prompt-input"
                />
              )}
            </div>
            <div className={`p-2 bg-black/10 border-t ${theme.border} flex gap-2 justify-end`}>
              {dialog.type !== 'alert' && (
                <button
                  onClick={dialog.onCancel}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors hover:${theme.inputBg} ${theme.text}`}
                >
                  İptal
                </button>
              )}
              <button
                onClick={() => {
                  const val = dialog.type === 'prompt' ? (document.getElementById('dialog-prompt-input') as HTMLInputElement).value : undefined;
                  dialog.onConfirm(val);
                }}
                className="px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-semibold shadow-md transition-colors"
              >
                {dialog.type === 'alert' ? 'Tamam' : 'Onayla'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type DailyExamStatus = 'loading' | 'no-user' | 'not-ready' | { dayNumber: number; questionCount: number; resumeAt?: number };

function LessonSelection({ lessons, questions, onSelect, totalQuestions, onDelete, onRename, onDenemeClick, onFavoritesClick, hasResume, resumeInfo, onResumeClick, onResumeClear, favoritesCount, weakCount, onWeakClick, dueCount, onDueClick, onSimulationClick, onDailyPlanClick, onDailyExamClick, dailyExamStatus, onSmartStudyClick, theme }: { lessons: string[]; questions: Question[]; onSelect: (l: string) => void; totalQuestions: number; onDelete: (l: string, e: React.MouseEvent) => void; onRename: (l: string, e: React.MouseEvent) => void; onDenemeClick: () => void; onFavoritesClick: () => void; hasResume: boolean; resumeInfo: { answeredCount: number; totalCount: number; remaining: number } | null; onResumeClick: () => void; onResumeClear: () => void; favoritesCount: number; weakCount: number; onWeakClick: () => void; dueCount: number; onDueClick: () => void; onSimulationClick: () => void; onDailyPlanClick: () => void; onDailyExamClick: () => void; dailyExamStatus: DailyExamStatus; onSmartStudyClick: () => void; theme: Theme }) {
  return (
    <div className="anim-slide-up w-full">
      <div className="mb-10 pl-2">
        <h2 className="text-4xl sm:text-5xl font-black tracking-tighter mb-2">
          Hoş Geldin<span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-purple-500">.</span>
        </h2>
        <p className={`${theme.subtext} text-sm font-medium tracking-wide`}>
          {totalQuestions === 0 ? 'Henüz soru yok — Ayarlar > Import ile başla.' : `${totalQuestions} soru hazır. Seçim yapın ve odaklanın.`}
        </p>
      </div>

      {hasResume && resumeInfo && (
        <div className={`mb-6 p-4 ${theme.cardGlass} rounded-2xl flex items-center justify-between gap-4 anim-fade-in border-l-2 border-indigo-400`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center text-indigo-400">
              <RotateCcw size={18} className="anim-spin-slow" strokeWidth={2.5} />
            </div>
            <div>
              <h3 className="font-bold text-sm">Yarım Kalan Deneme</h3>
              <p className={`${theme.subtext} text-xs`}>
                {resumeInfo.answeredCount} / {resumeInfo.totalCount} — {resumeInfo.remaining} soru kaldı
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onResumeClear} className="btn btn-ghost btn-sm opacity-50 hover:opacity-100" title="Sil"><Trash2 size={14} /></button>
            <button onClick={onResumeClick} className="btn btn-primary btn-sm">DEVAM ET</button>
          </div>
        </div>
      )}

      {totalQuestions > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4 mb-10 stagger-children bento-grid">
          
          <button onClick={onDailyPlanClick} className={`stagger-item col-span-2 md:col-span-2 lg:col-span-3 row-span-2 ${theme.cardGlass} rounded-[2rem] p-6 sm:p-8 text-left card-hover group border border-orange-500/10 hover:border-orange-500/30 overflow-hidden relative`}>
            <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-orange-500/20 blur-3xl rounded-full"></div>
            <div className="w-12 h-12 rounded-2xl bg-orange-500/10 flex items-center justify-center mb-6 lg:mb-10 group-hover:scale-110 transition-transform">
              <Calendar size={24} className="text-orange-400" />
            </div>
            <div className="text-sm font-bold opacity-60 mb-1 uppercase tracking-wider">Bugün</div>
            <div className="text-3xl sm:text-4xl font-black text-orange-400 mb-1 tracking-tight">Günlük Plan</div>
            <div className={`${theme.subtext} text-xs mt-1`}>FSRS programınız ve zayıf konular</div>
          </button>

          <button onClick={onDenemeClick} className={`stagger-item col-span-2 md:col-span-2 lg:col-span-3 row-span-2 ${theme.cardGlass} rounded-[2rem] p-6 sm:p-8 text-left card-hover group border border-rose-500/10 hover:border-rose-500/30 overflow-hidden relative`}>
            <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-rose-500/20 blur-3xl rounded-full"></div>
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 flex items-center justify-center mb-6 lg:mb-10 group-hover:scale-110 transition-transform">
              <Target size={24} className="text-rose-400" />
            </div>
            <div className="text-sm font-bold opacity-60 mb-1 uppercase tracking-wider">Odaklan</div>
            <div className="text-3xl sm:text-4xl font-black text-rose-400 mb-1 tracking-tight">Deneme Modu</div>
            <div className={`${theme.subtext} text-xs mt-1`}>Karışık sorular ile kendini sına</div>
          </button>

          <button
            onClick={typeof dailyExamStatus === 'object' ? onDailyExamClick : undefined}
            disabled={dailyExamStatus === 'loading' || dailyExamStatus === 'no-user' || dailyExamStatus === 'not-ready'}
            className={`stagger-item col-span-2 md:col-span-2 lg:col-span-3 row-span-2 ${theme.cardGlass} rounded-[2rem] p-6 sm:p-8 text-left group border overflow-hidden relative transition-all
              ${typeof dailyExamStatus === 'object' ? 'card-hover border-cyan-500/20 hover:border-cyan-500/40 cursor-pointer' : 'border-cyan-500/10 opacity-70 cursor-default'}`}
          >
            <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-cyan-500/20 blur-3xl rounded-full"></div>
            <div className={`w-12 h-12 rounded-2xl bg-cyan-500/10 flex items-center justify-center mb-6 lg:mb-10 transition-transform ${typeof dailyExamStatus === 'object' ? 'group-hover:scale-110' : ''}`}>
              {dailyExamStatus === 'loading'
                ? <Loader2 size={24} className="text-cyan-400 animate-spin" />
                : <BookOpen size={24} className="text-cyan-400" />
              }
            </div>
            <div className="text-sm font-bold opacity-60 mb-1 uppercase tracking-wider">Bugünün Konusu</div>
            {dailyExamStatus === 'loading' && (
              <>
                <div className="text-3xl sm:text-4xl font-black text-cyan-400 mb-1 tracking-tight">Günün Denemesi</div>
                <div className={`${theme.subtext} text-xs mt-1`}>Yükleniyor…</div>
              </>
            )}
            {dailyExamStatus === 'no-user' && (
              <>
                <div className="text-3xl sm:text-4xl font-black text-cyan-400 mb-1 tracking-tight">Günün Denemesi</div>
                <div className={`${theme.subtext} text-xs mt-1`}>Kullanmak için giriş yapın</div>
              </>
            )}
            {dailyExamStatus === 'not-ready' && (
              <>
                <div className="text-3xl sm:text-4xl font-black text-cyan-400 mb-1 tracking-tight">Günün Denemesi</div>
                <div className={`${theme.subtext} text-xs mt-1`}>Henüz hazırlanmadı — Atlas'a konularını söyle</div>
              </>
            )}
            {typeof dailyExamStatus === 'object' && (
              <>
                <div className="text-lg font-black text-cyan-300 mb-0.5">{dailyExamStatus.dayNumber}. Günün Denemesi</div>
                {dailyExamStatus.resumeAt !== undefined ? (
                  <>
                    <div className="text-3xl sm:text-4xl font-black text-cyan-400 mb-1 tracking-tight">
                      {dailyExamStatus.resumeAt} / {dailyExamStatus.questionCount}
                    </div>
                    <div className={`${theme.subtext} text-xs mt-1`}>
                      {dailyExamStatus.questionCount - dailyExamStatus.resumeAt} soru kaldı · Devam et
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-3xl sm:text-4xl font-black text-cyan-400 mb-1 tracking-tight">{dailyExamStatus.questionCount} Soru</div>
                    <div className={`${theme.subtext} text-xs mt-1`}>Hazır · Başlatmak için tıkla</div>
                  </>
                )}
              </>
            )}
          </button>

          {dueCount > 0 && (
            <button onClick={onDueClick} className={`stagger-item col-span-1 md:col-span-2 lg:col-span-2 ${theme.cardGlass} rounded-[1.5rem] p-5 text-left card-hover group border border-violet-500/10 hover:border-violet-500/30 transition-all`}>
              <div className="flex justify-between items-center mb-3">
                <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <RotateCcw size={20} className="text-violet-400" />
                </div>
                <span className="text-2xl font-black text-violet-400">{dueCount}</span>
              </div>
              <div className="text-sm font-bold mb-0.5">Bugün Tekrar</div>
              <div className={`${theme.subtext} text-[10px]`}>FSRS algoritması</div>
            </button>
          )}

          {weakCount > 0 && (
            <button onClick={onWeakClick} className={`stagger-item col-span-1 md:col-span-2 lg:col-span-2 ${theme.cardGlass} rounded-[1.5rem] p-5 text-left card-hover group border border-red-500/10 hover:border-red-500/30 transition-all`}>
              <div className="flex justify-between items-center mb-3">
                <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <AlertTriangle size={20} className="text-red-400" />
                </div>
                <span className="text-2xl font-black text-red-400">{weakCount}</span>
              </div>
              <div className="text-sm font-bold mb-0.5">Zayıf Halka</div>
              <div className={`${theme.subtext} text-[10px]`}>%50 altı başarı oranı</div>
            </button>
          )}

          <button onClick={onSmartStudyClick} className={`stagger-item col-span-1 md:col-span-2 lg:col-span-2 ${theme.cardGlass} rounded-[1.5rem] p-5 text-left card-hover group border border-emerald-500/10 hover:border-emerald-500/30 transition-all`}>
             <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
               <Brain size={20} className="text-emerald-400" />
             </div>
             <div className="text-sm font-bold mb-0.5">Akıllı Çalışma</div>
             <div className={`${theme.subtext} text-[10px]`}>Motor destekli seçim</div>
          </button>

          <button onClick={onSimulationClick} className={`stagger-item col-span-1 md:col-span-2 lg:col-span-2 ${theme.cardGlass} rounded-[1.5rem] p-5 text-left card-hover group border border-sky-500/10 hover:border-sky-500/30 transition-all`}>
            <div className="flex justify-between items-center mb-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                <ClipboardList size={20} className="text-sky-400" />
              </div>
            </div>
            <div className="text-sm font-bold mb-0.5">DUS Simülasyon</div>
            <div className={`${theme.subtext} text-[10px]`}>Optik form ile deneme</div>
          </button>

          <button onClick={onFavoritesClick} className={`stagger-item col-span-1 md:col-span-2 lg:col-span-2 ${theme.cardGlass} rounded-[1.5rem] p-5 text-left card-hover group border border-amber-500/10 hover:border-amber-500/30 transition-all`}>
            <div className="flex justify-between items-center mb-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Star size={20} className="text-amber-400" />
              </div>
              <span className="text-2xl font-black text-amber-400">{favoritesCount}</span>
            </div>
            <div className="text-sm font-bold mb-0.5">Favoriler</div>
            <div className={`${theme.subtext} text-[10px]`}>Yıldızlanan sorular</div>
          </button>

          <button
            onClick={() => {
              const el = document.querySelector('button[title="İstatistikler"]');
              if (el) (el as HTMLElement).click();
            }}
            className={`stagger-item col-span-2 md:col-span-2 lg:col-span-2 ${theme.cardGlass} rounded-[1.5rem] p-5 text-left card-hover group border border-indigo-500/10 hover:border-indigo-500/30 transition-all`}
          >
            <div className="flex justify-between items-center mb-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                <BarChart3 size={20} className="text-indigo-400" />
              </div>
            </div>
            <div className="text-sm font-bold mb-0.5">İstatistikler</div>
            <div className={`${theme.subtext} text-[10px]`}>Gelişim analizi</div>
          </button>
        </div>
      )}

      {lessons.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-5 text-center">
          <div className={`w-16 h-16 rounded-2xl ${theme.cardGlass} flex items-center justify-center`}>
            <Upload size={24} className={theme.subtext} />
          </div>
          <div>
            <p className="font-bold text-sm mb-1">Henüz soru yüklenmedi</p>
            <p className={`${theme.subtext} text-xs`}>Ayarlar → Import ile başlayın</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-4">
            <h3 className="text-xs font-bold uppercase tracking-widest opacity-30">Dersler</h3>
            <div className={`flex-1 h-px ${theme.divider} border-t`} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
            {lessons.map((lesson) => {
              const l_qs = questions.filter(q => q.lesson === lesson);
              const { total, solved } = getUnitProgress(l_qs.map(q => q.id));
              const pct = total > 0 ? Math.round((solved / total) * 100) : 0;
              
              const isRad = lesson.toLowerCase().includes('radyoloji');
              const isPat = lesson.toLowerCase().includes('patoloji');
              const isPro = lesson.toLowerCase().includes('protez');
              const isHis = lesson.toLowerCase().includes('histoloji');
              const isFiz = lesson.toLowerCase().includes('fizyoloji');
              const isPer = lesson.toLowerCase().includes('periodontoloji');
              const isEnd = lesson.toLowerCase().includes('endodonti');
              const IconComp = isRad ? Zap : isPat ? Skull : isPro ? Layers : isHis ? Microscope : isFiz ? HeartPulse : isPer ? Brush : isEnd ? Syringe : LayoutGrid;

              return (
                <div key={lesson} onClick={() => onSelect(lesson)} className={`stagger-item cursor-pointer group relative flex flex-col items-start p-6 ${theme.cardSolid} ${theme.cardHover} rounded-[1.5rem] transition-all overflow-hidden text-left border border-transparent hover:border-indigo-500/30`}>
                  <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="flex justify-between items-start w-full relative z-10">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                      <IconComp size={20} className="text-indigo-400" />
                    </div>
                    <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all translate-y-1 group-hover:translate-y-0">
                      <div onClick={(e) => onRename(lesson, e)} className="p-2 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition-colors backdrop-blur-md shadow-sm bg-black/20"><Pencil size={14} /></div>
                      <div onClick={(e) => onDelete(lesson, e)} className="p-2 rounded-xl hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-colors backdrop-blur-md shadow-sm bg-black/20"><Trash2 size={14} /></div>
                    </div>
                  </div>
                  <h3 className="text-lg font-black tracking-tight mb-3 max-w-full truncate pr-2 relative z-10">{lesson}</h3>
                  <div className="w-full mt-auto relative z-10 space-y-1.5">
                    <div className="flex justify-between items-end">
                      <span className={`${theme.subtext} text-[10px] font-bold tracking-widest uppercase`}>Çözülmüş / Toplam</span>
                      <span className="text-xs font-bold font-mono">{solved} / {total}</span>
                    </div>
                    <div className="w-full h-1.5 bg-black/20 rounded-full overflow-hidden border border-white/5">
                      <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${Math.max(1, pct)}%`, backgroundColor: `hsl(${pct * 1.2}, 90%, 50%)` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function UnitSelection({ lesson, units, questions, onSelect, onDelete, onRename, onExportPDF, theme }: { lesson: string; units: string[]; questions: Question[]; onSelect: (u: string) => void; onDelete: (u: string, e: React.MouseEvent) => void; onRename: (u: string, e: React.MouseEvent) => void; onExportPDF: (selection: any[], title: string) => void; theme: Theme }) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'progress' | 'count'>('name');

  const unitData = units.map(unit => {
    const unitQs = questions.filter(q => q.lesson === lesson && q.unit === unit);
    const progress = getUnitProgress(unitQs.map(q => q.id));
    const pct = progress.total > 0 ? Math.round((progress.solved / progress.total) * 100) : 0;
    const acc = progress.solved > 0 ? progress.correct / progress.solved : 0;
    const barColor = acc >= 0.7 ? 'bg-emerald-400' : acc >= 0.3 ? 'bg-amber-400' : pct > 0 ? 'bg-red-400' : 'bg-white/10';
    return { unit, unitQs, progress, pct, barColor };
  });

  const filtered = unitData
    .filter(d => d.unit.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'name') return a.unit.localeCompare(b.unit, 'tr');
      if (sortBy === 'progress') return b.pct - a.pct;
      if (sortBy === 'count') return b.unitQs.length - a.unitQs.length;
      return 0;
    });

  return (
    <div className="anim-slide-up max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center">
            <BookOpen size={18} className="text-indigo-400" />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight max-w-md truncate">{lesson}</h2>
            <p className={`${theme.subtext} text-xs font-medium`}>{units.length} ünite</p>
          </div>
        </div>
        <button onClick={() => onExportPDF(questions.filter(q => q.lesson === lesson), `${lesson} Soruları`)} className="btn btn-ghost btn-sm">
          <FileText size={14} /> PDF
        </button>
      </div>

      <div className="flex items-center gap-2.5 mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Ünite ara..."
          className={`flex-1 ${theme.inputBg} border ${theme.border} rounded-xl px-4 py-2.5 text-sm input-ring placeholder:opacity-30 transition-all`}
        />
        <div className="flex gap-1 shrink-0">
          {(['name', 'progress', 'count'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`badge transition-all cursor-pointer ${sortBy === s ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/20' : `${theme.inputBg} ${theme.subtext} border border-transparent hover:border-white/10`}`}
            >
              {s === 'name' ? 'İSİM' : s === 'progress' ? 'İLERLEME' : 'SORU'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 stagger-children">
        {filtered.length === 0 && (
          <p className={`${theme.subtext} text-sm text-center py-8`}>"{search}" için sonuç bulunamadı.</p>
        )}
        {filtered.map(({ unit, unitQs, pct, barColor }) => (
          <div key={unit} onClick={() => onSelect(unit)} className={`stagger-item cursor-pointer w-full flex items-center justify-between p-4 ${theme.card} ${theme.cardHover} rounded-2xl transition-all text-left group card-hover`}>
            <div className="overflow-hidden pr-4 flex-1">
              <span className="text-sm font-bold group-hover:translate-x-0.5 transition-transform block truncate">{unit}</span>
              <div className="flex items-center gap-3 mt-1.5 w-full">
                <span className={`${theme.subtext} text-[10px] font-bold shrink-0`}>{unitQs.length} soru</span>
                <div className="flex-1 h-1 bg-white/[0.04] rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-1000 ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
                {pct > 0 && <span className={`${theme.subtext} text-[10px] font-bold shrink-0`}>%{pct}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <div onClick={(e) => { e.stopPropagation(); onExportPDF(unitQs, `${lesson} — ${unit}`); }} className="p-1.5 rounded-lg hover:bg-white/10 text-white/30 hover:text-white transition-colors" title="Ünite PDF İndir"><FileText size={13} /></div>
              <div onClick={(e) => onRename(unit, e)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/30 hover:text-white transition-colors"><Pencil size={13} /></div>
              <div onClick={(e) => onDelete(unit, e)} className="p-1.5 rounded-lg hover:bg-red-500/15 text-white/30 hover:text-red-400 transition-colors"><Trash2 size={13} /></div>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/[0.04] group-hover:bg-indigo-500 transition-all shrink-0 ml-1">
                <ChevronRight size={14} className="group-hover:text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DenemeSelection({ questions, onNext, onCancel, isFavoritesMode, theme }: {
  questions: Question[];
  onNext: (units: { lesson: string; unit: string }[]) => void;
  onCancel: () => void;
  isFavoritesMode: boolean;
  theme: Theme;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const grouped = questions.reduce((acc, q) => {
    if (!acc[q.lesson]) acc[q.lesson] = new Set<string>();
    acc[q.lesson].add(q.unit);
    return acc;
  }, {} as Record<string, Set<string>>);

  const filteredLessons = Object.entries(grouped).filter(([lesson, unitsSet]) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return lesson.toLowerCase().includes(s) || Array.from(unitsSet).some(u => u.toLowerCase().includes(s));
  });

  const toggleUnit = (l: string, u: string) => {
    const key = `${l}|-|${u}`;
    setSelected(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  };
  const toggleLesson = (l: string, us: string[]) => {
    setSelected(prev => {
      const n = new Set(prev);
      const all = us.every(u => n.has(`${l}|-|${u}`));
      us.forEach(u => { if (all) n.delete(`${l}|-|${u}`); else n.add(`${l}|-|${u}`); });
      return n;
    });
  };
  const selectAll = () => {
    const all = new Set<string>();
    filteredLessons.forEach(([lesson, unitsSet]) => Array.from(unitsSet).forEach(u => all.add(`${lesson}|-|${u}`)));
    setSelected(all);
  };
  const clearAll = () => setSelected(new Set());

  const totalSelected = Array.from(selected).reduce((sum, key) => {
    const [lesson, unit] = key.split('|-|');
    return sum + questions.filter(q => q.lesson === lesson && q.unit === unit).length;
  }, 0);

  return (
    <div className="anim-slide-up w-full max-w-2xl mx-auto flex flex-col pb-4" style={{ maxHeight: 'calc(100vh - 120px)' }}>
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h2 className="text-xl font-black">{isFavoritesMode ? 'Favoriler — Ünite Seç' : 'Deneme — Ünite Seç'}</h2>
          <p className={`${theme.subtext} text-xs mt-0.5`}>İstediğin ders ve üniteleri seç</p>
        </div>
        <button onClick={onCancel} className="btn btn-ghost btn-sm">İptal</button>
      </div>

      <div className="flex items-center gap-2 mb-3 shrink-0">
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Ders veya ünite ara…"
          className={`flex-1 ${theme.inputBg} border ${theme.border} rounded-xl px-3 py-2 text-sm input-ring placeholder:opacity-30`}
        />
        <button onClick={selectAll} className="btn btn-ghost btn-sm text-emerald-400 border border-emerald-500/20 shrink-0">Tümü</button>
        <button onClick={clearAll} className="btn btn-ghost btn-sm text-red-400 border border-red-500/20 shrink-0">Temizle</button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
        {filteredLessons.length === 0 && (
          <p className={`${theme.subtext} text-sm text-center py-10`}>Sonuç bulunamadı.</p>
        )}
        {filteredLessons.map(([lesson, unitsSet]) => {
          const units = Array.from(unitsSet).sort((a, b) => a.localeCompare(b, 'tr'));
          const allS = units.every(u => selected.has(`${lesson}|-|${u}`));
          const someS = units.some(u => selected.has(`${lesson}|-|${u}`));
          const lessonCount = questions.filter(q => q.lesson === lesson).length;
          return (
            <div key={lesson} className={`${theme.card} rounded-2xl overflow-hidden`}>
              <div className="p-3.5 flex items-center gap-3 cursor-pointer hover:bg-white/[0.03] transition-all" onClick={() => toggleLesson(lesson, units)}>
                <div className={`w-5 h-5 rounded-md flex items-center justify-center border-2 transition-all shrink-0 ${allS ? 'bg-indigo-500 border-indigo-500' : someS ? 'bg-indigo-500/50 border-indigo-500/50' : theme.border}`}>
                  {(allS || someS) && <CheckCircle2 size={13} />}
                </div>
                <span className="font-bold text-sm flex-1 truncate">{lesson}</span>
                <span className={`${theme.subtext} text-[10px] shrink-0`}>{lessonCount} soru</span>
              </div>
              <div className={`border-t ${theme.divider} bg-black/10 px-1.5 pb-1.5`}>
                {units.map(unit => {
                  const s = selected.has(`${lesson}|-|${unit}`);
                  const unitCount = questions.filter(q => q.lesson === lesson && q.unit === unit).length;
                  return (
                    <div key={unit} onClick={() => toggleUnit(lesson, unit)}
                      className={`p-2.5 pl-9 flex items-center gap-3 cursor-pointer hover:bg-white/[0.03] rounded-xl transition-all ${s ? 'bg-emerald-500/5' : ''}`}>
                      <div className={`w-4 h-4 rounded flex items-center justify-center border-2 transition-all shrink-0 ${s ? 'bg-emerald-500 border-emerald-500' : theme.border}`}>
                        {s && <CheckCircle2 size={11} className="text-black" strokeWidth={3} />}
                      </div>
                      <span className={`text-xs flex-1 truncate ${s ? 'font-medium' : theme.subtext}`}>{unit}</span>
                      <span className={`${theme.subtext} text-[10px] shrink-0`}>{unitCount}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 mt-4">
        {selected.size > 0 && (
          <p className={`${theme.subtext} text-xs text-center mb-2`}>{selected.size} ünite · {totalSelected} soru seçildi</p>
        )}
        <button
          onClick={() => onNext(Array.from(selected).map(k => ({ lesson: k.split('|-|')[0], unit: k.split('|-|')[1] })))}
          disabled={selected.size === 0}
          className="btn btn-primary btn-lg w-full"
        >
          Soru Sayısına Geç ({selected.size} ünite) <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}


function SimulationSetup({ questions, onStart, onCancel, theme }: {
  questions: Question[];
  onStart: (questions: Question[], totalSeconds: number) => void;
  onCancel: () => void;
  theme: Theme;
}) {
  const [questionCount, setQuestionCount] = useState(Math.min(200, questions.length));
  const [minutes, setMinutes] = useState(150);
  const totalSeconds = minutes * 60;
  const perQuestion = questions.length > 0 ? Math.round(totalSeconds / questionCount) : 0;

  const handleStart = () => {
    const stats = loadAllStats();
    const pool = buildSimulationPool(questions, stats, questionCount);
    onStart(pool, totalSeconds);
  };

  return (
    <div className="anim-scale-in flex-1 flex flex-col items-center justify-center">
      <div className={`${theme.card} w-full max-w-lg p-8 sm:p-10 rounded-2xl ${theme.shadow} relative overflow-hidden`}>
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-rose-500 via-amber-400 to-rose-500 opacity-60" />
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-rose-500/15 flex items-center justify-center">
            <Target size={20} className="text-rose-400" />
          </div>
          <div>
            <h2 className="text-2xl font-black tracking-tight">DUS Simülasyon</h2>
            <p className={`${theme.subtext} text-xs`}>Gerçek sınav koşullarında antrenman</p>
          </div>
        </div>

        <div className="space-y-8 mb-8">
          <div>
            <div className={`${theme.subtext} text-[10px] font-bold uppercase tracking-widest mb-3 text-center`}>SORU SAYISI</div>
            <input 
              type="number"
              min="10"
              max={questions.length}
              value={questionCount || ''}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0;
                setQuestionCount(Math.min(val, questions.length));
              }}
              onBlur={() => setQuestionCount(c => Math.max(10, c))}
              className="w-full bg-transparent text-5xl font-black mb-4 text-center focus:outline-none focus:text-rose-400 transition-colors"
            />
            <input type="range" min="10" max={Math.min(200, questions.length)} value={questionCount}
              onChange={e => setQuestionCount(Number(e.target.value))} />
            <div className={`flex justify-between text-[10px] font-medium ${theme.subtext} mt-2`}>
              <span>10</span><span>{Math.min(200, questions.length)}</span>
            </div>
          </div>

          <div>
            <div className={`${theme.subtext} text-[10px] font-bold uppercase tracking-widest mb-3`}>SÜRE (DAKİKA)</div>
            <div className="text-4xl font-black mb-4 text-center">{minutes}</div>
            <input type="range" min="30" max="180" step="5" value={minutes}
              onChange={e => setMinutes(Number(e.target.value))} />
            <div className={`flex justify-between text-[10px] font-medium ${theme.subtext} mt-2`}>
              <span>30dk</span><span>180dk (DUS)</span>
            </div>
          </div>

          <div className={`${theme.cardGlass} rounded-xl p-4 text-center`}>
            <div className="text-xl font-black">{perQuestion}s/soru</div>
            <div className={`${theme.subtext} text-[10px] mt-1`}>Soru başına ortalama süre · DUS hedef: &lt;45s</div>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={onCancel} className="btn btn-secondary btn-lg flex-1">Geri</button>
          <button onClick={handleStart} className="btn btn-primary btn-lg flex-[2]">BAŞLAT</button>
        </div>
      </div>
    </div>
  );
}

function DenemeAmountSelection({ selectedUnits, questions, loading, onStart, onCancel, theme }: {
  selectedUnits: { lesson: string; unit: string }[];
  questions: Question[];
  loading: boolean;
  onStart: (a: number) => void;
  onCancel: () => void;
  theme: Theme;
}) {
  const max = questions.filter(q => selectedUnits.some(su => su.lesson === q.lesson && su.unit === q.unit)).length;
  const [amount, setAmount] = useState(Math.min(20, max));
  useEffect(() => setAmount(prev => Math.min(prev, max)), [max]);

  const perUnit = selectedUnits.length > 0 ? Math.floor(amount / selectedUnits.length) : 0;

  return (
    <div className="anim-scale-in flex-1 flex flex-col items-center justify-center">
      <div className={`${theme.card} w-full max-w-lg p-8 sm:p-10 rounded-2xl ${theme.shadow} relative overflow-hidden`}>
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-indigo-500 to-emerald-400 opacity-60" />
        <h2 className="text-2xl font-black mb-2 tracking-tight text-center">Soru Sayısı</h2>
        <p className={`${theme.subtext} text-xs text-center mb-8`}>{selectedUnits.length} ünite · {max} soru havuzu</p>
        <div className="mb-8 text-center">
          <input 
            type="number"
            min="1"
            max={max}
            value={amount || ''}
            onChange={(e) => {
              const val = parseInt(e.target.value) || 0;
              setAmount(Math.min(val, max));
            }}
            onBlur={() => setAmount(a => Math.max(1, a))}
            className="w-full bg-transparent text-6xl font-black mb-6 text-center focus:outline-none focus:text-indigo-400 transition-colors"
          />
          <input type="range" min="1" max={max} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          <div className={`flex justify-between text-xs font-medium ${theme.subtext} mt-3`}><span>1</span><span>{max}</span></div>
          {selectedUnits.length > 1 && (
            <p className={`${theme.subtext} text-[10px] mt-3`}>Ünite başına ≈ {perUnit} soru (random dağılım)</p>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="btn btn-secondary btn-lg flex-1">Geri</button>
          <button onClick={() => onStart(amount)} disabled={loading || max === 0} className="btn btn-primary btn-lg flex-[2]">
            {loading ? <><Loader2 size={16} className="animate-spin" /> Yükleniyor…</> : 'BAŞLAT'}</button>
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════
   RESULT VIEW & ANALYTICS DASHBOARD
   ═══════════════════════════════════════════════════════════ */
function AnalyticsDashboard({ questions, theme }: { questions: Question[]; theme: Theme }) {
  const stats = loadStreak();
  const activity = getRecentActivity(14);
  const maxActivity = Math.max(...activity.map(a => a.count), 1);

  // Kapsama için questions kullan
  const allUnitStats = Array.from(new Set(questions.map(q => q.lesson))).map(lesson => {
    const lessonQs = questions.filter(q => q.lesson === lesson);
    const lessonProgress = getUnitProgress(lessonQs.map(q => q.id));
    return { lesson, ...lessonProgress };
  }).sort((a, b) => (b.totalCorrects / Math.max(1, b.totalAttempts)) - (a.totalCorrects / Math.max(1, a.totalAttempts)));

  const totalPossible = questions.length;
  const totalSolved = allUnitStats.reduce((a, b) => a + b.solved, 0);
  const totalAttempts = allUnitStats.reduce((a, b) => a + b.totalAttempts, 0);
  const totalCorrects = allUnitStats.reduce((a, b) => a + b.totalCorrects, 0);
  const avgAccuracy = Math.round((totalCorrects / Math.max(1, totalAttempts)) * 100);
  const overallCoverage = Math.round((totalSolved / Math.max(1, totalPossible)) * 100);

  return (
    <div className="flex flex-col gap-5 anim-slide-up pb-10">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger-children">
        <div className={`stagger-item ${theme.card} p-5 rounded-2xl border-l-2 border-amber-400/40`}>
          <div className="flex items-center justify-between mb-3">
            <span className={`${theme.subtext} text-[10px] font-bold uppercase tracking-widest`}>SERİ</span>
            <Zap size={16} className="text-amber-400" fill="currentColor" />
          </div>
          <div className="text-3xl font-black">{stats.currentStreak} <span className="text-sm font-bold opacity-50">GÜN</span></div>
          <div className={`${theme.subtext} text-[10px] mt-1`}>En yüksek: {stats.longestStreak} gün</div>
        </div>
        <div className={`stagger-item ${theme.card} p-5 rounded-2xl border-l-2 border-indigo-400/40`}>
          <div className="flex items-center justify-between mb-3">
            <span className={`${theme.subtext} text-[10px] font-bold uppercase tracking-widest`}>DOĞRULUK</span>
            <CheckCheck size={16} className="text-indigo-400" />
          </div>
          <div className="text-3xl font-black">%{avgAccuracy}</div>
          <div className={`${theme.subtext} text-[10px] mt-1`}>{totalSolved} cevaplanan</div>
        </div>
        <div className={`stagger-item ${theme.card} p-5 rounded-2xl border-l-2 border-emerald-400/40`}>
          <div className="flex items-center justify-between mb-3">
            <span className={`${theme.subtext} text-[10px] font-bold uppercase tracking-widest`}>KAPSAMA</span>
            <BarChart3 size={16} className="text-emerald-400" />
          </div>
          <div className="text-3xl font-black">%{overallCoverage}</div>
          <div className={`${theme.subtext} text-[10px] mt-1`}>{totalSolved} / {totalPossible}</div>
        </div>
        <div className={`stagger-item ${theme.card} p-5 rounded-2xl border-l-2 border-violet-400/40`}>
          <div className="flex items-center justify-between mb-3">
            <span className={`${theme.subtext} text-[10px] font-bold uppercase tracking-widest`}>FSRS KUYRUK</span>
            <RotateCcw size={16} className="text-violet-400" />
          </div>
          <div className="text-3xl font-black">{getDueForReviewIds().length}</div>
          <div className={`${theme.subtext} text-[10px] mt-1`}>Bugün tekrar</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className={`${theme.card} p-6 rounded-2xl`}>
          <h3 className="text-sm font-bold mb-6">Son 14 Günlük Aktivite</h3>
          <div className="flex items-end justify-between h-36 gap-1 px-1">
            {activity.map((a, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1.5 group">
                <div className="relative w-full bg-indigo-500/[0.05] rounded-t-md transition-all hover:bg-indigo-500/15" style={{ height: `${(a.count / maxActivity) * 100}%`, minHeight: '3px' }}>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white text-black text-[9px] font-bold px-2 py-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-lg">{a.count}</div>
                </div>
                <div className={`${theme.subtext} text-[7px] font-medium`}>{a.date.split('-').slice(1).reverse().join('/')}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={`${theme.card} p-6 rounded-2xl overflow-hidden`}>
          <h3 className="text-sm font-bold mb-5">Ders Başarı Sıralaması</h3>
          <div className="space-y-3.5 max-h-[360px] overflow-y-auto pr-2 custom-scrollbar">
            {allUnitStats.map((s, i) => {
              const acc = Math.round((s.totalCorrects / Math.max(1, s.totalAttempts)) * 100);
              const color = acc >= 70 ? 'bg-emerald-400' : acc >= 40 ? 'bg-amber-400' : 'bg-red-400';
              return (
                <div key={i} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-bold"><span className="truncate pr-2">{s.lesson}</span><span className={theme.subtext}>%{acc}</span></div>
                  <div className="h-1.5 bg-white/[0.04] rounded-full overflow-hidden"><div className={`h-full rounded-full ${color} transition-all duration-1000`} style={{ width: `${acc}%` }} /></div>
                  <div className={`${theme.subtext} text-[10px]`}>{s.solved}/{s.total} çözüldü · {s.totalCorrects}/{s.totalAttempts} doğru</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Faz 2: Ünite Granülaritesinde Heat Map — Rapor §2.4 Katman 1 */}
      <UnitHeatMap questions={questions} theme={theme} />

      {/* Faz 4: 7-Günlük FSRS Review Yükü Projeksiyonu — Rapor §2.4 Katman 3 */}
      <ReviewForecastChart theme={theme} />
    </div>
  );
}

/**
 * 7-Günlük FSRS Review Yükü Projeksiyonu — Rapor §2.4 Katman 3
 */
function ReviewForecastChart({ theme }: { theme: Theme }) {
  const stats = loadAllStats();
  const forecast = getForecastNextDays(stats, 7);
  const maxCount = Math.max(...forecast.map(f => f.count), 1);
  const totalWeek = forecast.reduce((a, b) => a + b.count, 0);
  const peakDay = forecast.reduce((best, f) => f.count > best.count ? f : best, forecast[0]);

  return (
    <div className={`${theme.card} p-6 rounded-2xl`}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-sm font-bold">Bu Hafta FSRS Review Yükü</h3>
          <p className={`${theme.subtext} text-[11px] mt-0.5`}>
            Toplam {totalWeek} kart · Zirve: {peakDay.label} ({peakDay.count})
          </p>
        </div>
        <div className={`${theme.cardGlass} px-3 py-1.5 rounded-xl text-center`}>
          <div className="text-lg font-black text-violet-400">{totalWeek}</div>
          <div className={`${theme.subtext} text-[8px] font-bold uppercase`}>BU HAFTA</div>
        </div>
      </div>

      <div className="flex items-end gap-2.5 h-28">
        {forecast.map((f, i) => {
          const pct = (f.count / maxCount) * 100;
          const isHeavy = f.count > totalWeek / 7 * 1.5;
          const barColor = f.isToday ? 'bg-indigo-400' : isHeavy ? 'bg-red-400' : 'bg-violet-400/50';
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5 group">
              <div className="relative w-full flex flex-col items-center justify-end" style={{ height: '80px' }}>
                {f.count > 0 && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] font-bold opacity-50 group-hover:opacity-100 transition-opacity">{f.count}</div>
                )}
                <div className={`w-full rounded-md transition-all duration-700 hover:opacity-80 ${barColor}`}
                  style={{ height: `${Math.max(pct, f.count > 0 ? 10 : 4)}%`, minHeight: f.count > 0 ? '6px' : '2px' }} />
              </div>
              <span className={`text-[8px] font-medium ${f.isToday ? 'text-indigo-400' : theme.subtext}`}>{f.label}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm bg-indigo-400" /><span className={`${theme.subtext} text-[10px]`}>Bugün</span></div>
        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm bg-red-400" /><span className={`${theme.subtext} text-[10px]`}>Yoğun</span></div>
        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm bg-violet-400/50" /><span className={`${theme.subtext} text-[10px]`}>Normal</span></div>
      </div>

      {totalWeek === 0 && (
        <p className={`${theme.subtext} text-xs mt-4 text-center`}>
          Henüz FSRS kuyruğunda bekleyen kart yok.
        </p>
      )}
    </div>
  );
}

/**
 * Ünite Heat Map
 */
function UnitHeatMap({ questions, theme }: { questions: Question[]; theme: Theme }) {
  const stats = loadAllStats();
  const lessonMap = new Map<string, Map<string, { attempts: number; corrects: number; total: number; solved: number }>>();
  for (const q of questions) {
    if (!lessonMap.has(q.lesson)) lessonMap.set(q.lesson, new Map());
    const units = lessonMap.get(q.lesson)!;
    if (!units.has(q.unit)) units.set(q.unit, { attempts: 0, corrects: 0, total: 0, solved: 0 });
    const u = units.get(q.unit)!;
    u.total++;
    const s = stats[q.id];
    if (s && s.attempts > 0) { u.solved++; u.attempts += s.attempts; u.corrects += s.corrects; }
  }

  const lessons = Array.from(lessonMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  const cellColor = (attempts: number, corrects: number): string => {
    if (attempts === 0) return `${theme.inputBg} ${theme.subtext}`;
    const acc = (corrects / attempts) * 100;
    if (acc >= 75) return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
    if (acc >= 50) return 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
    return 'bg-red-500/10 text-red-400 border border-red-500/20';
  };

  return (
    <div className={`${theme.card} p-6 rounded-2xl`}>
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-bold">Ünite Isı Haritası</h3>
        <div className="flex items-center gap-2.5 text-[10px] font-medium">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500/30 border border-red-500/40" />&lt;%50</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500/30 border border-amber-500/40" />%50-75</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/30 border border-emerald-500/40" />&gt;%75</span>
          <span className={`flex items-center gap-1 ${theme.subtext}`}><span className="w-2.5 h-2.5 rounded-sm bg-white/[0.06]" />Yok</span>
        </div>
      </div>
      <div className="space-y-5 max-h-[480px] overflow-y-auto pr-2 custom-scrollbar">
        {lessons.map(([lesson, units]) => {
          const unitArr = Array.from(units.entries()).sort((a, b) => {
            const accA = a[1].attempts > 0 ? a[1].corrects / a[1].attempts : 1;
            const accB = b[1].attempts > 0 ? b[1].corrects / b[1].attempts : 1;
            return accA - accB;
          });
          return (
            <div key={lesson}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold">{lesson}</span>
                <span className={`${theme.subtext} text-[10px]`}>{unitArr.length} ünite</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1.5">
                {unitArr.map(([unit, u]) => {
                  const acc = u.attempts > 0 ? Math.round((u.corrects / u.attempts) * 100) : null;
                  const title = acc !== null
                    ? `${unit}\n%${acc} doğruluk • ${u.solved}/${u.total} çözüldü • ${u.corrects}/${u.attempts} doğru`
                    : `${unit}\nHenüz çözülmemiş (${u.total} soru)`;
                  return (
                    <div key={unit} title={title}
                      className={`${cellColor(u.attempts, u.corrects)} rounded-xl px-2.5 py-2 text-[10px] font-bold transition-all hover:scale-[1.02] cursor-default`}>
                      <div className="truncate">{unit}</div>
                      <div className="flex items-center justify-between mt-0.5 opacity-70">
                        <span className="text-[9px]">{acc !== null ? `%${acc}` : '—'}</span>
                        <span className="text-[9px]">{u.solved}/{u.total}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResultView({ stats, onRestart, onRetryIncorrect, onExportPDF, theme }: { stats: QuizStatsType; onRestart: () => void; onRetryIncorrect: (d: AnswerDetail[]) => void; onExportPDF: (questions: Question[], title: string) => void; theme: Theme }) {
  const incorrect = stats.details.filter(d => d.state === 'incorrect');
  const avgTime = Math.round(stats.details.reduce((a, b) => a + (b.timeSpent || 0), 0) / Math.max(1, stats.total));
  return (
    <div className="flex-1 flex flex-col items-center justify-center anim-scale-in max-w-2xl mx-auto w-full">
      <div className={`${theme.card} w-full p-8 rounded-2xl ${theme.shadow} relative`}>
        <h2 className="text-2xl font-black mb-6 text-center">Sınav Analiz Panosu</h2>
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className={`p-4 ${theme.cardGlass} rounded-xl text-center`}>
            <div className="text-2xl font-black text-emerald-400">{stats.correct}</div>
            <div className={`${theme.subtext} text-[10px] font-bold uppercase`}>DOĞRU</div>
          </div>
          <div className={`p-4 ${theme.cardGlass} rounded-xl text-center`}>
            <div className="text-2xl font-black text-red-400">{stats.incorrect}</div>
            <div className={`${theme.subtext} text-[10px] font-bold uppercase`}>YANLIŞ</div>
          </div>
          <div className={`p-4 ${theme.cardGlass} rounded-xl text-center`}>
            <div className="text-2xl font-black text-indigo-400">{avgTime}s</div>
            <div className={`${theme.subtext} text-[10px] font-bold uppercase`}>ORT.SÜRE</div>
          </div>
        </div>
        <div className={`space-y-3 mb-8 text-left ${theme.cardGlass} p-5 rounded-xl max-h-56 overflow-y-auto custom-scrollbar`}>
          {stats.details.slice(0, 20).map((d, i) => (
            <div key={i} className={`flex items-center gap-3 py-1 border-b ${theme.divider} last:border-0`}>
              <div className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-black ${d.state === 'correct' ? 'bg-emerald-500 text-black' : 'bg-red-500 text-white'}`}>{i + 1}</div>
              <div className="flex-1 text-xs truncate opacity-60">{d.question.question.slice(0, 60)}…</div>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2.5">
          {incorrect.length > 0 && (
            <button onClick={() => onRetryIncorrect(incorrect)} className="btn btn-danger btn-lg w-full">
              <RotateCcw size={16} /> HATALARI TEKRAR ÇÖZ ({incorrect.length})
            </button>
          )}
          <div className="flex gap-2.5">
            <button onClick={onRestart} className="btn btn-primary btn-lg flex-1">ANA SAYFA</button>
            <button onClick={() => onExportPDF(stats.details.map(d => d.question), "Sınav Sonuçları")} className="btn btn-secondary btn-lg"><FileText size={18} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MODALS & IMPORT
   ═══════════════════════════════════════════════════════════ */
function ImportView({ onDone, theme }: { onDone: () => void; theme: Theme }) {
  const [jsonText, setJsonText] = useState('');
  const [loading, setLoading] = useState(false);
  const handleImport = async () => {
    try {
      const parsed = JSON.parse(jsonText);
      setLoading(true);
      await importQuestions(parsed);
      onDone();
    } catch (e: unknown) { alert(errMsg(e)); } finally { setLoading(false); }
  };
  return (
    <div className="max-w-2xl mx-auto w-full anim-slide-up">
      <h2 className="text-xl font-black mb-5">Soru Bankası Import</h2>
      <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} placeholder="JSON yapıştırın..." className={`w-full h-72 ${theme.inputBg} p-5 rounded-2xl font-mono text-sm resize-none border ${theme.border} input-ring mb-5`} />
      <button onClick={handleImport} disabled={loading} className="btn btn-primary btn-lg w-full">{loading ? 'Kaydediliyor...' : 'YÜKLE VE BAŞLA'}</button>
    </div>
  );
}

function SettingsModal({ settings, setSettings, onClose, theme, onExport, onImport, onSourceBooks, onResetStats }: { settings: UserSettings; setSettings: React.Dispatch<React.SetStateAction<UserSettings>>; onClose: () => void; theme: Theme; onExport: () => void; onImport: () => void; onSourceBooks: () => void; onResetStats: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xl anim-fade-in">
      {/* AUDIT-02: max-h + overflow-y-auto — küçük ekranlarda modal içeriği scroll edilebilir */}
      <div className={`w-full max-w-md ${theme.cardSolid} rounded-2xl p-7 ${theme.shadowLg} relative max-h-[90vh] overflow-y-auto custom-scrollbar anim-scale-in`}>
        <div className="flex justify-between items-center mb-7">
          <h3 className="text-lg font-black">Ayarlar</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-white/[0.06] rounded-xl transition-colors"><XCircle size={20} className="opacity-50" /></button>
        </div>
        <div className="space-y-7">
          <div>
            <label className={`${theme.subtext} text-[10px] font-bold tracking-widest uppercase block mb-3`}>GÖRÜNÜM TEMASI</label>
            <div className="grid grid-cols-3 gap-2">
              {(['dark', 'oled', 'light'] as const).map(t => (
                <button key={t} onClick={() => setSettings({ ...settings, theme: t })}
                  className={`py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all ${settings.theme === t ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/20' : `${theme.inputBg} ${theme.subtext} hover:bg-white/[0.08]`}`}>
                  {t === 'dark' ? 'KOYU' : t === 'oled' ? 'OLED' : 'AÇIK'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={`${theme.subtext} text-[10px] font-bold tracking-widest uppercase block mb-3`}>TEXT BOYUTU</label>
            <div className="grid grid-cols-3 gap-2">
              {(['small', 'normal', 'large'] as const).map(s => (
                <button key={s} onClick={() => setSettings({ ...settings, fontSize: s })}
                  className={`py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all ${settings.fontSize === s ? 'bg-emerald-500 text-black shadow-md shadow-emerald-500/20' : `${theme.inputBg} ${theme.subtext} hover:bg-white/[0.08]`}`}>
                  {s === 'small' ? 'KÜÇÜK' : s === 'normal' ? 'ORTA' : 'BÜYÜK'}
                </button>
              ))}
            </div>
          </div>
          <div className={`pt-6 border-t ${theme.divider}`}>
            <label className={`${theme.subtext} text-[10px] font-bold tracking-widest uppercase block mb-3`}>VERİ YÖNETİMİ</label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button onClick={onExport} className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-colors ${theme.inputBg} hover:bg-white/10 ${theme.text}`}><Download size={14} />Yedekle</button>
              <button onClick={onImport} className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-colors ${theme.inputBg} hover:bg-white/10 ${theme.text}`}><Upload size={14} />İçe Aktar</button>
            </div>
            <button onClick={onSourceBooks} className="flex w-full items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold mb-2 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 transition-colors border border-indigo-500/20"><BookOpen size={14} />AI Kaynak Kitaplar</button>
            <div className="mt-2">
              <button onClick={onResetStats} className="flex w-full items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors border border-red-500/20"><RotateCcw size={14} />İstatistik Sıfırla</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditModal({ question, onSave, onClose, theme }: { question: Question; onSave: (q: Question) => void; onClose: () => void; theme: Theme }) {
  const [q, setQ] = useState(question.question);
  const [options, setOptions] = useState(question.options);
  const [correct, setCorrect] = useState(question.correctAnswer);
  const [exp, setExp] = useState(question.explanation);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xl anim-fade-in">
      <div className={`w-full max-w-2xl ${theme.cardSolid} rounded-2xl p-7 max-h-[90vh] overflow-y-auto custom-scrollbar ${theme.shadowLg} anim-scale-in`}>
        <h3 className="text-lg font-black mb-5">Soruyu Düzenle</h3>
        <div className="space-y-3">
          <textarea value={q} onChange={e => setQ(e.target.value)} className={`w-full h-28 ${theme.inputBg} p-4 rounded-xl text-sm border ${theme.border} input-ring resize-none`} />
          <div className="grid grid-cols-2 gap-2">
            {Object.keys(options).map(k => (
              <div key={k}>
                <label className={`${theme.subtext} text-[10px] font-bold tracking-wider mb-1 block`}>ŞIK {k}</label>
                <input value={options[k as keyof typeof options]} onChange={e => setOptions({ ...options, [k]: e.target.value })} className={`w-full ${theme.inputBg} p-3 rounded-xl text-sm border ${theme.border} input-ring`} />
              </div>
            ))}
            <div>
              <label className={`${theme.subtext} text-[10px] font-bold tracking-wider mb-1 block`}>DOĞRU</label>
              <select value={correct} onChange={e => setCorrect(e.target.value as 'A' | 'B' | 'C' | 'D' | 'E')} className={`w-full ${theme.inputBg} p-3 rounded-xl text-sm border ${theme.border}`}>
                {(['A', 'B', 'C', 'D', 'E']).map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
          </div>
          <textarea value={exp} onChange={e => setExp(e.target.value)} className={`w-full h-28 ${theme.inputBg} p-4 rounded-xl text-sm border ${theme.border} input-ring resize-none`} />
        </div>
        <div className="flex gap-2.5 mt-6">
          <button onClick={onClose} className="btn btn-secondary btn-lg flex-1">İPTAL</button>
          <button onClick={() => onSave({ ...question, question: q, options, correctAnswer: correct, explanation: exp })} className="btn btn-primary btn-lg flex-1">KAYDET</button>
        </div>
      </div>
    </div>
  );
}

function ReportModal({ questionId, onSave, onClose, theme }: { questionId: string; onSave: (id: string, reason: string) => void; onClose: () => void; theme: Theme }) {
  const [r, setR] = useState('Hatalı Bilgi');
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xl anim-fade-in">
      <div className={`w-full max-w-sm ${theme.cardSolid} rounded-2xl p-7 ${theme.shadowLg} anim-scale-in`}>
        <h3 className="text-lg font-black mb-5">Raporla</h3>
        <select value={r} onChange={e => setR(e.target.value)} className={`w-full ${theme.inputBg} p-3.5 rounded-xl text-sm mb-5 border ${theme.border}`}>
          {(['Hatalı Bilgi', 'Yazım Yanlışı', 'Eksik Seçenek', 'Resim Hatası']).map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <div className="flex gap-2.5">
          <button onClick={onClose} className="btn btn-secondary btn-lg flex-1">İPTAL</button>
          <button onClick={() => onSave(questionId, r)} className="btn btn-danger btn-lg flex-1">GÖNDER</button>
        </div>
      </div>
    </div>
  );
}