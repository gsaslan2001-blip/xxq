/**
 * DUS Bankası — FSRS-5 Core Algoritması
 *
 * Free Spaced Repetition Scheduler v5 — power-law forgetting curve modeli.
 * SM-2'nin aksine her kart için bireysel stability (S) ve difficulty (D) taşır.
 *
 * Grade mapping (binary correct/incorrect UX için):
 *   1 = Again   (isCorrect=false)
 *   2 = Hard    (opsiyonel — UI'da şu an yok)
 *   3 = Good    (isCorrect=true)
 *   4 = Easy    (opsiyonel)
 *
 * Referans: https://github.com/open-spaced-repetition/fsrs4anki/wiki
 */

import { todayStr, addDays } from './dateUtils';
import { FSRS_MAX_STABILITY_DAYS, FSRS_MAX_INTERVAL_DAYS } from '../config/learning';

export type FSRSGrade = 1 | 2 | 3 | 4;

export type FSRSCard = {
  stability: number;       // gün cinsinden hafıza gücü
  difficulty: number;      // 1-10, yüksek = daha zor
  lastReview: string;      // ISO date (YYYY-MM-DD)
  scheduledDays: number;   // bir sonraki review'e kadar gün
  reps: number;            // toplam review sayısı
};

// ─── FSRS-5 Sabitleri ──────────────────────────────────────────────────────
const FACTOR = 19 / 81;
const DECAY = -0.5;
export const DEFAULT_REQUEST_RETENTION = 0.9; // %90 retention hedefi

// FSRS-5 default weights (optimizer'sız, literatür baseline'ı)
const W = [
  0.4072, 1.1829, 3.1262, 15.4722, 7.2102,
  0.5316, 1.0651, 0.0234, 1.616, 0.1544,
  1.0824, 1.9813, 0.0953, 0.2975, 2.2042,
  0.2407, 2.9466, 0.5034, 0.6567,
];

// ─── Yardımcılar ───────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  return Math.max(0, Math.round((b - a) / (1000 * 60 * 60 * 24)));
}

// ─── FSRS-5 Formülleri ─────────────────────────────────────────────────────

/** Retrievability: kart şu an çağrılabilir mi? (power-law decay) */
export function retrievability(elapsedDays: number, stability: number): number {
  return Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY);
}

/** Kart için ilk review'da stability başlangıcı */
function initStability(grade: FSRSGrade): number {
  return Math.max(W[grade - 1], 0.1);
}

/** Kart için ilk review'da difficulty başlangıcı */
function initDifficulty(grade: FSRSGrade): number {
  const d = W[4] - Math.exp(W[5] * (grade - 1)) + 1;
  return clamp(d, 1, 10);
}

function meanReversion(init: number, current: number): number {
  return W[7] * init + (1 - W[7]) * current;
}

function nextDifficulty(D: number, grade: FSRSGrade): number {
  const dDelta = -W[6] * (grade - 3);
  const newD = D + dDelta * ((10 - D) / 9);
  return clamp(meanReversion(initDifficulty(4 as FSRSGrade), newD), 1, 10);
}

/** Doğru cevap sonrası yeni stability */
function nextRecallStability(D: number, S: number, R: number, grade: FSRSGrade): number {
  const hardPenalty = grade === 2 ? W[15] : 1;
  const easyBonus = grade === 4 ? W[16] : 1;
  return S * (1 + Math.exp(W[8]) * (11 - D) * Math.pow(S, -W[9]) * (Math.exp((1 - R) * W[10]) - 1) * hardPenalty * easyBonus);
}

/** Yanlış cevap sonrası yeni stability (lapse) */
function nextForgetStability(D: number, S: number, R: number): number {
  return W[11] * Math.pow(D, -W[12]) * (Math.pow(S + 1, W[13]) - 1) * Math.exp((1 - R) * W[14]);
}

