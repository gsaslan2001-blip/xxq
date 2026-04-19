/**
 * DUS Bankası — Öğrenme Algoritması Konfigürasyonu
 * Adaptive Engine ağırlıkları ve FSRS parametreleri buradan yönetilir.
 */

export type AdaptiveWeights = {
  fsrsUrgency: number;
  weakness: number;
  newExploration: number;
};

export const DEFAULT_ADAPTIVE_WEIGHTS: AdaptiveWeights = {
  fsrsUrgency: 0.50,
  weakness: 0.35,
  newExploration: 0.15,
};

// AUDIT: R5 — ağırlıkların toplamı 1.0 olmalı; modül yüklendiğinde kontrol edilir
function validateWeights(weights: AdaptiveWeights): void {
  const total = weights.fsrsUrgency + weights.weakness + weights.newExploration;
  if (Math.abs(total - 1.0) > 0.001) {
    throw new Error(
      `AdaptiveWeights toplam 1.0 olmalı, mevcut: ${total.toFixed(3)} (fsrsUrgency=${weights.fsrsUrgency}, weakness=${weights.weakness}, newExploration=${weights.newExploration})`
    );
  }
}

validateWeights(DEFAULT_ADAPTIVE_WEIGHTS);

/**
 * Kullanıcının doğruluk oranı bu eşiğin altına düşünce weakness ağırlığı artırılır.
 * Özellik 1: Dinamik Ağırlık Kalibrasyonu
 */
export const LOW_ACCURACY_THRESHOLD = 0.60;
export const BOOSTED_WEAKNESS_WEIGHT = 0.50;

/** FSRS: maksimum planlanan aralık (gün). DUS hazırlık süresine göre kalibre edilmiş. */
export const FSRS_MAX_INTERVAL_DAYS = 180;

/** FSRS: stability hard-cap (gün). Bu değerin üstündeki stability matematiksel anlam taşımaz. */
export const FSRS_MAX_STABILITY_DAYS = 365;
