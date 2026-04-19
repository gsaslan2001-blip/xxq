import { useState, useEffect, useCallback, useRef } from 'react';
import type { Question } from '../../data';
import type { AnswerDetail, ActiveSessionInfo, UserSettings } from '../../types/app';
import type { Theme } from '../../theme';
import { saveQuestionStat, getDifficultyLabel } from '../../lib/stats';
import { useAIAssistant } from '../../hooks/useAIAssistant';
import { useExamTimer } from '../../hooks/useExamTimer';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { QuizHeader } from './QuizHeader';
import { QuestionCard } from './QuestionCard';
import { ExplanationPanel } from './ExplanationPanel';
import { QuizNavigation } from './QuizNavigation';
import { AIAssistantPanel } from '../ai/AIAssistantPanel';

export type QuizViewProps = {
  mode?: 'quiz' | 'exam';
  unit: string;
  questions: Question[];
  initialSession?: ActiveSessionInfo | null;
  onComplete: (answers: AnswerDetail[]) => void;
  onDeleteQuestion: (id: string) => void;
  onFinishEarly: (answers: AnswerDetail[]) => void;
  onToggleFavorite: (id: string) => void;
  onEditQuestion: (q: Question) => void;
  onReportQuestion: (q: Question) => void;
  onSaveSession?: (session: ActiveSessionInfo) => void;
  onExportPDF?: (qs: Question[], label: string) => void;
  timedSeconds?: number;
  onSimulationComplete?: (details: AnswerDetail[], usedSeconds: number) => void;
  theme: Theme;
  settings: UserSettings;
};

/**
 * Quiz/exam runner orchestrator. Composes hooks + subcomponents that used to live inline
 * inside App.tsx (lines ~1120-1451). Behavior preserved 1:1.
 */
