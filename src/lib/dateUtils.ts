/**
 * DUS Bankası — Timezone-aware Tarih Yardımcıları
 *
 * NEDEN: new Date().toISOString() UTC döner.
 * Türkiye UTC+3'te gece 00:00–03:00 arasında bu yöntem önceki günü verir.
 * Streak, FSRS nextReview ve review kuyruğu için yerel tarih şarttır.
 */

/** Bugünün YYYY-MM-DD tarihini kullanıcının yerel timezone'unda döner */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Verilen YYYY-MM-DD tarihine n gün ekler, yerel tarih döner */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
