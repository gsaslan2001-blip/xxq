import os
import re

app_path = 'c:/Users/FURKAN/Desktop/Projeler/DUSBANKASI/src/App.tsx'
with open(app_path, 'r', encoding='utf-8') as f:
    text = f.read()

if 'toggleFavoriteInCloud' not in text:
    text = text.replace('import { supabase, fetchQuestions, importQuestions, deleteQuestion, deleteAllQuestions, deleteQuestionsInUnit, deleteQuestionsInLesson, renameLesson, renameUnit, type ImportQuestion } from \'./lib/supabase\';', 'import { supabase, fetchQuestions, importQuestions, deleteQuestion, deleteAllQuestions, deleteQuestionsInUnit, deleteQuestionsInLesson, renameLesson, renameUnit, type ImportQuestion, toggleFavoriteInCloud } from \'./lib/supabase\';')

text = re.sub(r'const \[favorites, setFavorites\] = useState<string\[\]>\(\[\]\);\n\s*useEffect\(\(\) => \{\n\s*const \w+ = localStorage\.getItem\(\'dus_favorites\'\);\n\s*if \(\w+\) setFavorites\(JSON\.parse\(\w+\)\);\n\s*\}, \[\]\);\n\s*useEffect\(\(\) => \{\n\s*localStorage\.setItem\(\'dus_favorites\', JSON\.stringify\(favorites\)\);\n\s*\}, \[favorites\]\);', '', text, flags=re.MULTILINE)

new_toggle_func = """  const handleToggleFavorite = async (id: string) => {
    const q = questions.find(x => x.id === id);
    if (!q) return;
    const newStatus = !q.is_favorite;
    try {
      await toggleFavoriteInCloud(id, newStatus);
      setQuestions(prev => prev.map(x => x.id === id ? { ...x, is_favorite: newStatus } : x));
    } catch (e) { console.error("Buluta kaydedilemedi", e); }
  };"""
text = re.sub(r'const handleToggleFavorite = \(id: string\) => \{\n\s*setFavorites\(.*\);\n\s*\};', new_toggle_func, text)

text = text.replace('favorites={favorites.filter(fid => questions.some(q => q.id === fid && q.lesson === lesson)).length}', 'favorites={questions.filter(q => q.lesson === lesson && q.is_favorite).length}')
text = text.replace('favorites={favorites.length}', 'favorites={questions.filter(q => q.is_favorite).length}')
text = text.replace('favorites.includes(question.id)', 'question.is_favorite')
text = text.replace('favorites: string[];', '')
text = text.replace('favorites={favorites} ', '')

# Add the explicit remove favorite text near the question box
text = text.replace(
    '<p className="text-[16px] leading-relaxed text-white font-medium"',
    '<p className="text-[17px] leading-relaxed text-white font-medium flex-1"'
)

text = text.replace(
    '<Star size={20} className={question.is_favorite ? "fill-black" : ""} strokeWidth={2.5} />\n            </button>',
    '<Star size={20} className={question.is_favorite ? "fill-black" : ""} strokeWidth={2.5} />\n              <span className="text-[11px] font-black tracking-wider uppercase ml-1.5 hidden sm:block">\n                {question.is_favorite ? "FAVORİLERDEN ÇIKAR" : "FAVORİYE EKLE"}\n              </span>\n            </button>'
)

with open(app_path, 'w', encoding='utf-8') as f:
    f.write(text)
print('App patched with text labels for favorites.')
