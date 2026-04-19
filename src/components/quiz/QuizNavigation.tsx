import { memo } from 'react';

export type QuizNavigationProps = {
  currentIndex: number;
  total: number;
  isAnswered: boolean;
  onPrev: () => void;
  onSkip: () => void;
  onNext: () => void;
};

/**
 * ÖNCEKİ / BOŞ GEÇ / SONRAKİ navigation buttons. Extracted from App.tsx:1442-1446.
 */
export const QuizNavigation = memo(function QuizNavigation({ currentIndex, total, isAnswered, onPrev, onSkip, onNext }: QuizNavigationProps) {
  return (
    <div className="p-4 sm:p-5 pt-0 flex flex-col sm:flex-row gap-2 shrink-0">
      <button onClick={onPrev} disabled={currentIndex === 0} className="btn btn-secondary btn-lg flex-1 disabled:opacity-0 transition-opacity">ÖNCEKİ</button>
      <button onClick={onSkip} disabled={isAnswered} className="btn btn-lg flex-1 bg-red-500/12 text-red-400 border border-red-500/15 hover:bg-red-500/20 disabled:opacity-0">BOŞ GEÇ</button>
      <button onClick={onNext} disabled={!isAnswered} className="btn btn-primary btn-lg flex-[2] disabled:opacity-0 shadow-lg shadow-indigo-500/15">{currentIndex < total - 1 ? 'SONRAKİ' : 'BİTİR'} →</button>
    </div>
  );
});
