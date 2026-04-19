/**
 * DUS Bankası — Adaptive Soru Seçim Motoru (Faz 4)
 *
 * Rapor §3.3: Priority queue — 3 sinyal birleştirme
 *   Sinyal 1 — FSRS Urgency:   Gecikmiş kartlar öncelikli, gecikme gün sayısıyla orantılı ağırlık.
 *   Sinyal 2 — Weakness Score: Hata pattern + doğruluk oranı düşük sorulara ek ağırlık.
 *   Sinyal 3 — Interleaving:   Ardışık sorular farklı derslerden seçilir (discriminative learning).
 *
 * Ek: 7-günlük FSRS review yükü projeksiyonu (Rapor §2.4 Katman 3)
 */

import type { Question } from '../data';
import type { StatsMap } from './stats';
import { todayStr, addDays } from './dateUtils';
import { fisherYates } from './shuffle';
import { DEFAULT_ADAPTIVE_WEIGHTS, type AdaptiveWeights } from '../config/learning';

// ─── Sabitler ──────────────────────────────────────────────────────────────
// Ağırlıklar src/config/learning.ts'ten gelir — runtime'da override edilebilir.
let _weights: AdaptiveWeights = { ...DEFAULT_ADAPTIVE_WEIGHTS };

/** Adaptive ağırlıkları runtime'da günceller (Dinamik Kalibrasyon için). */
export function setAdaptiveWeights(w: Partial<AdaptiveWeights>): void {
  _weights = { ..._weights, ...w };
}

/** Mevcut ağırlıkları döner (debug / test için). */
export function getAdaptiveWeights(): AdaptiveWeights {
  return { ..._weights };
}

// ─── Yardımcılar ───────────────────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
  const msA = new Date(a).getTime();
  const msB = new Date(b).getTime();
  return Math.round((msB - msA) / (1000 * 60 * 60 * 24));
}

// ─── Priority Hesaplama ────────────────────────────────────────────────────

interface ScoredQuestion {
  question: Question;
  priority: number;
  reason: 'overdue' | 'weak' | 'new';
}

/**
 * Tek soruya 0-1 arası priority skoru hesaplar.
 * Yüksek score = daha erken verilmeli.
 */
function scoreQuestion(q: Question, stats: StatsMap, today: string): ScoredQuestion {
  const stat = stats[q.id];

  // Yeni kart — hiç çözülmemiş
  if (!stat || stat.attempts === 0) {
    return { question: q, priority: _weights.newExploration * Math.random(), reason: 'new' };
  }

  // Sinyal 1: FSRS Urgency
  const nextReview = stat.nextReview ?? today;
  const overdueDays = Math.max(0, daysBetween(nextReview, today));
  // Normalise: 0 gün gecikme → 0, 30+ gün → 1.0 (log-scale yumuşatma)
  const urgency = overdueDays > 0
    ? Math.min(1, Math.log1p(overdueDays) / Math.log1p(30))
    : 0;

  // Sinyal 2: Weakness Score
  const correctRate = stat.attempts > 0 ? stat.corrects / stat.attempts : 0.5;
  const wrongChoiceCount = stat.wrongChoices?.length ?? 0;
  // Düşük doğruluk + fazla yanlış seçim kaydı → yüksek weakness
  const weaknessBase = 1 - correctRate; // 0-1 arası
  const wrongBonus = Math.min(1, wrongChoiceCount / 10); // 10+ yanlış → max bonus
  const weakness = Math.min(1, weaknessBase * 0.7 + wrongBonus * 0.3);

  // Ağırlıklı birleştirme
  const raw = _weights.fsrsUrgency * urgency + _weights.weakness * weakness;
  const priority = Math.min(1, raw) + Math.random() * 0.02; // tiny jitter (tie-break)

  const reason: ScoredQuestion['reason'] = overdueDays > 0 ? 'overdue' : 'weak';
  return { question: q, priority, reason };
}

// ─── Interleaving Filter ───────────────────────────────────────────────────

/**
 * Rohrer & Taylor (2007) interleaving: ardışık soruların dersleri farklı olmalı.
 * Algoritma: Greedy — her slotta kalan soruların en yüksek skorlusunu seç,
 * bir önceki soruyla aynı dersten geliyorsa o dersi atla (alternatif yoksa kabul et).
 */
function applyInterleaving(scored: ScoredQuestion[], limit: number): Question[] {
  const sorted = [...scored].sort((a, b) => b.priority - a.priority);
  const result: Question[] = [];
  let lastLesson = '';

  while (result.length < limit && sorted.length > 0) {
    // Farklı dersten ilk adayı bul
    const idx = sorted.findIndex(s => s.question.lesson !== lastLesson);
    const pick = idx !== -1 ? sorted.splice(idx, 1)[0] : sorted.splice(0, 1)[0];
    result.push(pick.question);
    lastLesson = pick.question.lesson;
  }

  return result;
}

