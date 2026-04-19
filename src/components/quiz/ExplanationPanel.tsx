import { forwardRef, memo } from 'react';
import { CheckCircle2, XCircle, Sparkles, Loader2 } from 'lucide-react';
import type { Question } from '../../data';
import { semanticColors } from '../../theme';

export type ExplanationPanelProps = {
  question: Question;
  isAnswered: boolean;
  isCorrect: boolean;
  aiLoading: boolean;
  aiAnswer: string | null;
  onExplainAI: () => void;
};

/**
 * Doğru/yanlış rozeti + açıklama + AI çöz butonu. Extracted from App.tsx:1417-1440.
 */
export const ExplanationPanel = memo(forwardRef<HTMLDivElement, ExplanationPanelProps>(function ExplanationPanel(
  { question, isAnswered, isCorrect, aiLoading, aiAnswer, onExplainAI },
  ref,
) {
  return (
    <div ref={ref} className="flex-1 overflow-y-auto p-5 sm:p-6 custom-scrollbar font-sans transition-all duration-300">
      {isAnswered && (
        <div className="anim-slide-up">
          <div className={`flex items-center gap-4 mb-6 p-4 rounded-xl border border-transparent transition-all duration-300 ${
            isCorrect
              ? `${semanticColors.correct.bg} ${semanticColors.correct.text} shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_2px_8px_rgba(52,211,153,0.1)]`
              : `${semanticColors.incorrect.bg} ${semanticColors.incorrect.text} shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_2px_8px_rgba(248,113,113,0.1)]`
          }`}>
            {isCorrect ? <CheckCircle2 size={24} strokeWidth={2} /> : <XCircle size={24} strokeWidth={2} />}
            <div className="text-sm tracking-wide font-black uppercase text-opacity-90">{isCorrect ? 'HARİKA' : `YANLIŞ: ${question.correctAnswer}`}</div>
          </div>
          <div className="prose-custom opacity-90 leading-relaxed font-medium transition-opacity duration-300">{question.explanation}</div>
          <button
            onClick={onExplainAI}
            disabled={aiLoading && !aiAnswer}
            className={`mt-8 w-full py-4 ${semanticColors.purple.bg} border-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] rounded-2xl flex items-center justify-center gap-3 ${semanticColors.purple.text} hover:opacity-80 transition-all font-bold text-sm tracking-wide disabled:opacity-40 disabled:scale-100 disabled:cursor-not-allowed active:scale-[0.98]`}
          >
            {aiLoading && !aiAnswer
              ? <><Loader2 size={18} className="animate-spin" /> ANALİZ EDİLİYOR…</>
              : <><Sparkles size={18} fill="currentColor" className="opacity-80" /> {aiAnswer ? 'AI ÇÖZÜMÜ GÖSTER' : 'AI İLE ADIM ADIM ÇÖZÜM'}</>
            }
          </button>
        </div>
      )}
    </div>
  );
}));
