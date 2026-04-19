import type { Question } from '../data';

export type AppState =
  | 'select-lesson'
  | 'select-unit'
  | 'quiz'
  | 'result'
  | 'import'
  | 'select-deneme'
  | 'select-deneme-amount'
  | 'select-favorites'
  | 'weak-questions'
  | 'analytics'
  | 'due-review'
  | 'simulation-setup'
  | 'simulation-result'
  | 'error-analysis'
  | 'smart-study'
  | 'daily-plan'
  | 'source-books';

export type AnswerDetail = {
  question: Question;
  state: 'correct' | 'incorrect' | 'blank';
  selectedOptionKey?: string | null;
  timeSpent?: number;
};

export type QuizStatsType = {
  correct: number;
  incorrect: number;
  blank: number;
  total: number;
  details: AnswerDetail[];
};

export type ActiveSessionInfo = {
  questions: Question[];
  answers: AnswerDetail[];
  currentIndex: number;
  mode: 'quiz' | 'exam';
};

export type UserSettings = {
  theme: 'dark' | 'oled' | 'light';
  fontSize: 'small' | 'normal' | 'large';
};
