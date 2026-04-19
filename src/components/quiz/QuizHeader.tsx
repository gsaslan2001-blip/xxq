import { memo } from 'react';
import { Pencil, Flag, Trash2, FileText } from 'lucide-react';
import type { Question } from '../../data';
import type { AnswerDetail } from '../../types/app';

export type QuizHeaderProps = {
  currentIndex: number;
  total: number;
  isAnswered: boolean;
  mode?: 'quiz' | 'exam';
  unit: string;
  timedSeconds?: number;
  remainingSeconds: number;
  difficulty: string | null;
  question: Question;
  questions: Question[];
  answers: AnswerDetail[];
  questionLesson?: string;
  questionUnit?: string;
  onFinishEarly: (answers: AnswerDetail[]) => void;
  onExportPDF?: (qs: Question[], label: string) => void;
  onEditQuestion: (q: Question) => void;
  onReportQuestion: (q: Question) => void;
  onDeleteQuestion: (id: string) => void;
};

/** Quiz top bar — progress pill, optional countdown, action buttons. */
export const QuizHeader = memo(function QuizHeader({
  currentIndex, total, isAnswered, mode, unit,
  timedSeconds, remainingSeconds, difficulty, question, questions, answers,
  questionLesson, questionUnit,
  onFinishEarly, onExportPDF, onEditQuestion, onReportQuestion, onDeleteQuestion,
}: QuizHeaderProps) {
  return (
    <>
    <div className="flex items-center justify-between mb-2 shrink-0">
      <div className="flex items-center gap-2">
        <div className="px-2.5 h-7 bg-white/[0.04] rounded-lg border border-white/[0.06] flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full transition-colors ${isAnswered ? 'bg-emerald-400' : 'bg-indigo-400 animate-pulse'}`}></div>
          <span className="text-[10px] font-bold tracking-widest text-white/40 uppercase font-sans">{currentIndex + 1} / {total}</span>
        </div>
        {/* Simülasyon countdown */}
        {timedSeconds && timedSeconds > 0 && (
          <div className={`px-2.5 h-7 rounded-lg border flex items-center gap-1.5 font-sans ${
            remainingSeconds <= 600
              ? 'bg-red-500/10 border-red-500/20 text-red-400 animate-pulse'
              : 'bg-indigo-500/10 border-indigo-500/15 text-indigo-400'
          }`}>
            <span className="text-[10px] font-bold tracking-widest uppercase font-mono">
              ⏱ {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, '0')}
            </span>
          </div>
        )}
        {mode !== 'exam' && (
          <span className="text-[11px] text-white/20 truncate max-w-[200px] hidden sm:block font-sans">{unit}</span>
        )}
        <div className={`group relative px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider ${
          difficulty==='easy' ? 'text-emerald-400 bg-emerald-500/10'
          : difficulty==='medium' ? 'text-amber-400 bg-amber-500/10'
          : difficulty==='hard' ? 'text-red-400 bg-red-500/10'
          : 'text-white/20 bg-white/[0.04]'
        }`}>
          {difficulty || 'YENİ'}
          <div className="absolute bottom-full left-0 mb-2 w-48 p-2 bg-[#18181b] border border-white/10 rounded-lg text-[9px] font-medium leading-normal normal-case opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-[100] shadow-xl">
            FSRS-5 Zorluk Seviyesi: Soruyu çözme geçmişinize göre hesaplanmıştır.
          </div>
        </div>
      </div>
      <div className="flex gap-1.5">
        {mode === 'exam' && (
          <>
            <button onClick={() => onFinishEarly(answers)} className="btn btn-sm bg-red-500/10 text-red-400 border border-red-500/15 hover:bg-red-500/20">BİTİR</button>
            {onExportPDF && (
              <button onClick={() => onExportPDF(questions, 'Deneme Sınavı')} className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-white/30 hover:text-white transition-all" title="PDF İndir">
                <FileText size={13} />
              </button>
            )}
          </>
        )}
        <button onClick={() => onEditQuestion(question)} className="p-1.5 hover:bg-white/[0.06] rounded-lg opacity-25 hover:opacity-100 transition-all"><Pencil size={13} /></button>
        <button onClick={() => onReportQuestion(question)} className="p-1.5 hover:bg-white/[0.06] rounded-lg opacity-25 hover:opacity-100 transition-all"><Flag size={13} /></button>
        <button onClick={() => onDeleteQuestion(question.id)} className="p-1.5 hover:bg-red-500/15 text-red-400 rounded-lg opacity-25 hover:opacity-100 transition-all"><Trash2 size={13} /></button>
      </div>
    </div>
    {mode === 'exam' && questionLesson && questionUnit && (
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 bg-indigo-500/10 px-2 py-1 rounded-md">{questionLesson}</span>
        <span className="text-[10px] text-white/40">›</span>
        <span className="text-[10px] font-medium text-white/50 truncate max-w-[300px]">{questionUnit}</span>
      </div>
    )}
    </>
  );
});
