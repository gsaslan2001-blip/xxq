import { memo, useMemo } from 'react';
import { Sparkles, XCircle } from 'lucide-react';
import DOMPurify, { type Config as DOMPurifyConfig } from 'dompurify';
import { renderMarkdown } from '../../lib/markdown';

export type AIAssistantPanelProps = {
  visible: boolean;
  loading: boolean;
  error: string | null;
  answer: string | null;
  onClose: () => void;
  onRetry?: () => void;
};

/**
 * Slide-over glass AI tutor panel. Extracted from App.tsx:1355-1390.
 * PERF: renderMarkdown streaming sırasında her chunk'ta çağrılır — useMemo ile
 * `answer` değişmedikçe tekrar parse edilmez.
 */
// AUDIT: G1 — izin verilen HTML etiketleri kümesi (script/iframe/object yasak)
const PURIFY_CONFIG: DOMPurifyConfig = {
  ALLOWED_TAGS: ['p', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'pre', 'h1', 'h2', 'h3', 'br', 'span', 'blockquote'],
  ALLOWED_ATTR: ['class'],
};

export const AIAssistantPanel = memo(function AIAssistantPanel({ visible, loading, error, answer, onClose, onRetry }: AIAssistantPanelProps) {
  // AUDIT: G1 — dangerouslySetInnerHTML öncesi DOMPurify sanitize
  const html = useMemo(() => {
    if (!answer) return '';
    return String(DOMPurify.sanitize(renderMarkdown(answer), PURIFY_CONFIG));
  }, [answer]);
  return (
    <>
      {/* Mobil backdrop: panelin dışına tıklayınca kapanır */}
      {visible && (
        <div
          className="absolute inset-0 z-[79] lg:hidden bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      <div
        className={`absolute inset-0 lg:w-[420px] lg:right-0 lg:left-auto lg:h-full z-[80] bg-[#18181b] border border-white/[0.08] shadow-2xl shadow-black/50 transition-all duration-500 flex flex-col ${visible ? 'translate-x-0 opacity-100 pointer-events-auto' : 'translate-x-full opacity-0 pointer-events-none'} lg:rounded-2xl`}
        style={{ padding: '0' }}
      >
        {/* Header with accent line */}
        <div className="relative p-4 border-b border-white/[0.06] flex items-center justify-between shrink-0">
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-indigo-500/40 via-violet-500/40 to-transparent" />
          <div className="flex items-center gap-2 font-bold text-indigo-400 text-sm">
            <Sparkles size={16} /> AI Öğretmen
            {loading && <span className="text-[10px] font-medium text-white/30 ml-1 animate-pulse">yazıyor…</span>}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors">
            <XCircle size={16} className="opacity-40" />
          </button>
        </div>
        <div className="p-5 flex-1 overflow-y-auto custom-scrollbar text-sm leading-relaxed">
          {/* Yükleniyor — henüz hiç chunk gelmedi */}
          {loading && !answer && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center">
                <Sparkles size={24} className="text-indigo-400 anim-glow" />
              </div>
              <p className="font-bold opacity-40 text-xs">Kitabınız taranıyor ve<br />analiz yapılıyor…</p>
            </div>
          )}
          {/* Hata — AUDIT: R1 retry butonu */}
          {error && (
            <div className="bg-red-500/8 text-red-400 p-4 rounded-xl border border-red-500/15">
              <strong className="block mb-1 text-xs">Hata:</strong>
              <span className="text-xs">{error}</span>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="mt-3 btn btn-sm bg-red-500/15 text-red-400 hover:bg-red-500/25"
                >
                  Tekrar Dene
                </button>
              )}
            </div>
          )}
          {/* Streaming yanıt — renderMarkdown ile düzgün render */}
          {answer && (
            <div className="prose-custom" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      </div>
    </>
  );
});