/** Bir sonraki review'a kadar gün sayısı (target retention'a göre) */
export function nextInterval(stability: number, requestRetention = DEFAULT_REQUEST_RETENTION): number {
  const raw = (stability / FACTOR) * (Math.pow(requestRetention, 1 / DECAY) - 1);
  return clamp(Math.round(raw), 1, FSRS_MAX_INTERVAL_DAYS);
}

// ─── Public API ────────────────────────────────────────────────────────────

/** Yeni (hiç görülmemiş) kart için başlangıç state'i */
export function initCard(grade: FSRSGrade = 3): FSRSCard {
  const today = todayStr();
  const S = initStability(grade);
  const D = initDifficulty(grade);
  const scheduledDays = nextInterval(S);
  return {
    stability: S,
    difficulty: D,
    lastReview: today,
    scheduledDays,
    reps: 1,
  };
}

/**
 * Mevcut kartı review grade'i ile günceller.
 * Döner: yeni FSRSCard (mutasyon YOK — saf fonksiyon)
 */
export function reviewCard(card: FSRSCard, grade: FSRSGrade): FSRSCard {
  const today = todayStr();
  const elapsed = daysBetween(card.lastReview, today);

  // Eğer kart planlı tarihten önce geldiyse, min 0 gün — retrievability hesabı için kullanılır
  const R = card.reps > 0 ? retrievability(Math.max(elapsed, 0), card.stability) : 1;

  const newD = nextDifficulty(card.difficulty, grade);

  let newS: number;
  if (grade === 1) {
    // Again (lapse) — forget stability
    newS = nextForgetStability(card.difficulty, card.stability, R);
  } else {
    // Hard/Good/Easy — recall stability
    newS = nextRecallStability(card.difficulty, card.stability, R, grade);
  }

  // Stability [0.1, FSRS_MAX_STABILITY_DAYS] aralığında tut
  newS = clamp(newS, 0.1, FSRS_MAX_STABILITY_DAYS);

  const scheduledDays = nextInterval(newS);

  return {
    stability: Math.round(newS * 100) / 100,
    difficulty: Math.round(newD * 100) / 100,
    lastReview: today,
    scheduledDays,
    reps: card.reps + 1,
  };
}

/** FSRS kartının bir sonraki review tarihini YYYY-MM-DD olarak döner */
export function nextReviewDate(card: FSRSCard): string {
  return addDays(card.lastReview, card.scheduledDays);
}

/** Difficulty bazlı etiket (UI badge'leri için) */
export function difficultyLabel(D: number): 'easy' | 'medium' | 'hard' {
  if (D < 4) return 'easy';
  if (D < 7) return 'medium';
  return 'hard';
}

// ─── SM-2 → FSRS-5 Migrasyonu ──────────────────────────────────────────────

/**
 * SM-2 parametrelerinden FSRS kartına dönüşüm.
 * Rapor §5.2 güvenliği: Mevcut SM-2 state'i çağıran tarafta backup'lanmalı.
 *
 * Map stratejisi:
 *   EF ∈ [1.3, 2.5] → D ∈ [10, 1] (ters lineer — düşük EF = zor kart)
 *   stability ≈ interval (geçmiş aralık kadar hafızada kalmış)
 *   lastReview ≈ lastSeen veya bugün
 */
export function migrateSM2Card(sm2: {
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReview?: string;
  lastSeen?: string;
}): FSRSCard {
  const ef = clamp(sm2.easeFactor, 1.3, 2.5);
  // EF=2.5 → D=1  (kolay) ; EF=1.3 → D=10 (zor)
  const D = clamp(10 - ((ef - 1.3) / (2.5 - 1.3)) * 9, 1, 10);

  const S = Math.max(sm2.interval, 0.5);
  const lastReview = (sm2.lastSeen || todayStr()).split('T')[0];
  const scheduledDays = sm2.interval > 0 ? sm2.interval : nextInterval(S);

  return {
    stability: Math.round(S * 100) / 100,
    difficulty: Math.round(D * 100) / 100,
    lastReview,
    scheduledDays,
    reps: Math.max(sm2.repetitions, 1),
  };
}
