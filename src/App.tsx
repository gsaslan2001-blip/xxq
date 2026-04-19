import { useState, useEffect, useCallback } from 'react';
import { importQuestions, deleteQuestionsInLesson, deleteQuestionsInUnit, deleteAllQuestions, renameLesson, renameUnit } from './lib/supabase';
import { useQuestions } from './hooks/useQuestions';
import { useResumableSession } from './hooks/useResumableSession';
import { useAuth } from './hooks/useAuth';
import { useRealtimeStats } from './hooks/useRealtimeStats';
import { AuthModal } from './components/AuthModal';
import type { Question } from './data';
import { getWeakQuestionIds, getUnitProgress, syncStatsUp, loadStreak, getRecentActivity, getDueForReviewIds, migrateAllStatsToFSRSIfNeeded, loadAllStats, getDeviceId, resetAllStats } from './lib/stats';
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
  AlertTriangle, FileText, Settings, BarChart3, Zap, Brain, Play, Target, Calendar,
  UserCircle
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

/* --- LOGO --- */
function Logo() {
  return (
    <div className="relative flex items-center justify-center">
      <div className="w-8 h-8 bg-gradient-to-br from-indigo-400 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
        <span className="text-white font-black text-lg leading-none">?</span>
      </div>
      <RefreshCw size={36} className="absolute text-indigo-400/30 anim-spin-slow" strokeWidth={2} />
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
  // BUG-006: Ünite modunda shuffle edilmiş soru listesi (unseen önce)
  const [unitQuestions, setUnitQuestions] = useState<Question[]>([]);
  const [isFavoritesExam, setIsFavoritesExam] = useState(false);
  const [quizStats, setQuizStats] = useState<QuizStatsType>({ correct: 0, incorrect: 0, blank: 0, total: 0, details: [] });
  const {
    questions,
    metadata,
    setQuestions,
    loading,
    loadError,
    loadMetadata,
    loadUnitQuestions,
    reload: loadQuestions,
    updateQuestion: updateQuestionInHook,
    deleteQuestion: deleteQuestionInHook,
    toggleFavorite: toggleFavoriteInHook,
    flagQuestion: flagQuestionInHook,
  } = useQuestions();

  const {
    resumeSessionData,
    clearResumableSession,
    saveResumableSession,
  } = useResumableSession();
  // Faz 3: DUS Simülasyon — window global yerine React state (önceki değer taşıma sorununu önler)
  const [simTotalSeconds, setSimTotalSeconds] = useState<number | null>(null);
  const [simResult, setSimResult] = useState<{ details: SimAnswerDetail[]; totalSeconds: number; usedSeconds: number } | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [reportingQuestion, setReportingQuestion] = useState<Question | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle');
  const [showSettings, setShowSettings] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  // ── Auth: Google/Email giriş + çok cihaz merge ──────────────────────────
  const { user, signOut } = useAuth();

  // ── Realtime: Başka cihazdan gelen FSRS güncellemelerini yakala ──────────
  useRealtimeStats({
    userId: user?.id ?? null,
    deviceId: getDeviceId(),
    onStatUpdate: useCallback((questionId: string) => {
      // Realtime güncelleme geldi — bir sonraki manuel sync'te cloud'dan çekilecek.
      // Anlık bir şey göstermek gerekmiyorsa sadece log yeterli.
      console.log('[Realtime] Başka cihazdan stat güncellendi:', questionId);
    }, []),
  });

  /* User Settings */
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

  // Faz 2: SM-2 → FSRS-5 one-time migrasyonu (açılışta, veri çekilmeden önce)
  // Rapor §5.2: Mevcut SM-2 state backup'lanır, rollback mekanizması korunur.
  // Startup: Sadece metadata yükle (Hızlı açılış)
  useEffect(() => {
    loadMetadata();
  }, [loadMetadata]);

  // Faz 2: SM-2 → FSRS-5 migrasyone (açılışta)
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
    // BUG-001: examQuestions'tan önce questions'a bak, her iki array'de is_favorite tutarlı olmalı
    const q = questions.find(x => x.id === id) || examQuestions.find(x => x.id === id);
    if (!q) return;
    const newStatus = !q.is_favorite;
    try {
      await toggleFavoriteInHook(id, newStatus);
      setExamQuestions(prev => {
        const updated = prev.map(x => x.id === id ? { ...x, is_favorite: newStatus } : x);
        // BUG-001: Favoriler modunda unfavorite edilince soruyu aktif session'dan kaldır
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
      setAppState('quiz');
    }
  };

  const handleDeleteAll = async () => {
    if (!confirm('Tüm soruları silmek istediğinize emin misiniz?')) return;
    try { await deleteAllQuestions(); setQuestions([]); } catch (e: unknown) { alert(errMsg(e)); }
  };

  const handleDeleteLesson = async (lesson: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`${lesson} dersini ve tüm sorularını silmek istediğinize emin misiniz?`)) return;
    try { await deleteQuestionsInLesson(lesson); setQuestions(p => p.filter(q => q.lesson !== lesson)); } catch (e: unknown) { alert(errMsg(e)); }
  };

  const handleDeleteUnit = async (unit: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`${unit} ünitesini silmek istediğinize emin misiniz?`)) return;
    try { await deleteQuestionsInUnit(selectedLesson, unit); setQuestions(p => p.filter(q => !(q.lesson === selectedLesson && q.unit === unit))); } catch (e: unknown) { alert(errMsg(e)); }
  };

  const handleDeleteQuestion = async (id: string) => {
    if (!confirm('Bu soruyu silmek istediğinize emin misiniz?')) return;
    try { await deleteQuestionInHook(id); } catch (e: unknown) { alert(errMsg(e)); }
  };

  const handleRenameLesson = async (oldLesson: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newLesson = window.prompt(`${oldLesson} dersi için yeni bir isim girin:`, oldLesson);
    if (!newLesson || newLesson.trim() === '' || newLesson === oldLesson) return;
    try {
      await renameLesson(oldLesson, newLesson.trim());
      setQuestions(p => p.map(q => q.lesson === oldLesson ? { ...q, lesson: newLesson.trim() } : q));
    } catch (err: unknown) { alert(errMsg(err)); }
  };

  const handleRenameUnit = async (unit: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newUnit = window.prompt(`${unit} ünitesi için yeni bir isim girin:`, unit);
    if (!newUnit || newUnit.trim() === '' || newUnit === unit) return;
    try {
      await renameUnit(selectedLesson, unit, newUnit.trim());
      setQuestions(p => p.map(q => q.lesson === selectedLesson && q.unit === unit ? { ...q, unit: newUnit.trim() } : q));
    } catch (err: unknown) { alert(errMsg(err)); }
  };

  const handleSaveEdit = async (edited: Question) => {
    try {
      await updateQuestionInHook(edited);
      // BUG-003: Exam modunda düzenlenen soru examQuestions'ta da güncellenmeli
      setExamQuestions(prev => prev.map(q => q.id === edited.id ? edited : q));
      setUnitQuestions(prev => prev.map(q => q.id === edited.id ? edited : q));
      setEditingQuestion(null);
    } catch (err: unknown) { alert("Güncellenemedi: " + errMsg(err)); }
  };

  const handleSaveReport = async (id: string, reason: string) => {
    try {
      await flagQuestionInHook(id, reason);
      setReportingQuestion(null);
      alert("Soru başarıyla raporlandı. Teşekkürler!");
    } catch (err: unknown) { alert("Raporlanamadı: " + errMsg(err)); }
  };


  const handleSyncStats = async () => {
    setSyncStatus('syncing');
    try {
      await syncStatsUp();
      setSyncStatus('done');
      setTimeout(() => setSyncStatus('idle'), 2500);
    } catch {
      setSyncStatus('error');
      setTimeout(() => setSyncStatus('idle'), 3000);
    }
  };

  const handleSimulationClick = async () => {
    if (questions.length === 0) {
      try {
        await loadQuestions();
      } catch (e) {
        alert('Sorular yüklenemedi: ' + errMsg(e));
        return;
      }
    }
    setAppState('simulation-setup');
  };

  const handleResetStats = async () => {
    if (!confirm('Tüm istatistikler (FSRS, doğruluk, streak, aktivite) kalıcı olarak silinecek. Emin misiniz?')) return;
    try {
      await resetAllStats();
      alert('Tüm istatistikler sıfırlandı.');
    } catch (e) {
      alert('Sıfırlama hatası: ' + errMsg(e));
    }
  };

  const availableLessons = Array.from(new Set(metadata.map((q) => q.lesson)));
  const unitsForLesson = Array.from(new Set(metadata.filter((q) => q.lesson === selectedLesson).map((q) => q.unit)));

  const handleLessonSelect = (lesson: string) => { setSelectedLesson(lesson); setAppState('select-unit'); };
  const handleUnitSelect = async (unit: string) => {
    setSelectedUnit(unit);
    try {
      // Performans Çözümü: Soru detaylarını şimdi çek (Lazy Load)
      await loadUnitQuestions(selectedLesson, unit);
      setAppState('quiz');
    } catch (e) {
      alert("Ünite yüklenemedi: " + errMsg(e));
    }
  };

  // useEffect ile unitQuestions'ı questions değişince güncelle (loadUnitQuestions bittiğinde)
  useEffect(() => {
    if (appState === 'quiz' && selectedUnit && questions.length > 0) {
      setUnitQuestions(buildUnitQueue(questions, selectedLesson, selectedUnit, loadAllStats()));
    }
  }, [questions, appState, selectedUnit, selectedLesson]);
  const handleComplete = (answers: AnswerDetail[]) => {
    const correct = answers.filter(a => a.state === 'correct').length;
    const incorrect = answers.filter(a => a.state === 'incorrect').length;
    const blank = answers.filter(a => a.state === 'blank').length;
    setQuizStats({ correct, incorrect, blank, total: answers.length, details: answers });
    setAppState('result');
    clearResumableSession().catch(() => { });
  };
  const handleReturnToHome = () => { setAppState('select-lesson'); setSelectedLesson(''); setSelectedUnit(''); setMode('quiz'); setUnitQuestions([]); };

  const handleExportPDF = (selection: Question[], title: string) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert('Popup engellendi. Tarayıcı ayarlarından popup izni verin.'); return; }
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const date = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
    const PER_PAGE = 6;

    const chunks: Question[][] = [];
    for (let i = 0; i < selection.length; i += PER_PAGE) {
      chunks.push(selection.slice(i, i + PER_PAGE));
    }

    const renderQuestionPage = (chunk: Question[], chunkIndex: number) => {
      const offset = chunkIndex * PER_PAGE;
      return `
<div class="page questions-page">
  <div class="page-header">
    <span class="page-title">${esc(title)}</span>
    <span class="page-meta">${date} &nbsp;·&nbsp; Sorular ${offset + 1}–${offset + chunk.length}</span>
  </div>
  <div class="q-grid">
    ${chunk.map((q, i) => `
    <div class="qblock">
      <div class="qnum">SORU ${offset + i + 1}</div>
      <div class="qtext">${esc(q.question)}</div>
      <div class="opts">
        ${(['A', 'B', 'C', 'D', 'E'] as const).map(k => `
        <div class="opt"><span class="opt-key">${k}</span> ${esc(q.options[k] || '')}</div>`).join('')}
      </div>
    </div>`).join('')}
  </div>
</div>`;
    };

    const renderAnswerPage = (chunk: Question[], chunkIndex: number) => {
      const offset = chunkIndex * PER_PAGE;
      return `
<div class="page answer-page">
  <div class="page-header">
    <span class="page-title">${esc(title)}</span>
    <span class="page-meta">Cevap Anahtarı — Sorular ${offset + 1}–${offset + chunk.length}</span>
  </div>
  <div class="answer-key-row">
    ${chunk.map((q, i) => `
    <div class="answer-badge">
      <span class="ans-num">${offset + i + 1}</span>
      <span class="ans-val">${q.correctAnswer}</span>
    </div>`).join('')}
  </div>
  <div class="exp-list">
    ${chunk.map((q, i) => `
    <div class="exp-block">
      <div class="exp-header"><span class="exp-num">${offset + i + 1}.</span> <strong>${q.correctAnswer} şıkkı</strong></div>
      <div class="exp-text">${esc(q.explanation || '').replace(/\n/g, '<br>')}</div>
    </div>`).join('')}
  </div>
</div>`;
    };

    const html = `<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8"><title>${esc(title)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;color:#111;font-size:11.5px;line-height:1.5;background:#fff}
.page{width:100%;padding:18px 22px;page-break-after:always;min-height:100vh}
.page:last-child{page-break-after:auto}
.page-header{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #6366f1;padding-bottom:7px;margin-bottom:14px}
.page-title{font-size:13px;font-weight:900;color:#6366f1}
.page-meta{font-size:10px;color:#6b7280}
.q-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px}
.qblock{border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;break-inside:avoid}
.qnum{font-size:9px;font-weight:900;letter-spacing:.12em;color:#9ca3af;text-transform:uppercase;margin-bottom:5px}
.qtext{font-weight:700;font-size:11px;margin-bottom:8px;color:#111;line-height:1.45}
.opts{display:flex;flex-direction:column;gap:3px}
.opt{display:flex;align-items:flex-start;gap:6px;font-size:10.5px;padding:3px 0;line-height:1.4}
.opt-key{font-weight:900;color:#374151;min-width:14px;flex-shrink:0}
.answer-page{background:#fafafa}
.answer-key-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px;padding:12px;background:#fff;border:1px solid #e5e7eb;border-radius:8px}
.answer-badge{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:36px}
.ans-num{font-size:9px;font-weight:900;color:#9ca3af}
.ans-val{font-size:15px;font-weight:900;color:#166534;background:#dcfce7;border-radius:6px;width:32px;height:32px;display:flex;align-items:center;justify-content:center}
.exp-list{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px}
.exp-block{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;break-inside:avoid}
.exp-header{font-size:10px;margin-bottom:5px;display:flex;align-items:center;gap:5px}
.exp-num{font-weight:900;color:#6366f1}
.exp-text{font-size:10px;color:#374151;line-height:1.5}
@media print{
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{padding:12px 16px;min-height:auto}
  @page{margin:8mm;size:A4}
}
</style></head><body>
${chunks.map((chunk, ci) => renderQuestionPage(chunk, ci) + renderAnswerPage(chunk, ci)).join('')}
</body></html>`;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); }, 600);
  };

  const handleWeakQuestionsClick = () => {
    const weakIds = getWeakQuestionIds();
    const weakQs = questions.filter(q => weakIds.includes(q.id));
    if (weakQs.length === 0) {
      alert('Henüz zayıf soru bulunamadı. En az 2 kez çözülmüş ve %50 altı doğru oranlı sorular burada görünecek.');
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
        setUnitQuestions([]); // Önceki üniteden kalan soru havuzunu temizle
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

  // Mobil geri tuşu desteği (History API)
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
    // BUG-005: Fisher-Yates + weighted sampling (attempts===0 sorular 2× ağırlık)
    // BUG-001: isFavoritesExam'da yalnızca is_favorite===true sorular havuza alınır
    const shuffledFinal = buildExamPool(
      questions,
      examUnits,
      loadAllStats(),
      amount,
      isFavoritesExam ? (q: Question) => !!q.is_favorite : undefined,
    );
    setExamQuestions(shuffledFinal);
    setMode('exam');
    setAppState('quiz');
    clearResumableSession().catch(() => { });
  };

  // BUG-006: Ünite modunda unitQuestions (shuffled+unseen-first), exam modunda examQuestions
  const activeQuestions = mode === 'exam'
    ? examQuestions
    : (unitQuestions.length > 0 ? unitQuestions : questions.filter(q => q.unit === selectedUnit && q.lesson === selectedLesson));

  const theme = themeColors[settings.theme];

  return (
    <div className={`h-screen ${theme.bg} ${theme.text} selection:bg-indigo-500/20 font-sans overflow-hidden flex flex-col`}>
      {/* ── HEADER ─────────────────────────────────────── */}
      <header className={`${theme.headerBg} backdrop-blur-2xl border-b ${theme.border} z-50 shrink-0`}>
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5 cursor-pointer group" onClick={handleGoBack}>
            {appState !== 'select-lesson' && (
              <ArrowLeft size={20} strokeWidth={2} className="text-indigo-400 group-hover:-translate-x-0.5 transition-transform" />
            )}
            <Logo />
            <h1 className="text-sm font-bold tracking-tight hidden sm:block opacity-80">DUS BANKASI</h1>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setAppState('analytics')}
              className={`p-2 rounded-xl transition-all ${appState === 'analytics' ? 'text-indigo-400 bg-indigo-500/10' : `${theme.subtext} hover:bg-white/[0.06]`}`}
              title="Analitik"
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
            {/* Auth butonu */}
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

      {/* ── MAIN CONTENT ───────────────────────────────── */}
      <main className="flex-1 overflow-y-auto w-full max-w-[1400px] mx-auto px-4 sm:px-6">
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
            <ErrorAnalyticsView questions={questions} stats={loadAllStats()} theme={theme} />
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
              theme={theme}
            />
          ) : appState === 'select-lesson' ? (
            <LessonSelection
              lessons={availableLessons}
              onSelect={handleLessonSelect}
              totalQuestions={metadata.length}
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
              favoritesCount={metadata.filter(q => q.quality_flag === 'favorite').length || questions.filter(q => q.is_favorite).length}
              weakCount={getWeakQuestionIds().length}
              onWeakClick={handleWeakQuestionsClick}
              dueCount={getDueForReviewIds().length}
              onDueClick={handleDueReviewClick}
              onSyncStats={handleSyncStats}
              syncStatus={syncStatus}
              onSimulationClick={handleSimulationClick}
              onDailyPlanClick={() => setAppState('daily-plan')}
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
            <DenemeAmountSelection selectedUnits={examUnits} questions={isFavoritesExam ? questions.filter(q => q.is_favorite) : questions} onStart={handleStartExam} onCancel={() => setAppState('select-lesson')} theme={theme} />
          ) : appState === 'select-unit' ? (
            <UnitSelection 
              lesson={selectedLesson} 
              units={unitsForLesson} 
              metadata={metadata} // Pass metadata instead of full questions
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
              onSaveSession={mode === 'exam' && !simTotalSeconds ? (session: ActiveSessionInfo) => {
                saveResumableSession(session).catch(() => { });
              } : undefined}
              timedSeconds={simTotalSeconds ?? undefined}
              onSimulationComplete={(details, usedSecs) => {
                const total = simTotalSeconds ?? 9000;
                setSimTotalSeconds(null);
                setSimResult({ details: details as SimAnswerDetail[], totalSeconds: total, usedSeconds: usedSecs });
                setAppState('simulation-result');
              }}
              onExportPDF={handleExportPDF}
              theme={theme}
              settings={settings}
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
                // FIX: handleUnitSelect mantığı — unseen önce, her grup Fisher-Yates shuffle
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
      {showSettings && <SettingsModal settings={settings} setSettings={setSettings} onClose={() => setShowSettings(false)} theme={theme} onExport={handleExport} onImport={() => { setAppState('import'); setShowSettings(false); }} onDeleteAll={handleDeleteAll} onSourceBooks={() => { setAppState('source-books'); setShowSettings(false); }} questionCount={questions.length} onResetStats={handleResetStats} />}
      {showAuth && <AuthModal user={user} onClose={() => setShowAuth(false)} onSignOut={signOut} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   LESSON SELECTION — Bento Grid Home Page
   ═══════════════════════════════════════════════════════════ */
function LessonSelection({ lessons, onSelect, totalQuestions, onDelete, onRename, onDenemeClick, onFavoritesClick, hasResume, resumeInfo, onResumeClick, onResumeClear, favoritesCount, weakCount, onWeakClick, dueCount, onDueClick, onSyncStats, syncStatus, onSimulationClick, onDailyPlanClick, onSmartStudyClick, theme }: { lessons: string[]; onSelect: (l: string) => void; totalQuestions: number; onDelete: (l: string, e: React.MouseEvent) => void; onRename: (l: string, e: React.MouseEvent) => void; onDenemeClick: () => void; onFavoritesClick: () => void; hasResume: boolean; resumeInfo: { answeredCount: number; totalCount: number; remaining: number } | null; onResumeClick: () => void; onResumeClear: () => void; favoritesCount: number; weakCount: number; onWeakClick: () => void; dueCount: number; onDueClick: () => void; onSyncStats: () => void; syncStatus: string; onSimulationClick: () => void; onDailyPlanClick: () => void; onSmartStudyClick: () => void; theme: Theme }) {
  return (
    <div className="anim-slide-up w-full">
      {/* Hero */}
      <div className="mb-8">
        <h2 className="text-3xl sm:text-4xl font-black tracking-tight mb-1">
          Hoş Geldin<span className="gradient-text">.</span>
        </h2>
        <p className={`${theme.subtext} text-sm font-medium`}>
          {totalQuestions === 0 ? 'Henüz soru yok — Ayarlar > Import ile başla.' : `${totalQuestions} soru hazır. Çalışmaya devam et.`}
        </p>
      </div>

      {/* Resume Banner */}
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

      {/* Quick Action Bento Grid */}
      {totalQuestions > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8 stagger-children">
          {/* FSRS Due Review */}
          {dueCount > 0 && (
            <button onClick={onDueClick} className={`stagger-item ${theme.cardGlass} rounded-2xl p-4 text-left card-hover group border-l-2 border-violet-400/50`}>
              <div className="w-8 h-8 rounded-xl bg-violet-500/15 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <RotateCcw size={16} className="text-violet-400" />
              </div>
              <div className="text-xs font-bold mb-0.5">Bugün Tekrar</div>
              <div className="text-xl font-black text-violet-400">{dueCount}</div>
              <div className={`${theme.subtext} text-[10px] mt-1`}>FSRS vadesi geldi</div>
            </button>
          )}

          {/* Weak Questions */}
          {weakCount > 0 && (
            <button onClick={onWeakClick} className={`stagger-item ${theme.cardGlass} rounded-2xl p-4 text-left card-hover group border-l-2 border-red-400/50`}>
              <div className="w-8 h-8 rounded-xl bg-red-500/15 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <AlertTriangle size={16} className="text-red-400" />
              </div>
              <div className="text-xs font-bold mb-0.5">Zayıf Sorular</div>
              <div className="text-xl font-black text-red-400">{weakCount}</div>
              <div className={`${theme.subtext} text-[10px] mt-1`}>%50 altı doğruluk</div>
            </button>
          )}

          {/* Favorites */}
          <button onClick={onFavoritesClick} className={`stagger-item ${theme.cardGlass} rounded-2xl p-4 text-left card-hover group border-l-2 border-amber-400/50`}>
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              <Star size={16} className="text-amber-400" />
            </div>
            <div className="text-xs font-bold mb-0.5">Favoriler</div>
            <div className="text-xl font-black text-amber-400">{favoritesCount}</div>
            <div className={`${theme.subtext} text-[10px] mt-1`}>İşaretlenen sorular</div>
          </button>

          {/* Deneme Modu */}
          <button onClick={onDenemeClick} className={`stagger-item ${theme.cardGlass} rounded-2xl p-4 text-left card-hover group border-l-2 border-sky-400/50`}>
            <div className="w-8 h-8 rounded-xl bg-sky-500/15 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              <Play size={16} className="text-sky-400" />
            </div>
            <div className="text-xs font-bold mb-0.5">Deneme Modu</div>
            <div className={`${theme.subtext} text-[10px] mt-1`}>Ünite seç, soru çöz</div>
          </button>

          {/* DUS Simülasyon */}
          <button onClick={onSimulationClick} className={`stagger-item ${theme.cardGlass} rounded-2xl p-4 text-left card-hover group border-l-2 border-rose-400/50`}>
            <div className="w-8 h-8 rounded-xl bg-rose-500/15 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              <Target size={16} className="text-rose-400" />
            </div>
            <div className="text-xs font-bold mb-0.5">DUS Simülasyon</div>
            <div className={`${theme.subtext} text-[10px] mt-1`}>Gerçek sınav formatı</div>
          </button>

          {/* Günlük Plan */}
          <button onClick={onDailyPlanClick} className={`stagger-item ${theme.cardGlass} rounded-2xl p-4 text-left card-hover group border-l-2 border-orange-400/50`}>
            <div className="w-8 h-8 rounded-xl bg-orange-500/15 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              <Calendar size={16} className="text-orange-400" />
            </div>
            <div className="text-xs font-bold mb-0.5">Günlük Plan</div>
            <div className={`${theme.subtext} text-[10px] mt-1`}>Bugünün takvimi</div>
          </button>

          {/* Akıllı Çalışma */}
          <button onClick={onSmartStudyClick} className={`stagger-item ${theme.cardGlass} rounded-2xl p-4 text-left card-hover group border-l-2 border-emerald-400/50`}>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              <Brain size={16} className="text-emerald-400" />
            </div>
            <div className="text-xs font-bold mb-0.5">Akıllı Çalışma</div>
            <div className={`${theme.subtext} text-[10px] mt-1`}>FSRS + Zayıf + Yeni</div>
          </button>

          {/* Sync */}
          <button
            onClick={onSyncStats}
            disabled={syncStatus === 'syncing'}
            className={`stagger-item ${theme.cardGlass} rounded-2xl p-4 text-left card-hover group border-l-2 border-white/10`}
          >
            <div className="w-8 h-8 rounded-xl bg-white/[0.06] flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              {syncStatus === 'syncing' ? <Loader2 size={16} className="animate-spin text-indigo-400" /> :
                syncStatus === 'done' ? <CheckCheck size={16} className="text-emerald-400" /> :
                  syncStatus === 'error' ? <AlertCircle size={16} className="text-red-400" /> :
                    <RefreshCw size={16} className={theme.subtext} />}
            </div>
            <div className="text-xs font-bold mb-0.5">
              {syncStatus === 'syncing' ? 'Senkronize…' : syncStatus === 'done' ? 'Tamam!' : syncStatus === 'error' ? 'Hata' : 'Bulut Sync'}
            </div>
            <div className={`${theme.subtext} text-[10px] mt-1`}>İstatistikleri yedekle</div>
          </button>
        </div>
      )}

      {/* Lesson Cards */}
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 stagger-children">
            {lessons.map((lesson) => (
              <div key={lesson} onClick={() => onSelect(lesson)} className={`stagger-item cursor-pointer group relative flex flex-col items-start p-5 ${theme.card} ${theme.cardHover} rounded-2xl transition-all card-hover overflow-hidden text-left`}>
                <div className="flex justify-between items-start w-full">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center mb-4 group-hover:bg-indigo-500/20 transition-colors">
                    <LayoutGrid size={18} className="text-indigo-400" />
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div onClick={(e) => onRename(lesson, e)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/30 hover:text-white transition-colors"><Pencil size={13} /></div>
                    <div onClick={(e) => onDelete(lesson, e)} className="p-1.5 rounded-lg hover:bg-red-500/15 text-white/30 hover:text-red-400 transition-colors"><Trash2 size={13} /></div>
                  </div>
                </div>
                <h3 className="text-base font-bold mb-0.5 max-w-full truncate pr-2">{lesson}</h3>
                <p className={`${theme.subtext} text-[11px] font-medium`}>Başlamak için tıkla</p>
                <div className="absolute bottom-0 right-0 w-20 h-20 bg-indigo-500/[0.03] rounded-tl-full opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   UNIT SELECTION
   ═══════════════════════════════════════════════════════════ */
function UnitSelection({ lesson, units, metadata, onSelect, onDelete, onRename, onExportPDF, theme }: { lesson: string; units: string[]; metadata: any[]; onSelect: (u: string) => void; onDelete: (u: string, e: React.MouseEvent) => void; onRename: (u: string, e: React.MouseEvent) => void; onExportPDF: (selection: any[], title: string) => void; theme: Theme }) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'progress' | 'count'>('name');

  const unitData = units.map(unit => {
    const unitMeta = metadata.filter(q => q.lesson === lesson && q.unit === unit);
    const progress = getUnitProgress(unitMeta.map(q => q.id));
    const pct = progress.total > 0 ? Math.round((progress.solved / progress.total) * 100) : 0;
    const acc = progress.solved > 0 ? progress.correct / progress.solved : 0;
    const barColor = acc >= 0.7 ? 'bg-emerald-400' : acc >= 0.3 ? 'bg-amber-400' : pct > 0 ? 'bg-red-400' : 'bg-white/10';
    return { unit, unitMeta, progress, pct, barColor };
  });

  const filtered = unitData
    .filter(d => d.unit.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'name') return a.unit.localeCompare(b.unit, 'tr');
      if (sortBy === 'progress') return b.pct - a.pct;
      if (sortBy === 'count') return b.unitMeta.length - a.unitMeta.length;
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
        <button onClick={() => onExportPDF(metadata.filter(q => q.lesson === lesson), `${lesson} Soruları`)} className="btn btn-ghost btn-sm">
          <FileText size={14} /> PDF
        </button>
      </div>

      {/* Arama + Sıralama */}
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
        {filtered.map(({ unit, unitMeta, pct, barColor }) => (
          <div key={unit} onClick={() => onSelect(unit)} className={`stagger-item cursor-pointer w-full flex items-center justify-between p-4 ${theme.card} ${theme.cardHover} rounded-2xl transition-all text-left group card-hover`}>
            <div className="overflow-hidden pr-4 flex-1">
              <span className="text-sm font-bold group-hover:translate-x-0.5 transition-transform block truncate">{unit}</span>
              <div className="flex items-center gap-3 mt-1.5 w-full">
                <span className={`${theme.subtext} text-[10px] font-bold shrink-0`}>{unitMeta.length} soru</span>
                <div className="flex-1 h-1 bg-white/[0.04] rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-1000 ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
                {pct > 0 && <span className={`${theme.subtext} text-[10px] font-bold shrink-0`}>%{pct}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <div onClick={(e) => { e.stopPropagation(); alert('PDF için üniteyi açıp inceleyin.'); }} className="p-1.5 rounded-lg hover:bg-white/10 text-white/30 hover:text-white transition-colors"><FileText size={13} /></div>
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

/* ═══════════════════════════════════════════════════════════
   DENEME & AMOUNT SELECTIONS
   ═══════════════════════════════════════════════════════════ */
function DenemeSelection({ questions, onNext, onCancel, isFavoritesMode, theme }: { questions: Question[]; onNext: (units: { lesson: string; unit: string }[]) => void; onCancel: () => void; isFavoritesMode: boolean; theme: Theme }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const grouped = questions.reduce((acc, q) => {
    if (!acc[q.lesson]) acc[q.lesson] = new Set();
    acc[q.lesson].add(q.unit);
    return acc;
  }, {} as Record<string, Set<string>>);
  const toggleUnit = (l: string, u: string) => {
    const key = `${l}|-|${u}`;
    const n = new Set(selected);
    if (n.has(key)) n.delete(key); else n.add(key);
    setSelected(n);
  };
  const toggleLesson = (l: string, us: string[]) => {
    const n = new Set(selected);
    const all = us.every(u => n.has(`${l}|-|${u}`));
    us.forEach(u => { if (all) n.delete(`${l}|-|${u}`); else n.add(`${l}|-|${u}`); });
    setSelected(n);
  };
  return (
    <div className="anim-slide-up w-full max-w-2xl mx-auto flex flex-col pb-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-black">{isFavoritesMode ? "Favoriler" : "Deneme Seçimi"}</h2>
          <p className={`${theme.subtext} text-xs mt-0.5`}>Üniteleri belirleyin</p>
        </div>
        <button onClick={onCancel} className="btn btn-ghost btn-sm">İptal</button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
        {Object.entries(grouped).map(([lesson, unitsSet]) => {
          const units = Array.from(unitsSet);
          const allS = units.every(u => selected.has(`${lesson}|-|${u}`));
          const someS = units.some(u => selected.has(`${lesson}|-|${u}`));
          return (
            <div key={lesson} className={`${theme.card} rounded-2xl overflow-hidden`}>
              <div className="p-4 flex items-center gap-3 cursor-pointer hover:bg-white/[0.03] transition-all" onClick={() => toggleLesson(lesson, units)}>
                <div className={`w-5 h-5 rounded-md flex items-center justify-center border-2 transition-all ${allS ? 'bg-indigo-500 border-indigo-500' : someS ? 'bg-indigo-500/50 border-indigo-500/50' : `${theme.border}`}`}>{(allS || someS) && <CheckCircle2 size={14} />}</div>
                <span className="font-bold text-sm flex-1">{lesson}</span>
              </div>
              <div className={`border-t ${theme.divider} bg-black/10 p-1.5`}>
                {units.map(unit => {
                  const s = selected.has(`${lesson}|-|${unit}`);
                  return (
                    <div key={unit} className="p-2.5 pl-10 flex items-center gap-3 cursor-pointer hover:bg-white/[0.03] rounded-xl transition-all" onClick={() => toggleUnit(lesson, unit)}>
                      <div className={`w-4 h-4 rounded flex items-center justify-center border-2 transition-all ${s ? 'bg-emerald-500 border-emerald-500' : `${theme.border}`}`}>{s && <CheckCircle2 size={12} className="text-black" strokeWidth={3} />}</div>
                      <span className={`text-xs ${s ? '' : theme.subtext}`}>{unit}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <button onClick={() => onNext(Array.from(selected).map(k => ({ lesson: k.split('|-|')[0], unit: k.split('|-|')[1] })))} disabled={selected.size === 0} className="btn btn-primary btn-lg w-full mt-4">
        Devam Et ({selected.size}) <ArrowRight size={16} />
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SIMULATION SETUP
   ═══════════════════════════════════════════════════════════ */
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
            <div className={`${theme.subtext} text-[10px] font-bold uppercase tracking-widest mb-3`}>SORU SAYISI</div>
            <div className="text-4xl font-black mb-4 text-center">{questionCount}</div>
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

function DenemeAmountSelection({ selectedUnits, questions, onStart, onCancel, theme }: { selectedUnits: { lesson: string; unit: string }[]; questions: Question[]; onStart: (a: number) => void; onCancel: () => void; theme: Theme }) {
  const [amount, setAmount] = useState(1);
  const max = questions.filter(q => selectedUnits.some(su => su.lesson === q.lesson && su.unit === q.unit)).length;
  useEffect(() => setAmount(Math.min(20, max)), [max]);
  return (
    <div className="anim-scale-in flex-1 flex flex-col items-center justify-center">
      <div className={`${theme.card} w-full max-w-lg p-8 sm:p-10 rounded-2xl ${theme.shadow} relative overflow-hidden`}>
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-indigo-500 to-emerald-400 opacity-60" />
        <h2 className="text-2xl font-black mb-8 tracking-tight text-center">Soru Sayısı</h2>
        <div className="mb-8 text-center">
          <div className="text-6xl font-black mb-6">{amount}</div>
          <input type="range" min="1" max={max} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          <div className={`flex justify-between text-xs font-medium ${theme.subtext} mt-3`}><span>1</span><span>{max}</span></div>
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="btn btn-secondary btn-lg flex-1">Geri</button>
          <button onClick={() => onStart(amount)} className="btn btn-primary btn-lg flex-[2]">BAŞLAT</button>
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

function SettingsModal({ settings, setSettings, onClose, theme, onExport, onImport, onDeleteAll, onSourceBooks, questionCount, onResetStats }: { settings: UserSettings; setSettings: React.Dispatch<React.SetStateAction<UserSettings>>; onClose: () => void; theme: Theme; onExport: () => void; onImport: () => void; onDeleteAll: () => void; onSourceBooks: () => void; questionCount: number; onResetStats: () => void }) {
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
              <button onClick={onExport} className="btn btn-secondary btn-md w-full"><Download size={14} />YEDEKLE</button>
              <button onClick={onImport} className="btn btn-secondary btn-md w-full"><Upload size={14} />IMPORT</button>
            </div>
            <button onClick={onSourceBooks} className="btn btn-md w-full mb-2 bg-indigo-500/8 text-indigo-400 border border-indigo-500/15 hover:bg-indigo-500/15"><BookOpen size={14} />AI KAYNAK KİTAPLAR</button>
            <button onClick={onDeleteAll} className="btn btn-danger btn-md w-full"><Trash2 size={14} />TÜMÜNÜ SİL ({questionCount})</button>
            <button onClick={onResetStats} className="btn btn-danger btn-md w-full mt-2"><RotateCcw size={14} />İSTATİSTİKLERİ SIFIRLA</button>
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
