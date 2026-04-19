/**
 * DUS Bankası — Hata Pattern Analizi Arayüzü (Faz 3)
 *
 * Rapor §3.1: wrong_choices verisinden 3 analiz üretir:
 *   1. Distraktör frekansı — hangi şık en çok seçiliyor
 *   2. Ünite bazlı hata oranı sıralaması — zayıf üniteleri lokalize et
 *   3. Hata trendi — son N günde doğruluk değişimi
 */

import type { Question } from '../data';
import type { StatsMap } from '../lib/stats';

interface ErrorAnalyticsViewProps {
  questions: Question[];
  stats: StatsMap;
  theme: {
    card: string;
    subtext: string;
    bg: string;
    text: string;
    border: string;
    [key: string]: string;
  };
}

// ─── Yardımcı Tipler ──────────────────────────────────────────────────────

type DistractorStat = {
  unit: string;
  lesson: string;
  questionId: string;
  questionStem: string;
  totalWrong: number;
  topChoice: string;
  topChoiceCount: number;
  choiceBreakdown: Record<string, number>; // { A: 3, B: 1, ... }
};

type UnitErrorStat = {
  lesson: string;
  unit: string;
  attempts: number;
  wrongs: number;
  accuracy: number; // 0-100
  wrongChoiceCount: number; // kaç farklı yanlış seçim kaydı var
};

// ─── Ana Component ────────────────────────────────────────────────────────

