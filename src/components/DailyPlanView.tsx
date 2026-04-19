/**
 * DUS Bankası — Günlük Çalışma Planı (Faz 4)
 *
 * Rapor §3.5: Üç bölüm:
 *   Bölüm 1 — Review zorunluluğu (FSRS kuyruğu)
 *   Bölüm 2 — Zayıf alan müdahalesi (Hata Pattern tabanlı)
 *   Bölüm 3 — Yeni materyal önerisi (müfredat ilerlemesi)
 *
 * Karar fatiguesini elimine eder — tek tıkla aksiyona geçiş.
 */

import type { Question } from '../data';
import type { StatsMap } from '../lib/stats';
import { getForecastNextDays, getWeakestUnits, getCurriculumProgress } from '../lib/adaptive';

interface DailyPlanViewProps {
  questions: Question[];
  stats: StatsMap;
  dueCount: number;
  onStartReview: () => void;           // Bugünkü FSRS review'u başlat
  onStartWeakUnit: (lesson: string, unit: string) => void;  // Zayıf ünite quiz
  onStartSmartStudy: () => void;        // Adaptive queue quiz
  theme: {
    card: string;
    subtext: string;
    bg: string;
    text: string;
    border: string;
    [key: string]: string;
  };
}

// DUS'a kalan hafta sayısı (1 Kasım 2026 hedef tarihi)
const DUS_DATE = new Date('2026-11-01');
function weeksUntilDUS(): number {
  const now = new Date();
  const diff = DUS_DATE.getTime() - now.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24 * 7)));
}

