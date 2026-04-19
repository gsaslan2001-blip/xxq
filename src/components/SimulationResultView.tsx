/**
 * DUS Bankası — DUS Simülasyon Modu Sonuç Ekranı (Faz 3)
 *
 * Rapor §3.2: Standart ResultView üzerine ek metrikler:
 *   - Ortalama soru süresi
 *   - En yavaş 10 soru (zaman harcanan konular)
 *   - Zaman-doğruluk korelasyonu (hızlı vs yavaş yanıt)
 *   - DUS net skoru (doğru - yanlış/4)
 */

import type { Question } from '../data';

export type AnswerDetail = {
  question: Question;
  state: 'correct' | 'incorrect' | 'blank';
  selectedOptionKey?: string | null;
  timeSpent?: number;
};

interface SimulationResultViewProps {
  details: AnswerDetail[];
  totalSeconds: number;     // simülasyon için ayrılan toplam süre (saniye)
  usedSeconds: number;      // fiilen harcanan süre
  onRestart: () => void;
  theme: {
    card: string;
    subtext: string;
    bg: string;
    text: string;
    border: string;
    [key: string]: string;
  };
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function SimulationResultView({
  details,
  totalSeconds,
  usedSeconds,
  onRestart,
  theme,
}: SimulationResultViewProps) {
  const answered = details.filter(d => d.state !== 'blank');
  const correct = details.filter(d => d.state === 'correct').length;
  const incorrect = details.filter(d => d.state === 'incorrect').length;
  const blank = details.filter(d => d.state === 'blank').length;

  // DUS net skoru: doğru - (yanlış / 4)
  const netScore = +(correct - incorrect / 4).toFixed(2);
  const accuracy = answered.length > 0 ? Math.round((correct / answered.length) * 100) : 0;

  // Soru bazlı süre (sadece cevaplanmış sorular)
  const withTime = details.filter(d => d.state !== 'blank' && d.timeSpent != null && d.timeSpent! > 0);
  const avgTime = withTime.length > 0
    ? Math.round(withTime.reduce((a, b) => a + (b.timeSpent ?? 0), 0) / withTime.length)
    : 0;

  // En yavaş 10 soru
  const slowest = [...withTime]
    .sort((a, b) => (b.timeSpent ?? 0) - (a.timeSpent ?? 0))
    .slice(0, 10);

  // Zaman-doğruluk korelasyonu — medyan
  const sortedTimes = [...withTime].map(d => d.timeSpent ?? 0).sort((a, b) => a - b);
  const median = sortedTimes.length > 0
    ? sortedTimes[Math.floor(sortedTimes.length / 2)]
    : avgTime;
  const insufficientData = withTime.length < 20;
  const fastAnswers = withTime.filter(d => (d.timeSpent ?? 0) < median);
  const slowAnswers = withTime.filter(d => (d.timeSpent ?? 0) >= median);
  const fastAcc = fastAnswers.length > 0
    ? Math.round((fastAnswers.filter(d => d.state === 'correct').length / fastAnswers.length) * 100)
    : 0;
  const slowAcc = slowAnswers.length > 0
    ? Math.round((slowAnswers.filter(d => d.state === 'correct').length / slowAnswers.length) * 100)
    : 0;

  const netColor = netScore >= 115 ? 'text-emerald-400' : netScore >= 85 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="flex-1 flex flex-col gap-5 anim-slide-up pb-10 max-w-3xl mx-auto w-full">
      {/* Başlık */}
      <div className={`${theme.card} p-6 rounded-2xl text-center relative overflow-hidden`}>
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-indigo-500/30 via-emerald-500/30 to-amber-500/30" />
        <h2 className="text-xl font-black mb-0.5">DUS Simülasyon Sonucu</h2>
        <p className={`${theme.subtext} text-[11px]`}>
          {fmt(usedSeconds)} / {fmt(totalSeconds)} · Kalan: {fmt(Math.max(0, totalSeconds - usedSeconds))}
        </p>
      </div>

      {/* Ana Metrikler */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 stagger-children">
        <div className={`stagger-item ${theme.card} p-4 rounded-2xl text-center border-l-2 border-emerald-400/40`}>
          <div className="text-2xl font-black text-emerald-400">{correct}</div>
          <div className={`${theme.subtext} text-[9px] font-bold uppercase mt-0.5`}>DOĞRU</div>
        </div>
        <div className={`stagger-item ${theme.card} p-4 rounded-2xl text-center border-l-2 border-red-400/40`}>
          <div className="text-2xl font-black text-red-400">{incorrect}</div>
          <div className={`${theme.subtext} text-[9px] font-bold uppercase mt-0.5`}>YANLIŞ</div>
        </div>
        <div className={`stagger-item ${theme.card} p-4 rounded-2xl text-center border-l-2 border-white/10`}>
          <div className="text-2xl font-black">{blank}</div>
          <div className={`${theme.subtext} text-[9px] font-bold uppercase mt-0.5`}>BOŞ</div>
        </div>
        <div className={`stagger-item ${theme.card} p-4 rounded-2xl text-center border-l-2 border-amber-400/40`}>
          <div className={`text-2xl font-black ${netColor}`}>{netScore}</div>
          <div className={`${theme.subtext} text-[9px] font-bold uppercase mt-0.5`}>NET SKOR</div>
        </div>
      </div>

      {/* Süre & Doğruluk İstatistikleri */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className={`${theme.card} p-5 rounded-2xl text-center`}>
          <div className="text-xl font-black">{avgTime}s</div>
          <div className={`${theme.subtext} text-[9px] font-bold uppercase mt-0.5`}>ORT. SORU SÜRESİ</div>
          <div className={`${theme.subtext} text-[10px] mt-1.5`}>Hedef: &lt;45s</div>
        </div>
        <div className={`${theme.card} p-5 rounded-2xl text-center`}>
          <div className="text-xl font-black">%{accuracy}</div>
          <div className={`${theme.subtext} text-[9px] font-bold uppercase mt-0.5`}>DOĞRULUK</div>
          <div className={`${theme.subtext} text-[10px] mt-1.5`}>{answered.length} cevap</div>
        </div>
        <div className={`${theme.card} p-5 rounded-2xl`}>
          <div className={`${theme.subtext} text-[9px] font-bold uppercase mb-2`}>ZAMAN–DOĞRULUK</div>
          {insufficientData ? (
            <p className={`${theme.subtext} text-[10px] leading-relaxed`}>
              Min 20 cevap gerekir ({withTime.length} mevcut).
            </p>
          ) : (
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-[11px]">
                <span className="font-bold">Hızlı (&lt;{median}s)</span>
                <span className={`font-black ${fastAcc >= slowAcc ? 'text-emerald-400' : 'text-red-400'}`}>%{fastAcc}</span>
              </div>
              <div className="flex justify-between items-center text-[11px]">
                <span className="font-bold">Yavaş (≥{median}s)</span>
                <span className={`font-black ${slowAcc >= fastAcc ? 'text-emerald-400' : 'text-red-400'}`}>%{slowAcc}</span>
              </div>
              <p className={`${theme.subtext} text-[9px] mt-1.5`}>
                {fastAcc < slowAcc - 10 ? 'Hızlı cevapta dikkat kaybı.' : slowAcc < fastAcc - 10 ? 'Yavaş cevapta bilgi eksikliği.' : 'Dengede.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* En Yavaş 10 Soru */}
      {slowest.length > 0 && (
        <div className={`${theme.card} p-6 rounded-2xl`}>
          <h3 className="text-sm font-bold mb-1">En Yavaş 10 Soru</h3>
          <p className={`${theme.subtext} text-[11px] mb-4`}>Zaman harcanan konular</p>
          <div className="space-y-2">
            {slowest.map((d, i) => (
              <div key={i} className={`flex items-start gap-2.5 py-1.5 border-b ${theme.border} last:border-0`}>
                <div className={`shrink-0 w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-black ${
                  d.state === 'correct' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                }`}>{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium leading-relaxed truncate">
                    {d.question.question.slice(0, 90)}{d.question.question.length > 90 ? '…' : ''}
                  </p>
                  <p className={`${theme.subtext} text-[10px] mt-0.5`}>
                    {d.question.lesson} › {d.question.unit}
                  </p>
                </div>
                <div className={`shrink-0 text-xs font-black ${(d.timeSpent ?? 0) > 60 ? 'text-red-400' : (d.timeSpent ?? 0) > 45 ? 'text-amber-400' : theme.subtext}`}>
                  {d.timeSpent}s
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Yeniden Başlat */}
      <button onClick={onRestart} className="btn btn-primary btn-lg w-full shadow-lg shadow-indigo-500/15">
        ANA EKRANA DÖN
      </button>
    </div>
  );
}