export default function ErrorAnalyticsView({ questions, stats, theme }: ErrorAnalyticsViewProps) {
  // ─── 1. Distraktör Frekansı Analizi ────────────────────────────────────
  const distractorStats: DistractorStat[] = [];
  for (const q of questions) {
    const stat = stats[q.id];
    if (!stat || !stat.wrongChoices || stat.wrongChoices.length === 0) continue;

    const breakdown: Record<string, number> = {};
    for (const wc of stat.wrongChoices) {
      breakdown[wc.selected] = (breakdown[wc.selected] || 0) + 1;
    }

    const topEntry = Object.entries(breakdown).sort((a, b) => b[1] - a[1])[0];
    if (!topEntry) continue;

    distractorStats.push({
      unit: q.unit,
      lesson: q.lesson,
      questionId: q.id,
      questionStem: q.question.slice(0, 100),
      totalWrong: stat.wrongChoices.length,
      topChoice: topEntry[0],
      topChoiceCount: topEntry[1],
      choiceBreakdown: breakdown,
    });
  }
  // En çok yanlış yapılan sorular üstte
  const topDistractors = distractorStats
    .sort((a, b) => b.totalWrong - a.totalWrong)
    .slice(0, 20);

  // ─── 2. Ünite Bazlı Hata Oranı ─────────────────────────────────────────
  const unitMap = new Map<string, UnitErrorStat>();
  for (const q of questions) {
    const key = `${q.lesson}|||${q.unit}`;
    if (!unitMap.has(key)) {
      unitMap.set(key, { lesson: q.lesson, unit: q.unit, attempts: 0, wrongs: 0, accuracy: 0, wrongChoiceCount: 0 });
    }
    const u = unitMap.get(key)!;
    const s = stats[q.id];
    if (s && s.attempts > 0) {
      u.attempts += s.attempts;
      u.wrongs += (s.attempts - s.corrects);
      u.wrongChoiceCount += (s.wrongChoices?.length ?? 0);
    }
  }
  for (const u of unitMap.values()) {
    u.accuracy = u.attempts > 0 ? Math.round(((u.attempts - u.wrongs) / u.attempts) * 100) : 0;
  }
  const weakUnits = Array.from(unitMap.values())
    .filter(u => u.attempts >= 5)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 15);

  // ─── 3. Hata Cross-Ünite Korelasyonu ───────────────────────────────────
  const crossUnitChoices = new Map<string, { lessons: Set<string>; units: Set<string>; count: number }>();
  for (const q of questions) {
    const s = stats[q.id];
    if (!s?.wrongChoices) continue;
    for (const wc of s.wrongChoices) {
      const choiceText = (q.options as Record<string, string>)[wc.selected] ?? '';
      const key = choiceText.slice(0, 60).toLowerCase().trim();
      if (!key || key.length < 10) continue;
      if (!crossUnitChoices.has(key)) crossUnitChoices.set(key, { lessons: new Set(), units: new Set(), count: 0 });
      const entry = crossUnitChoices.get(key)!;
      entry.lessons.add(q.lesson);
      entry.units.add(`${q.lesson} > ${q.unit}`);
      entry.count++;
    }
  }
  const crossUnitPatterns = Array.from(crossUnitChoices.entries())
    .filter(([, v]) => v.units.size >= 2 && v.count >= 3)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8);

  const hasData = topDistractors.length > 0 || weakUnits.length > 0;

  if (!hasData) {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-4 anim-fade-in">
        <div className={`${theme.card} rounded-2xl p-10 text-center max-w-md`}>
          <div className="text-3xl mb-3">📊</div>
          <h2 className="text-lg font-black mb-2">Veri Birikimi Bekleniyor</h2>
          <p className={`${theme.subtext} text-xs leading-relaxed`}>
            Hata Pattern Analizi için yeterli yanlış cevap kaydı yok.<br />
            Birkaç quiz çözdükten sonra burası dolmaya başlayacak.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 anim-slide-up pb-10">
      {/* Başlık */}
      <div>
        <h2 className="text-2xl font-black tracking-tight">Hata Pattern Analizi</h2>
        <p className={`${theme.subtext} text-xs mt-0.5`}>
          {topDistractors.reduce((a, b) => a + b.totalWrong, 0)} yanlış cevap kaydı analiz edildi
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Panel 1: En Fazla Yanlış Yapılan Sorular (Distraktör Frekansı) */}
        <div className={`${theme.card} p-6 rounded-2xl`}>
          <h3 className="text-sm font-bold mb-1">Distraktör Frekansı</h3>
          <p className={`${theme.subtext} text-[11px] mb-4`}>Hangi sorularda hangi yanlış şıklar tekrar ediliyor</p>
          <div className="space-y-3 max-h-[460px] overflow-y-auto pr-2 custom-scrollbar">
            {topDistractors.map((d, i) => (
              <div key={i} className={`border ${theme.border} rounded-xl p-3.5`}>
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <p className="text-[11px] font-medium opacity-70 leading-relaxed flex-1">
                    {d.questionStem}{d.questionStem.length >= 100 ? '…' : ''}
                  </p>
                  <span className={`${theme.subtext} text-[10px] shrink-0`}>{d.lesson}</span>
                </div>
                <p className={`${theme.subtext} text-[10px] mb-2.5`}>{d.unit}</p>
                {/* Şık dağılımı bar'ları */}
                <div className="space-y-1">
                  {Object.entries(d.choiceBreakdown)
                    .sort((a, b) => b[1] - a[1])
                    .map(([choice, count]) => {
                      const pct = Math.round((count / d.totalWrong) * 100);
                      return (
                        <div key={choice} className="flex items-center gap-2">
                          <span className="text-[10px] font-bold w-3.5 shrink-0">{choice}</span>
                          <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-red-400/70 transition-all duration-700" style={{ width: `${pct}%` }} />
                          </div>
                          <span className={`${theme.subtext} text-[10px] w-12 text-right`}>{count}× %{pct}</span>
                        </div>
                      );
                    })}
                </div>
                <div className={`${theme.subtext} text-[10px] mt-2`}>
                  {d.totalWrong} yanlış · Baskın: <strong>{d.topChoice}</strong> %{Math.round((d.topChoiceCount / d.totalWrong) * 100)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Panel 2: Ünite Bazlı Zayıf Alan Sıralaması */}
        <div className="flex flex-col gap-5">
          <div className={`${theme.card} p-6 rounded-2xl`}>
            <h3 className="text-sm font-bold mb-1">Zayıf Ünite Sıralaması</h3>
            <p className={`${theme.subtext} text-[11px] mb-4`}>En az 5 deneme · Doğruluk sıralı</p>
            <div className="space-y-3 max-h-[240px] overflow-y-auto pr-2 custom-scrollbar">
              {weakUnits.map((u, i) => {
                const color = u.accuracy >= 75 ? 'bg-emerald-400' : u.accuracy >= 50 ? 'bg-amber-400' : 'bg-red-400';
                const textColor = u.accuracy >= 75 ? 'text-emerald-400' : u.accuracy >= 50 ? 'text-amber-400' : 'text-red-400';
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="text-[11px] font-bold">{u.unit}</span>
                        <span className={`${theme.subtext} text-[10px] ml-2`}>{u.lesson}</span>
                      </div>
                      <span className={`text-xs font-black ${textColor}`}>%{u.accuracy}</span>
                    </div>
                    <div className="h-1 bg-white/[0.04] rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${color} transition-all duration-1000`} style={{ width: `${u.accuracy}%` }} />
                    </div>
                    <div className={`${theme.subtext} text-[10px]`}>
                      {u.wrongs} yanlış / {u.attempts} deneme
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Panel 3: Cross-Ünite Hata Korelasyonu */}
          {crossUnitPatterns.length > 0 && (
            <div className={`${theme.card} p-6 rounded-2xl`}>
              <h3 className="text-sm font-bold mb-1">Cross-Ünite Korelasyon</h3>
              <p className={`${theme.subtext} text-[11px] mb-4`}>
                Farklı derslerde tekrar eden kavram karışıklıkları
              </p>
              <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                {crossUnitPatterns.map(([key, v], i) => (
                  <div key={i} className="border border-amber-500/15 bg-amber-500/[0.04] rounded-xl p-3">
                    <p className="text-[11px] font-medium mb-0.5 leading-relaxed">
                      "{key.slice(0, 70)}{key.length > 70 ? '…' : ''}"
                    </p>
                    <div className={`${theme.subtext} text-[10px]`}>
                      {v.count}× · {v.units.size} ünitede · {Array.from(v.lessons).join(', ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