export function QuizView({
  mode, unit, questions, initialSession,
  onComplete, onDeleteQuestion, onFinishEarly, onToggleFavorite,
  onEditQuestion, onReportQuestion, onSaveSession, onExportPDF,
  timedSeconds, onSimulationComplete, theme, settings,
}: QuizViewProps) {
  const [currentIndex, setCurrentIndex] = useState<number>(initialSession ? initialSession.currentIndex : 0);
  const [selectedOption, setSelectedOption] = useState<string | null>(
    initialSession?.answers?.[initialSession.currentIndex]?.selectedOptionKey ?? null
  );
  const [answers, setAnswers] = useState<AnswerDetail[]>(initialSession ? initialSession.answers : []);

  // AUDIT-01: answers'ın güncel kopyasını timer closure'dan ulaşmak için ref
  const answersRef = useRef<AnswerDetail[]>(initialSession ? initialSession.answers : []);
  // FIX: soru başına süre ölçümü — quiz mount'ta değil, her soru geçişinde reset
  const questionStartRef = useRef<number>(Date.now());
  const quizScrollRef = useRef<HTMLDivElement>(null);
  const explanationScrollRef = useRef<HTMLDivElement>(null);

  const question = questions[currentIndex];

  // AI assistant hook
  const ai = useAIAssistant(question);

  // Countdown timer (simulation mode only)
  const handleTimerExpire = useCallback((finalAnswers: AnswerDetail[], usedSeconds: number) => {
    if (onSimulationComplete) onSimulationComplete(finalAnswers, usedSeconds);
    else onComplete(finalAnswers);
  }, [onSimulationComplete, onComplete]);

  const { remainingSeconds } = useExamTimer(timedSeconds, questions, answersRef, handleTimerExpire);

  const isHistorized = currentIndex < answers.length;
  const isAnswered = selectedOption !== null || isHistorized;
  const isCorrect = question
    ? (isHistorized ? answers[currentIndex].state === 'correct' : selectedOption === question.correctAnswer)
    : false;
  const difficulty = question ? getDifficultyLabel(question.id) : null;

  const handleNext = useCallback((isSkip = false) => {
    if (!question) return;
    const timeSpent = Math.round((Date.now() - questionStartRef.current) / 1000);
    questionStartRef.current = Date.now();
    const newAnswers = [...answers];
    if (currentIndex >= answers.length) {
      const state: AnswerDetail['state'] = isSkip
        ? 'blank'
        : (selectedOption === question.correctAnswer ? 'correct' : 'incorrect');
      newAnswers.push({
        question,
        state,
        selectedOptionKey: isSkip ? null : selectedOption,
        timeSpent,
      });
      if (!isSkip) saveQuestionStat(question.id, state === 'correct', selectedOption);
    }
    answersRef.current = newAnswers;
    setAnswers(newAnswers);
    if (mode === 'exam') {
      onSaveSession?.({ questions, answers: newAnswers, currentIndex: currentIndex + 1, mode: 'exam' });
    }
    if (currentIndex < questions.length - 1) {
      const ni = currentIndex + 1;
      setCurrentIndex(ni);
      setSelectedOption(newAnswers[ni]?.selectedOptionKey ?? null);
      requestAnimationFrame(() => {
        quizScrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
        explanationScrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
        window.scrollTo({ top: 0, behavior: 'instant' });
      });
    } else {
      onComplete(newAnswers);
    }
  }, [selectedOption, question, currentIndex, answers, questions, mode, onSaveSession, onComplete]);

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      questionStartRef.current = Date.now();
      const pi = currentIndex - 1;
      setCurrentIndex(pi);
      setSelectedOption(answers[pi]?.selectedOptionKey ?? null);
      requestAnimationFrame(() => {
        quizScrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
        explanationScrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
        window.scrollTo({ top: 0, behavior: 'instant' });
      });
    }
  }, [currentIndex, answers]);

  const handleSkip = useCallback(() => handleNext(true), [handleNext]);
  const handleNextClick = useCallback(() => handleNext(false), [handleNext]);
  const handleFinishEarlyAdapter = useCallback((a: unknown[]) => onFinishEarly(a as AnswerDetail[]), [onFinishEarly]);
  const setShowAIPanel = ai.setShowPanel;
  const handleAIPanelClose = useCallback(() => setShowAIPanel(false), [setShowAIPanel]);

  useKeyboardShortcuts({
    onNext: handleNext,
    onPrev: handlePrevious,
    onSkip: handleSkip,
    setSelected: setSelectedOption,
    isAnswered,
    isHistorized,
  });

  // Sync answersRef whenever answers state changes (e.g., from initialSession)
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  if (!question) return <div className="p-10 text-center">Bitti!</div>;

  return (
    <div className="flex flex-col h-full anim-fade-in overflow-hidden relative font-serif">
      <QuizHeader
        currentIndex={currentIndex}
        total={questions.length}
        isAnswered={isAnswered}
        mode={mode}
        unit={unit}
        timedSeconds={timedSeconds}
        remainingSeconds={remainingSeconds}
        difficulty={difficulty}
        question={question}
        questions={questions}
        answers={answers}
        onFinishEarly={handleFinishEarlyAdapter}
        onExportPDF={onExportPDF}
        onEditQuestion={onEditQuestion}
        onReportQuestion={onReportQuestion}
        onDeleteQuestion={onDeleteQuestion}
      />

      <div className="flex-1 flex flex-col gap-3 overflow-hidden lg:flex-row relative">
        {/* -- AI TUTOR PANEL (Glassmorphism) -- */}
        <AIAssistantPanel
          visible={ai.showPanel}
          loading={ai.aiLoading}
          error={ai.aiError}
          answer={ai.aiAnswer}
          onClose={handleAIPanelClose}
        />

        <QuestionCard
          ref={quizScrollRef}
          question={question}
          selectedOption={selectedOption}
          isAnswered={isAnswered}
          onSelect={setSelectedOption}
          onToggleFavorite={onToggleFavorite}
          theme={theme}
          settings={settings}
        />

        {/* BUG-002: pointer-events-none yalnızca açıklama içeriğine uygulanır — nav butonları her zaman tıklanabilir */}
        <div className={`flex-1 flex flex-col ${theme.card} rounded-2xl overflow-hidden transition-all duration-500 ${isAnswered ? theme.shadow : ''}`}>
          <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-500 ${!isAnswered ? 'opacity-15 pointer-events-none' : 'opacity-100'}`}>
            <ExplanationPanel
              ref={explanationScrollRef}
              question={question}
              isAnswered={isAnswered}
              isCorrect={isCorrect}
              aiLoading={ai.aiLoading}
              aiAnswer={ai.aiAnswer}
              onExplainAI={ai.requestAI}
            />
          </div>
          {/* Nav butonları pointer-events-none dışında — ÖNCEKİ her zaman çalışır (BUG-002) */}
          <QuizNavigation
            currentIndex={currentIndex}
            total={questions.length}
            isAnswered={isAnswered}
            onPrev={handlePrevious}
            onSkip={handleSkip}
            onNext={handleNextClick}
          />
        </div>
      </div>
    </div>
  );
}
