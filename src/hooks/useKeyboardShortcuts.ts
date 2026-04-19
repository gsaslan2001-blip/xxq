import { useEffect } from 'react';

export type KeyboardShortcutOptions = {
  onNext: (skip: boolean) => void;
  onPrev: () => void;
  onSkip: () => void;
  setSelected: (key: string) => void;
  isAnswered: boolean;
  isHistorized: boolean;
  enabled?: boolean;
};

/**
 * Keyboard shortcuts for QuizView. Behavior mirrors App.tsx:1286-1302.
 * - Space / ArrowRight: next (only if answered)
 * - ArrowLeft: previous
 * - a/b/c/d/e or 1/2/3/4/5: pick option (only if not yet answered/historized)
 * - s: skip (only if not answered)
 */
export function useKeyboardShortcuts(opts: KeyboardShortcutOptions): void {
  const { onNext, onPrev, onSkip, setSelected, isAnswered, isHistorized, enabled = true } = opts;

  useEffect(() => {
    if (!enabled) return;
    const hk = (e: KeyboardEvent) => {
      if (e.code === 'Space' && isAnswered) { e.preventDefault(); onNext(false); }
      if (!isAnswered && !isHistorized) {
        if (e.key === 'a' || e.key === '1') setSelected('A');
        if (e.key === 'b' || e.key === '2') setSelected('B');
        if (e.key === 'c' || e.key === '3') setSelected('C');
        if (e.key === 'd' || e.key === '4') setSelected('D');
        if (e.key === 'e' || e.key === '5') setSelected('E');
      }
      if (e.key === 'ArrowLeft') onPrev();
      if (e.key === 'ArrowRight' && isAnswered) onNext(false);
      if (e.key === 's' && !isAnswered) onSkip();
    };
    window.addEventListener('keydown', hk);
    return () => window.removeEventListener('keydown', hk);
  }, [onNext, onPrev, onSkip, setSelected, isAnswered, isHistorized, enabled]);
}
