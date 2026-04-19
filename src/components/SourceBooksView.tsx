import { useState, useEffect } from 'react';
import { Upload, Trash2, BookOpen, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';
import {
  fetchReferenceSources,
  uploadReferenceSource,
  deleteReferenceSource,
  type ReferenceSource,
} from '../lib/supabase';
import type { Theme } from '../theme';
import type { Question } from '../data';

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

interface SourceBooksViewProps {
  questions: Question[];
  onBack: () => void;
  theme: Theme;
}

export function SourceBooksView({ questions, onBack, theme }: SourceBooksViewProps) {
  const [sources, setSources] = useState<ReferenceSource[]>([]);
  const [loading, setLoading] = useState(true);
  // Silme işlemi devam eden kaynak id'leri — her kart kendi loading'ini gösterir
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedLesson, setSelectedLesson] = useState<string>('');
  const [selectedUnit, setSelectedUnit] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);

  const lessons = Array.from(new Set(questions.map((q) => q.lesson))).sort();
  const units = selectedLesson
    ? Array.from(new Set(questions.filter((q) => q.lesson === selectedLesson).map((q) => q.unit))).sort()
    : [];

  useEffect(() => {
    loadSources();
  }, []);

  const loadSources = async () => {
    try {
      setLoading(true);
      const data = await fetchReferenceSources();
      setSources(data);
    } catch (err: any) {
      setError(err?.message || 'Kaynaklar yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    if (!selected) { setFile(null); return; }

    if (selected.size > MAX_FILE_BYTES) {
      setError(`Dosya çok büyük (${(selected.size / 1024 / 1024).toFixed(1)} MB). Maksimum 100 MB.`);
      setFile(null);
      e.target.value = '';
      return;
    }

    setError(null);
    setFile(selected);
  };

  const handleUpload = async () => {
    if (!file || !selectedLesson) return;

    if (file.size > MAX_FILE_BYTES) {
      setError('Dosya çok büyük. Maksimum 100 MB.');
      return;
    }

    try {
      setUploading(true);
      setError(null);

      const newSource = await uploadReferenceSource(file, selectedLesson, selectedUnit || null);
      setSources((prev) => [...prev, newSource]);

      setFile(null);
      setSelectedLesson('');
      setSelectedUnit('');
    } catch (err: any) {
      setError(err?.message || 'Yükleme başarısız');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (source: ReferenceSource) => {
    if (!confirm(`"${source.file_name}" adlı kaynağı silmek istediğinize emin misiniz?`)) return;

    setDeletingIds((prev) => new Set(prev).add(source.id));
    try {
      await deleteReferenceSource(source);
      setSources((prev) => prev.filter((s) => s.id !== source.id));
    } catch (err: any) {
      alert(err?.message || 'Silinemedi');
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full anim-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className={`p-2 rounded-xl hover:bg-white/[0.06] transition-all ${theme.subtext}`}>
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2 className="text-2xl font-black tracking-tight">AI Kaynak Kitaplar</h2>
          <p className={`${theme.subtext} text-xs mt-0.5`}>PDF yükleyerek AI Asistanı eğitin.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 flex-1 min-h-0">

        {/* SOL: YÜKLEME ALANI */}
        <div className={`col-span-1 ${theme.card} p-5 rounded-2xl flex flex-col overflow-y-auto`}>
          <h3 className="text-sm font-black mb-5">Yeni Kaynak Ekle</h3>

          <div className="space-y-3.5">
            <div>
              <label className={`${theme.subtext} text-[10px] font-bold tracking-widest uppercase block mb-1.5`}>DERS SEÇİMİ</label>
              <select
                value={selectedLesson}
                onChange={(e) => { setSelectedLesson(e.target.value); setSelectedUnit(''); }}
                className={`w-full ${theme.inputBg} p-3.5 rounded-xl text-sm border ${theme.border} input-ring transition-all`}
              >
                <option value="">Ders Seçin...</option>
                {lessons.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>

            {selectedLesson && (
              <div>
                <label className={`${theme.subtext} text-[10px] font-bold tracking-widest uppercase block mb-1.5`}>ÜNİTE (OPSİYONEL)</label>
                <select
                  value={selectedUnit}
                  onChange={(e) => setSelectedUnit(e.target.value)}
                  className={`w-full ${theme.inputBg} p-3.5 rounded-xl text-sm border ${theme.border} input-ring transition-all`}
                >
                  <option value="">Genel PDF</option>
                  {units.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className={`${theme.subtext} text-[10px] font-bold tracking-widest uppercase block mb-1.5`}>PDF DOSYASI</label>
              <div className={`border border-dashed ${theme.border} hover:border-indigo-500/30 transition-colors rounded-xl p-5 text-center relative group`}>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <BookOpen size={28} className={`mx-auto mb-2 ${file ? 'text-emerald-400' : `${theme.subtext} opacity-30 group-hover:text-indigo-400/50`}`} />
                <p className="text-xs font-bold truncate">
                  {file ? file.name : 'PDF Seç veya Sürükle'}
                </p>
                {file && (
                  <p className={`${theme.subtext} text-[10px] mt-0.5`}>
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                )}
                {!file && <p className={`${theme.subtext} text-[10px] mt-0.5`}>Maks 100 MB</p>}
              </div>
            </div>

            {error && (
              <div className="bg-red-500/8 text-red-400 p-3 rounded-xl text-[11px] flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={uploading || !file || !selectedLesson}
              className="btn btn-primary btn-lg w-full"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {uploading ? 'YÜKLENİYOR...' : 'SİSTEME YÜKLE'}
            </button>
          </div>
        </div>

        {/* SAĞ: MEVCUT KAYNAKLAR */}
        <div className={`col-span-1 md:col-span-2 ${theme.card} p-5 rounded-2xl flex flex-col overflow-hidden`}>
          <h3 className="text-sm font-black mb-5">Yüklü Kaynaklar ({sources.length})</h3>

          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 size={28} className="animate-spin text-indigo-400" />
              </div>
            ) : sources.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8 opacity-40">
                <BookOpen size={40} className="mb-3" />
                <p className="font-bold text-sm mb-0.5">Henüz PDF Yüklenmedi</p>
                <p className="text-[11px]">Sol panelden PDF yükleyin.</p>
              </div>
            ) : (
              sources.map(source => {
                const isDeleting = deletingIds.has(source.id);
                return (
                  <div
                    key={source.id}
                    className={`${theme.inputBg} border ${theme.border} rounded-xl p-3.5 flex items-center justify-between group hover:bg-white/[0.06] transition-colors ${isDeleting ? 'opacity-40' : ''}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-indigo-500/15 text-indigo-400 flex items-center justify-center shrink-0">
                        <BookOpen size={16} />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-xs truncate">{source.file_name}</div>
                        <div className={`${theme.subtext} text-[10px] font-medium truncate flex gap-1.5`}>
                          <span className="text-emerald-400">{source.lesson}</span>
                          {source.unit && <span>→ {source.unit}</span>}
                          {!source.unit && <span className="opacity-40">(Genel)</span>}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(source)}
                      disabled={isDeleting}
                      className="p-2 rounded-lg bg-red-500/8 text-red-400 opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500/20 shrink-0 disabled:cursor-not-allowed"
                      title="Sil"
                    >
                      {isDeleting
                        ? <Loader2 size={14} className="animate-spin" />
                        : <Trash2 size={14} />
                      }
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