// ─── Public API ────────────────────────────────────────────────────────────

export type SmartQueueOptions = {
  limit?: number;          // max soru sayısı (default 50)
  includeDue?: boolean;    // FSRS vadesi gelmiş dahil et (default true)
  includeWeak?: boolean;   // zayıf sorular dahil et (default true)
  includeNew?: boolean;    // yeni sorular dahil et (default true)
};

export type SmartQueueStats = {
  overdueCount: number;
  weakCount: number;
  newCount: number;
  totalSelected: number;
};

/**
 * Adaptive soru kuyruğu oluşturur.
 * Döner: seçilen sorular (interleaved sırada) + özet istatistikler.
 */
export function buildSmartQueue(
  questions: Question[],
  stats: StatsMap,
  options: SmartQueueOptions = {}
): { questions: Question[]; breakdown: SmartQueueStats } {
  const { limit = 50, includeDue = true, includeWeak = true, includeNew = true } = options;
  const today = todayStr();

  const scored: ScoredQuestion[] = [];

  for (const q of questions) {
    const s = scoreQuestion(q, stats, today);

    // Filtre: kullanıcı tercihleri
    if (s.reason === 'overdue' && !includeDue) continue;
    if (s.reason === 'weak' && !includeWeak) continue;
    if (s.reason === 'new' && !includeNew) continue;

    // Vadesi gelmemiş ve zayıf değil → düşük öncelikli yeni/tekrar soru
    scored.push(s);
  }

  const interleaved = applyInterleaving(scored, limit);

  // Breakdown hesapla
  const inSet = new Set(interleaved.map(q => q.id));
  const selected = scored.filter(s => inSet.has(s.question.id));
  const breakdown: SmartQueueStats = {
    overdueCount: selected.filter(s => s.reason === 'overdue').length,
    weakCount: selected.filter(s => s.reason === 'weak').length,
    newCount: selected.filter(s => s.reason === 'new').length,
    totalSelected: interleaved.length,
  };

  return { questions: interleaved, breakdown };
}

// ─── FSRS 7-Günlük Review Yükü Projeksiyonu ───────────────────────────────
// Rapor §2.4 Katman 3

export type DayForecast = {
  date: string;       // YYYY-MM-DD
  label: string;      // 'Bugün', 'Yarın', 'Pzt' vb.
  count: number;      // o gün vadesi gelen kart sayısı
  isToday: boolean;
};

const DAY_LABELS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

/**
 * FSRS `nextReview` tarihlerine bakarak gelecek `days` günün review yükünü tahmin eder.
 * NOT: Bu projeksiyon anlık bir snapshot — FSRS state değiştikçe tahmin değişir.
 */
export function getForecastNextDays(stats: StatsMap, days = 7): DayForecast[] {
  const today = todayStr();
  const forecast: DayForecast[] = [];

  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const dayOfWeek = new Date(date).getDay();
    const label = i === 0 ? 'Bugün' : i === 1 ? 'Yarın' : DAY_LABELS[dayOfWeek];
    forecast.push({ date, label, count: 0, isToday: i === 0 });
  }

  for (const stat of Object.values(stats)) {
    if (!stat.nextReview || stat.attempts === 0) continue;
    const nr = stat.nextReview;
    const entry = forecast.find(f => f.date === nr);
    if (entry) entry.count++;
  }

  return forecast;
}

// ─── Günlük Plan Orkestrasyon Yardımcıları ─────────────────────────────────
// Rapor §3.5

export type WeakUnit = {
  lesson: string;
  unit: string;
  accuracy: number;     // 0-100
  attempts: number;
  wrongChoiceCount: number;
};

/**
 * Hata pattern + düşük accuracy bazlı en zayıf N üniteyi döner.
 * DailyPlanView Bölüm 2 için kullanılır.
 */
export function getWeakestUnits(
  questions: Question[],
  stats: StatsMap,
  topN = 2,
  minAttempts = 5
): WeakUnit[] {
  const unitMap = new Map<string, { lesson: string; unit: string; attempts: number; corrects: number; wrongChoices: number }>();

  for (const q of questions) {
    const key = `${q.lesson}|||${q.unit}`;
    if (!unitMap.has(key)) unitMap.set(key, { lesson: q.lesson, unit: q.unit, attempts: 0, corrects: 0, wrongChoices: 0 });
    const u = unitMap.get(key)!;
    const s = stats[q.id];
    if (s && s.attempts > 0) {
      u.attempts += s.attempts;
      u.corrects += s.corrects;
      u.wrongChoices += s.wrongChoices?.length ?? 0;
    }
  }

  return Array.from(unitMap.values())
    .filter(u => u.attempts >= minAttempts)
    .map(u => ({
      lesson: u.lesson,
      unit: u.unit,
      accuracy: Math.round((u.corrects / u.attempts) * 100),
      attempts: u.attempts,
      wrongChoiceCount: u.wrongChoices,
    }))
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, topN);
}

