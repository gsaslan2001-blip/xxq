import { forwardRef, memo, useMemo } from 'react';
import { Star } from 'lucide-react';
import type { Question } from '../../data';
import type { UserSettings } from '../../types/app';
import type { Theme } from '../../theme';
import { fontSizes, semanticColors } from '../../theme';

export type QuestionCardProps = {
  question: Question;
  selectedOption: string | null;
  isAnswered: boolean;
  onSelect: (key: string) => void;
  onToggleFavorite: (id: string) => void;
  theme: Theme;
  settings: UserSettings;
};

/**
 * Soru metni + şıklar kartı. Extracted from App.tsx:1392-1414.
 */
const OPTION_LINE_RE = /^[A-E]\s*[)\-.]/;

export const QuestionCard = memo(forwardRef<HTMLDivElement, QuestionCardProps>(function QuestionCard(
  { question, selectedOption, isAnswered, onSelect, onToggleFavorite, theme, settings },
  ref,
) {
  const optionFontKey = settings.fontSize === 'large' ? 'large' : 'normal';
  // PERF: soru metninden şık satırlarını ayıklama — her render'da değil, sadece soru değişince
  const cleanedQuestion = useMemo(
    () => question.question.split('\n').filter(l => !OPTION_LINE_RE.test(l.trim())).join('\n'),
    [question.question],
  );
  // PERF: options entries stable reference
  const optionEntries = useMemo(
    () => Object.entries(question.options) as [string, string][],
    [question.options],
  );
  return (
    <div ref={ref} className={`flex-1 flex flex-col overflow-y-auto ${theme.card} p-5 sm:p-6 rounded-2xl custom-scrollbar overflow-x-hidden`}>
      <div className="flex items-start justify-between gap-4 mb-6">
        <p className={`${fontSizes[settings.fontSize]} leading-relaxed font-medium transition-[font-size,line-height] duration-300`}>
          {cleanedQuestion}
        </p>
        <button
          onClick={() => onToggleFavorite(question.id)}
          className={`p-3 rounded-xl transition-all duration-300 shrink-0 ${
            question.is_favorite
              ? `${semanticColors.gold.bg} ${semanticColors.gold.text} scale-105 shadow-lg shadow-amber-400/10`
              : `${theme.inputBg} ${semanticColors.gold.text} opacity-50 hover:opacity-100 hover:${semanticColors.gold.bg}`
          }`}
        >
          <Star size={20} className={question.is_favorite ? 'fill-current' : ''} />
        </button>
      </div>
      <div className="space-y-2">
        {optionEntries.map(([key, text]) => {
          const sel = selectedOption === key;
          const ok = question.correctAnswer === key;
          let cl = `w-full text-left p-4 rounded-xl transition-all duration-300 flex items-center gap-4 border `;
          if (!isAnswered) cl += `border-transparent ${theme.inputBg} hover:bg-white/[0.04] hover:border-white/[0.08] active:scale-[0.98]`;
          else if (ok) cl += `${semanticColors.correct.border} ${semanticColors.correct.bg}`;
          else if (sel) cl += `${semanticColors.incorrect.border} ${semanticColors.incorrect.bg}`;
          else cl += 'border-transparent opacity-20';
          return (
            <button key={key} disabled={isAnswered} onClick={() => onSelect(key)} className={cl}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-[13px] shrink-0 transition-colors duration-300 ${
                !isAnswered ? 'bg-white/[0.08] text-white/70' 
                : ok ? `${semanticColors.correct.solid} text-[#000000]` 
                : sel ? `${semanticColors.incorrect.solid} text-[#000000]` 
                : 'bg-white/[0.04] text-white/30'
              }`}>{key}</div>
              <span className={`${fontSizes[optionFontKey]} opacity-90 leading-snug`}>{text}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}));