export default function DailyPlanView({
  questions,
  stats,
  dueCount,
  onStartReview,
  onStartWeakUnit,
  onStartSmartStudy,
  theme,
}: DailyPlanViewProps) {
  const today = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  const forecast = getForecastNextDays(stats, 7);
  const weakUnits = getWeakestUnits(questions, stats, 2, 5);
  const curriculum = getCurriculumProgress(questions, stats);
  const weeksLeft = weeksUntilDUS();

  // Tahmini review süresi: ortalama 45s/kart
  const reviewMins = Math.ceil(dueCount * 45 / 60);

  // Müfredat hız tavsiyesi: kalan ünite / kalan hafta
  const remainingUnits = curriculum.totalUnits - curriculum.solvedUnits;
  const unitsPerWeek = weeksLeft > 0 ? Math.ceil(remainingUnits / weeksLeft) : remainingUnits;

  const hasPlan = dueCount > 0 || weakUnits.length > 0 || curriculum.nextUntouchedUnit;

  return (
    <div className="flex flex-col gap-5 anim-slide-up pb-10 max-w-3xl mx-auto w-full">

      {/* Başlık */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-black tracking-tight">Günün Planı</h2>
          <p className={`${theme.subtext} text-xs mt-0.5 capitalize`}>{today}</p>
        </div>
        <div className={`${theme.card} px-3.5 py-2 rounded-xl text-center`}>
          <div className="text-lg font-black text-amber-400">{weeksLeft}</div>
          <div className={`${theme.subtext} text-[8px] font-bold uppercase`}>HAFTA KALDI</div>
        </div>
      </div>

      {!hasPlan ? (
        <div className={`${theme.card} rounded-2xl p-10 text-center`}>
          <div className="text-3xl mb-3">✅</div>
          <h3 className="text-lg font-black mb-1">Bugün için plan yok</h3>
          <p className={`${theme.subtext} text-xs mb-5`}>Review kuyruğu boş, bilinen zayıf ünite yok.</p>
          <button onClick={onStartSmartStudy} className="btn btn-primary btn-lg">
            AKILLI ÇALIŞMA BAŞLAT
          </button>
        </div>
      ) : (
        <>
          {/* ── Bölüm 1: FSRS Review Kuyruğu ── */}
          <div className={`${theme.card} rounded-2xl p-5 relative overflow-hidden`}>
            <div className="absolute top-0 left-0 w-0.5 h-full bg-violet-400/60 rounded-r" />
            <div className="flex items-start justify-between gap-4 pl-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-base">🔁</span>
                  <span className={`${theme.subtext} text-[10px] font-bold uppercase tracking-widest`}>Bölüm 1 — Review</span>
                </div>
                <h3 className="text-lg font-black mb-0.5">
                  {dueCount > 0 ? `${dueCount} kart vadesi geldi` : 'Review kuyruğu boş'}
                </h3>
                {dueCount > 0 && (
                  <p className={`${theme.subtext} text-xs`}>
                    ~{reviewMins} dk · FSRS tekrar zamanı
                  </p>
                )}
              </div>
              {dueCount > 0 && (
                <button onClick={onStartReview} className="btn btn-sm shrink-0 bg-violet-500/12 text-violet-400 border border-violet-500/15 hover:bg-violet-500/20">
                  BAŞLAT →
                </button>
              )}
            </div>
            {dueCount === 0 && (
              <p className={`${theme.subtext} text-[11px] mt-1 pl-3`}>Yarın: {forecast[1]?.count ?? 0} kart</p>
            )}
          </div>

          {/* ── Bölüm 2: Zayıf Alan Müdahalesi ── */}
          {weakUnits.length > 0 && (
            <div className={`${theme.card} rounded-2xl p-5 relative overflow-hidden`}>
              <div className="absolute top-0 left-0 w-0.5 h-full bg-red-400/60 rounded-r" />
              <div className="flex items-center gap-2 mb-3 pl-3">
                <span className="text-base">🎯</span>
                <span className={`${theme.subtext} text-[10px] font-bold uppercase tracking-widest`}>Bölüm 2 — Zayıf Alan</span>
              </div>
              <div className="space-y-2.5 pl-3">
                {weakUnits.map((u, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-bold text-xs truncate">{u.unit}</span>
                        <span className={`${theme.subtext} text-[10px] shrink-0`}>{u.lesson}</span>
                      </div>
                      <p className={`${theme.subtext} text-[10px] mt-0.5`}>
                        %{u.accuracy} · {u.attempts} deneme
                      </p>
                      <div className="mt-1 h-1 bg-white/[0.04] rounded-full overflow-hidden w-32">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${u.accuracy >= 75 ? 'bg-emerald-400' : u.accuracy >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                          style={{ width: `${u.accuracy}%` }}
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => onStartWeakUnit(u.lesson, u.unit)}
                      className="btn btn-sm shrink-0 bg-red-500/10 text-red-400 border border-red-500/15 hover:bg-red-500/20"
                    >
                      GİT →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Bölüm 3: Yeni Materyal ── */}
          {curriculum.nextUntouchedUnit && (
            <div className={`${theme.card} rounded-2xl p-5 relative overflow-hidden`}>
              <div className="absolute top-0 left-0 w-0.5 h-full bg-emerald-400/60 rounded-r" />
              <div className="flex items-center gap-2 mb-2 pl-3">
                <span className="text-base">📖</span>
                <span className={`${theme.subtext} text-[10px] font-bold uppercase tracking-widest`}>Bölüm 3 — Yeni Materyal</span>
              </div>
              <div className="flex items-start justify-between gap-4 pl-3">
                <div className="flex-1">
                  <h3 className="text-base font-black mb-0.5">{curriculum.nextUntouchedUnit.unit}</h3>
                  <p className={`${theme.subtext} text-xs mb-1`}>
                    {curriculum.nextUntouchedUnit.lesson} · {curriculum.nextUntouchedUnit.questionCount} soru
                  </p>
                  <p className={`${theme.subtext} text-[11px]`}>
                    {curriculum.solvedUnits}/{curriculum.totalUnits} ünite · Hafta {unitsPerWeek} ünite önerisi
                  </p>
                </div>
                <button
                  onClick={() => onStartWeakUnit(curriculum.nextUntouchedUnit!.lesson, curriculum.nextUntouchedUnit!.unit)}
                  className="btn btn-sm shrink-0 bg-emerald-500/10 text-emerald-400 border border-emerald-500/15 hover:bg-emerald-500/20"
                >
                  BAŞLA →
                </button>
              </div>
            </div>
          )}

          {/* ── Akıllı Çalışma CTA ── */}
          <button onClick={onStartSmartStudy} className="btn btn-primary btn-lg w-full shadow-lg shadow-indigo-500/15">
            🧠 AKILLI ÇALIŞMA BAŞLAT
          </button>
        </>
      )}

      {/* ── 7-Günlük Forecast Mini Özet ── */}
      <div className={`${theme.card} rounded-2xl p-5`}>
        <h4 className="font-bold text-xs mb-3">Bu Hafta Review Yükü</h4>
        <div className="flex items-end gap-2 h-16">
          {forecast.map((f, i) => {
            const max = Math.max(...forecast.map(x => x.count), 1);
            const pct = (f.count / max) * 100;
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                <div className="relative w-full flex items-end justify-center" style={{ height: '44px' }}>
                  <div
                    className={`w-full rounded-md transition-all hover:opacity-80 ${f.isToday ? 'bg-indigo-400' : 'bg-white/10'}`}
                    style={{ height: `${Math.max(pct, 6)}%`, minHeight: f.count > 0 ? '6px' : '2px' }}
                  />
                  {f.count > 0 && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] font-bold opacity-50 group-hover:opacity-100">{f.count}</div>
                  )}
                </div>
                <span className={`text-[8px] font-medium ${f.isToday ? 'text-indigo-400' : theme.subtext}`}>{f.label}</span>
              </div>
            );
          })}
        </div>
        <p className={`${theme.subtext} text-[10px] mt-2`}>
          Toplam: {forecast.reduce((a, b) => a + b.count, 0)} kart
        </p>
      </div>
    </div>
  );
}