/**
 * Müfredat ilerleme özeti: hangi ünitelerin hiç çözülmediğini döner.
 * DailyPlanView Bölüm 3 (yeni materyal önerisi) için kullanılır.
 */
export type CurriculumProgress = {
  totalUnits: number;
  solvedUnits: number;    // en az 1 soru çözülmüş
  completedUnits: number; // tüm soruları en az 1 kez çözülmüş
  nextUntouchedUnit: { lesson: string; unit: string; questionCount: number } | null;
};

export function getCurriculumProgress(questions: Question[], stats: StatsMap): CurriculumProgress {
  // Ünite → {total, solved}
  const unitMap = new Map<string, { lesson: string; unit: string; total: number; solved: number }>();

  for (const q of questions) {
    const key = `${q.lesson}|||${q.unit}`;
    if (!unitMap.has(key)) unitMap.set(key, { lesson: q.lesson, unit: q.unit, total: 0, solved: 0 });
    const u = unitMap.get(key)!;
    u.total++;
    const s = stats[q.id];
    if (s && s.attempts > 0) u.solved++;
  }

  const units = Array.from(unitMap.values());
  const solvedUnits = units.filter(u => u.solved > 0).length;
  const completedUnits = units.filter(u => u.solved >= u.total).length;

  // Hiç dokunulmamış ilk ünite (lesson alfabetik, unit alfabetik)
  const untouched = units
    .filter(u => u.solved === 0)
    .sort((a, b) => a.lesson.localeCompare(b.lesson) || a.unit.localeCompare(b.unit));

  return {
    totalUnits: units.length,
    solvedUnits,
    completedUnits,
    nextUntouchedUnit: untouched.length > 0
      ? { lesson: untouched[0].lesson, unit: untouched[0].unit, questionCount: untouched[0].total }
      : null,
  };
}

// ─── Soru Havuzu Kurma (Konsolide) ─────────────────────────────────────────
// App.tsx'te 3 yerde tekrar eden unseen-first + weighted + fisherYates + interleave
// mantığının tek yerden servis edilen halleri.

/**
 * Tek ünite için soru kuyruğu: unseen sorular önce, her grup kendi içinde Fisher-Yates.
 * (handleUnitSelect ve onStartWeakUnit callsite'larında kullanılır.)
 */
export function buildUnitQueue(
  allQuestions: Question[],
  lesson: string,
  unit: string,
  stats: StatsMap,
): Question[] {
  const unitQs = allQuestions.filter(q => q.unit === unit && q.lesson === lesson);
  const unseen = fisherYates(unitQs.filter(q => !stats[q.id] || stats[q.id].attempts === 0));
  const seen   = fisherYates(unitQs.filter(q => stats[q.id] && stats[q.id].attempts > 0));
  return [...unseen, ...seen];
}

/**
 * Çoklu ünite sınav havuzu:
 *   - Her ünitede: unseen 2× ağırlık + fisherYates + dedupe → weighted pool
 *   - Üniteler arası interleave (round-robin pop)
 *   - Son global Fisher-Yates shuffle
 * (handleStartExam callsite'ında kullanılır.)
 */
export function buildExamPool(
  allQuestions: Question[],
  units: Array<{ lesson: string; unit: string }>,
  stats: StatsMap,
  amount: number,
  filter?: (q: Question) => boolean,
): Question[] {
  const baseQuestions = filter ? allQuestions.filter(filter) : allQuestions;

  const buildWeightedPool = (unitQs: Question[]): Question[] => {
    const unseen = unitQs.filter(q => !stats[q.id] || stats[q.id].attempts === 0);
    const seen   = unitQs.filter(q => stats[q.id] && stats[q.id].attempts > 0);
    const weighted = fisherYates([...unseen, ...unseen, ...seen]);
    const seen_ids = new Set<string>();
    return weighted.filter(q => { if (seen_ids.has(q.id)) return false; seen_ids.add(q.id); return true; });
  };

  const pools = units.map(eu =>
    [...buildWeightedPool(baseQuestions.filter(q => q.lesson === eu.lesson && q.unit === eu.unit))]
  );

  let remainingAmount = amount;
  const finalSelection: Question[] = [];

  while (remainingAmount > 0 && pools.length > 0) {
    for (let i = pools.length - 1; i >= 0; i--) {
      if (remainingAmount <= 0) break;
      if (pools[i].length > 0) {
        finalSelection.push(pools[i].pop()!);
        remainingAmount--;
      } else {
        pools.splice(i, 1);
      }
    }
  }

  return fisherYates(finalSelection);
}
