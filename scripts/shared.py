"""
DUS Bankası — Paylaşılan Yardımcı Fonksiyonlar
Supabase CRUD, JSON parse, hata sınıflandırma, local checkpoint
"""
import json
import re
import os
import asyncio
import sys
import urllib.request
import urllib.parse
from datetime import datetime
from config import (
    SUPABASE_URL, SUPABASE_KEY, RECOVERY_DIR,
    REJECTED_DIR, MIN_STEM_WORDS, MAX_ANSWER_OVERLAP_RATIO,
    MAX_EXPL_OVERLAP_RATIO, OPENAI_API_KEY
)

try:
    from openai import OpenAI
    if OPENAI_API_KEY:
        openai_client = OpenAI(api_key=OPENAI_API_KEY)
    else:
        openai_client = None
except ImportError:
    openai_client = None

if sys.platform == "win32":
    try: sys.stdout.reconfigure(encoding='utf-8')
    except: pass


# ═══════════════════════════════════════════════
#  HATA SINIFLANDIRMASI
# ═══════════════════════════════════════════════

class RetryableError(Exception):
    """502, timeout, connection reset — exponential backoff ile tekrar dene."""
    pass

class AuthError(Exception):
    """401, 403, session expired — refresh_auth() sonra tek retry."""
    pass

class DataError(Exception):
    """JSON parse failure, empty response — local dump, sonraki üniteye geç."""
    pass

class FatalError(Exception):
    """Invalid notebook, dosya bulunamadı — pipeline durdurulur."""
    pass

def classify_error(e):
    """Exception'ı uygun hata sınıfına dönüştürür (isinstance öncelikli)."""
    # 1. Tip bazlı kontrol (en güvenilir)
    if isinstance(e, asyncio.TimeoutError):
        return RetryableError(str(e))
    if isinstance(e, json.JSONDecodeError):
        return DataError(str(e))
    if hasattr(e, 'code'):  # urllib.error.HTTPError
        if e.code in (502, 503, 504, 429):
            return RetryableError(str(e))
        elif e.code in (401, 403):
            return AuthError(str(e))
        elif e.code == 404:
            return FatalError(str(e))

    # 2. String fallback (bilinmeyen exception tipleri için)
    msg = str(e).lower()
    if any(k in msg for k in ["502", "503", "504", "timeout", "connection reset",
                                "connection aborted", "remotedisconnected", "urlerror"]):
        return RetryableError(str(e))
    elif any(k in msg for k in ["401", "403", "authentication", "expired", "redirected to"]):
        return AuthError(str(e))
    elif any(k in msg for k in ["json", "parse", "decode"]):
        return DataError(str(e))
    elif any(k in msg for k in ["not found", "invalid", "bulunamadı"]):
        return FatalError(str(e))
    else:
        return RetryableError(str(e))  # varsayılan: tekrar dene


# ═══════════════════════════════════════════════
#  JSON ÇIKARMA (Partial Repair dahil)
# ═══════════════════════════════════════════════

def extract_json(text):
    """AI çıktısından JSON bloğunu çeker. Partial repair destekler."""
    # AUDIT: K1 — boş/sadece etiket içeren yanıtlar için [] dön, None yerine
    if not text or not text.strip():
        print("   ⚠️ extract_json: Boş yanıt alındı.")
        return []

    # <analiz> etiketlerini temizle (içindeki {} karakterleri repair'ı bozabilir)
    text = re.sub(r'<analiz>[\s\S]*?</analiz>', '', text)

    # Etiket temizliği sonrası boş kaldıysa erken çık
    if not text.strip():
        print("   ⚠️ extract_json: Yanıt yalnızca <analiz> etiketi içeriyor.")
        return []

    def clean_and_parse(json_str):
        # trailing comma fix
        json_str = re.sub(r',\s*([\]}])', r'\1', json_str)
        return json.loads(json_str)

    def try_repair(json_str):
        """Truncated JSON'da kapanmamış objeleri kaldırır."""
        # Son kapanmamış { veya [ bul ve orada kes
        depth_brace = 0
        depth_bracket = 0
        last_valid = -1
        for i, c in enumerate(json_str):
            if c == '{': depth_brace += 1
            elif c == '}': depth_brace -= 1
            elif c == '[': depth_bracket += 1
            elif c == ']': depth_bracket -= 1
            # Tam bir obje kapandıysa ve array içindeysek, burası güvenli bir kesim noktası
            if depth_brace == 0 and depth_bracket == 1 and c == '}':
                last_valid = i

        if last_valid > 0:
            repaired = json_str[:last_valid + 1] + "]"
            try:
                return clean_and_parse(repaired)
            except Exception:
                pass
        return None

    try:
        # 1. Markdown bloğunu ara
        match = re.search(r'```(?:json)?\s*\n([\s\S]*?)\n```', text)
        if match:
            try:
                return clean_and_parse(match.group(1).strip())
            except Exception:
                # Partial repair dene
                repaired = try_repair(match.group(1).strip())
                if repaired:
                    print(f"   🔧 Partial JSON repair: {len(repaired)} soru kurtarıldı.")
                    return repaired

        # 2. Ham JSON dizisi
        match = re.search(r'\[\s*\{[\s\S]*\}\s*\]', text)
        if match:
            try:
                return clean_and_parse(match.group(0).strip())
            except Exception:
                repaired = try_repair(match.group(0).strip())
                if repaired:
                    print(f"   🔧 Partial JSON repair: {len(repaired)} soru kurtarıldı.")
                    return repaired

        # 3. Son çare: en geniş [ ... bul ve repair dene
        match = re.search(r'\[\s*\{[\s\S]*', text)
        if match:
            repaired = try_repair(match.group(0).strip())
            if repaired:
                print(f"   🔧 Truncated JSON repair: {len(repaired)} soru kurtarıldı.")
                return repaired

    except Exception as e:
        print(f"   ⚠️ JSON Parse Hatası: {e}")

    # AUDIT: K1 — parse tamamen başarısız, boş liste dön (exception raise etme)
    print("   ⚠️ extract_json: JSON çıkarılamadı, boş liste dönülüyor.")
    return []


# ═══════════════════════════════════════════════
#  LOCAL CHECKPOINT (Veri Kaybı Önleme)
# ═══════════════════════════════════════════════

def save_checkpoint(questions, lesson_name, unit_name, tag="pending"):
    """Supabase yazımı öncesi soruları metadata ile birlikte yerel dosyaya yazar."""
    safe_name = re.sub(r'[^\w\s-]', '', f"{lesson_name}_{unit_name}_{tag}")
    safe_name = safe_name.replace(" ", "_")
    filepath = os.path.join(RECOVERY_DIR, f"{safe_name}.json")
    envelope = {
        "lesson": lesson_name,
        "unit": unit_name,
        "questions": questions
    }
    try:
        os.makedirs(RECOVERY_DIR, exist_ok=True)
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(envelope, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"   ⚠️ Checkpoint yazılamadı ({filepath}): {e}")
        return None
    return filepath


def clear_checkpoint(filepath):
    """Supabase başarılı yazım sonrası checkpoint dosyasını siler."""
    try:
        if os.path.exists(filepath):
            os.remove(filepath)
    except Exception:
        pass


def replay_pending_checkpoints(lesson_filter=None):
    """recovery/pending/ klasöründeki tüm checkpoint'leri Supabase'e yazar."""
    pending = [f for f in os.listdir(RECOVERY_DIR) if f.endswith('.json')]
    if not pending:
        print("   Bekleyen checkpoint yok.")
        return

    print(f"   {len(pending)} adet bekleyen checkpoint bulundu.")
    for fname in pending:
        filepath = os.path.join(RECOVERY_DIR, fname)
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                envelope = json.load(f)

            # Metadata'yı JSON içinden oku (dosya adına bağımlı değil)
            lesson_name = envelope.get("lesson", "Unknown")
            unit_name = envelope.get("unit", "Unknown")
            questions = envelope.get("questions", envelope if isinstance(envelope, list) else [])

            if lesson_filter and lesson_filter.lower() not in lesson_name.lower():
                continue

            print(f"   🔄 Replay: {fname} ({len(questions)} soru) → {lesson_name}/{unit_name}")
            if _write_to_supabase(questions, lesson_name, unit_name):
                clear_checkpoint(filepath)
        except Exception as e:
            print(f"   ❌ Replay hatası ({fname}): {e}")


# ═══════════════════════════════════════════════
#  SUPABASE İŞLEMLERİ (Pagination + Checkpoint)
# ═══════════════════════════════════════════════

def supabase_get(endpoint):
    """Supabase REST GET isteği."""
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def get_existing_units(lesson_name):
    """Bir dersteki tüm üniteleri ve soru sayılarını döner (Pagination ile)."""
    encoded = urllib.parse.quote(lesson_name)
    all_data = []
    offset = 0
    limit = 1000
    while True:
        url = f"{SUPABASE_URL}/rest/v1/questions?select=unit&lesson=eq.{encoded}&limit={limit}&offset={offset}"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}"
        }
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read())
                all_data.extend(data)
                if len(data) < limit:
                    break
                offset += limit
        except Exception as e:
            print(f"Mevcut üniteler alınırken hata: {e}")
            break

    from collections import Counter
    counts = Counter(d.get('unit') for d in all_data if d.get('unit'))
    return dict(counts)


def get_questions_for_unit(lesson_name, unit_name):
    """Bir ünitedeki soruları döner (sadece fingerprint için gerekli sütunlar)."""
    encoded_lesson = urllib.parse.quote(lesson_name)
    encoded_unit = urllib.parse.quote(unit_name)
    return supabase_get(
        f"questions?select=question,correct_answer,option_a,option_b,option_c,option_d,option_e,explanation"
        f"&lesson=eq.{encoded_lesson}&unit=eq.{encoded_unit}"
    )


def _write_to_supabase(questions, lesson_name, unit_name):
    """Saf HTTP yazma — checkpoint yönetimi yapmaz. Başarılıysa True döner."""
    url = f"{SUPABASE_URL}/rest/v1/questions"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }

    rows = []
    semantic_texts = []
    for q in questions:
        semantic_texts.append(f"{q.get('question', '')} {q.get('explanation', '')}")
    
    embeddings = []
    if openai_client and semantic_texts:
        try:
            resp = openai_client.embeddings.create(
                model="text-embedding-3-small",
                input=semantic_texts
            )
            embeddings = [item.embedding for item in resp.data]
        except Exception as e:
            print(f"   ⚠️ OpenAI Embedding hatası (sorular embeddingsiz eklenecek): {e}")

    for i, q in enumerate(questions):
        opts = q.get("options", {})
        row = {
            "lesson": lesson_name,
            "unit": unit_name,
            "question": q.get("question", ""),
            "option_a": opts.get("A", ""),
            "option_b": opts.get("B", ""),
            "option_c": opts.get("C", ""),
            "option_d": opts.get("D", ""),
            "option_e": opts.get("E", ""),
            "correct_answer": q.get("correctAnswer", ""),
            "explanation": q.get("explanation", "")
        }
        if embeddings and i < len(embeddings):
            row["embedding"] = embeddings[i]
            
        rows.append(row)

    payload = json.dumps(rows, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        urllib.request.urlopen(req)
        print(f"   ✅ {len(rows)} soru Supabase'e yazıldı → [{unit_name}]")
        return True
    except Exception as e:
        print(f"   ❌ Supabase Hatası: {e}")
        return False


# ═══════════════════════════════════════════════
#  KALİTE GATE (Faz 1: Structural Validation)
# ═══════════════════════════════════════════════

def _validate_single_question(q):
    """
    Bir soruyu kalite filtrelerinden geçirir.
    Döner: (is_valid: bool, reason: str | None)
    """
    # Filtre 1.a — 5 şık tam mı?
    opts = q.get("options") or {}
    if not all(k in opts and isinstance(opts[k], str) and opts[k].strip() for k in ("A", "B", "C", "D", "E")):
        return False, "eksik_sik"

    # Filtre 1.b — correctAnswer A-E aralığında mı?
    ca = q.get("correctAnswer", "")
    if ca not in ("A", "B", "C", "D", "E"):
        return False, f"gecersiz_correctAnswer:{ca!r}"

    # Filtre 1.c — Soru kökü minimum kelime
    stem = (q.get("question") or "").strip()
    if not stem or len(stem.split()) < MIN_STEM_WORDS:
        return False, f"kisa_stem:{len(stem.split())}kelime"

    # Filtre 1.d — Explanation boş mu? (boş = düşük kalite)
    expl = (q.get("explanation") or "").strip()
    if not expl:
        return False, "bos_explanation"

    # Filtre 3 — Asimetrik Kapsama (Bilgi Sızıntısı / Information Leakage)
    correct_text = opts.get(ca, "")
    stem_tokens = _tokenize(stem)
    ca_tokens = _tokenize(correct_text)
    
    if len(ca_tokens) >= 3:
        intersection = len(ca_tokens & stem_tokens)
        overlap_ratio = intersection / len(ca_tokens)
        if overlap_ratio > MAX_ANSWER_OVERLAP_RATIO:
            return False, f"bilgi_sizintisi:overlap_{overlap_ratio:.2f}"

    # Filtre 4 — Zayıf Açıklama (Tautological Explanation)
    # Eğer açıklamada kendi anlamlı olan kelimelerin çoğu (örn >%50) zaten soru kökünden ibaretse,
    # bu açıklama yeni bilgi katmayan bir tekrardır.
    expl_tokens = _tokenize(expl)
    if len(expl_tokens) >= 5:
        intersection_expl = len(expl_tokens & stem_tokens)
        expl_overlap_ratio = intersection_expl / len(expl_tokens)
        if expl_overlap_ratio > MAX_EXPL_OVERLAP_RATIO:
            return False, f"zayif_aciklama:overlap_{expl_overlap_ratio:.2f}"

    return True, None


_TR_STOPWORDS = {
    "bir", "ve", "ile", "bu", "da", "de", "ki", "için", "olan", "bu", "şu", "o", "ne", "en", "daha", "çok", "az", "gibi",
    "kadar", "sonra", "önce", "göre", "biri", "her", "hiç", "hem", "ya",
    "veya", "ama", "fakat", "ancak", "değil", "mi", "mı", "mu", "mü",
    "var", "yok", "ise", "iken", "tarafından",
    "üzerinde", "altında", "içinde", "dışında", "arasında", "hangi",
    "nasıl", "neden", "nerede", "kim", "kimin", "buna", "bunu", "bunda",
    "bunun", "bunlar", "şuna", "şunu", "ona", "onu", "bunları", "şunları",
    "onları", "aşağıdaki", "aşağıda", "yukarıdaki", "hangisi", "birinde",
    "birini", "birinin", "hepsi", "tüm", "tamamı",
    "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", 
}

_TR_STOPWORDS_EK = {
    # Fiil çekimleri, yardımcı fiiller ve durum bildirenler
    "olur", "olmuş", "olmaz", "oluşur", "oluşan", "oluşmaz",
    "edilir", "edilmiş", "edilmez", "edilmektedir", "edilmelidir",
    "yapılır", "yapılmış", "yapılmaz", "yapılmaktadır", "yapılmalıdır",
    "görülür", "görülmüş", "görülmez", "görülmektedir",
    "alınır", "verilir", "geçer", "gider", "gelir",
    "alınmaktadır", "verilmektedir", "geçmektedir", "tutulmaktadır", "taşımaktadır", "sürmektedir",
    "kabul", "tanımlanır", "bilinir", "sayılır", "ifade", "belirtilen", "vurgulanan",
    "yardır", "izlenir", "saptanır", "tespit",
    "meydana", "gelir", "ortaya", "çıkar", "yer", "alır", "söz", "konusudur",
    "bilinmektedir", "düşünülmektedir", "belirtilmektedir", "vurgulanmaktedir", 
    "öngörülmektedir", "gerektirir", "sağlar", "içerir", "olmaktadır", "olunmaktadır",

    # Zaman, süreklilik ve zarf gürültüsü
    "artık", "hâlâ", "henüz", "zaten", "çoktan", "yalnızca", "sadece", "yani", "işte",
    "aslında", "esasen", "özünde", "temelde", "itibaren", "başlayarak", "süresince", 
    "sırasında", "sürecinde", "esnasında", "boyunca", "oldukça", "epey", "hayli", "pek", 
    "son", "derece", "fazlasıyla", "gayet", "nispeten", "görece", "kısmen", "tamamen", 
    "tümüyle", "büsbütün", "kesinlikle", "mutlaka", "zorunlu", "ağırlıklı", "büyük", "ölçüde",

    # Bağlaçlar ve geçiş ifadeleri
    "ne", "var", "ki", "buna", "karşın", "rağmen", "öte", "yandan", 
    "yanında", "yanı", "sıra", "ek", "açıdan", "bağlamda", 
    "doğrultuda", "şekilde", "biçimde", "ancak", "çünkü", "dolayısıyla",
    "sonucu", "sonucunda", "nedeniyle", "yoluyla", "olup", "olmak",

    # Derecelendirme ve miktar
    "temel", "ana", "asıl", "esas", "başlıca", "önemli", "kritik", "ciddi", 
    "belirgin", "belirli", "spesifik", "ilgili", "uygun", "bazı", "birkaç", 
    "birçok", "çeşitli", "az", "sayıda", "çoğunluğu", "bir", "kısmı", "bölümü", "diğer"
}

_ALL_STOPWORDS = _TR_STOPWORDS | _TR_STOPWORDS_EK

def _tokenize(text):
    """Küçük harfe çevirir, noktalama kaldırır, rakamları ve Türkçe gürültüsünü temizler, token seti döner."""
    text = text.lower()
    text = re.sub(r'[^\w\s]', ' ', text)
    text = re.sub(r'\d+', ' ', text) 
    return set(text.split()) - _ALL_STOPWORDS


def _asymmetric_similarity(a_tokens, b_tokens):
    """Kisa metnin ne kadari uzun metinde kapsiyor? (Overlap Coefficient)"""
    if not a_tokens or not b_tokens:
        return 0.0
    min_len = min(len(a_tokens), len(b_tokens))
    return len(a_tokens & b_tokens) / min_len if min_len > 0 else 0.0


# NOT: Kavramsal duplikasyon kontrolü POST-PRODUCTION aşamasına taşındı.
# Kullanım: python scripts/tools/smart_audit_pipeline.py --lesson <DersAdi>


def validate_question_batch(questions, lesson_name, unit_name):
    """
    Soru setini YAPISAL kalite filtrelerinden geçirir. Reddedilenleri REJECTED_DIR'a yazar.

    Filtre 1: Structural validation (stem, şık formatı, explanation varlığı)
    Filtre 3: Bilgi Sızıntısı — Doğru cevap %60'tan fazla soru kökünde geçiyorsa reddedilir
    Filtre 4: Zayıf Açıklama — Açıklamanın %50'si soru kökünü tekrarlıyorsa reddedilir

    NOT: Kavramsal duplikasyon (Filtre 2) artık post-production aşamasına taşındı.
         Tüm batch'ler bittikten sonra tek komutla temizlik:
         python scripts/tools/smart_audit_pipeline.py --lesson <DersAdi>

    Döner: (accepted: list, rejected: list)
    """
    accepted = []
    rejected = []

    for q in questions:
        ok, reason = _validate_single_question(q)
        if not ok:
            rejected.append({"question": q, "reason": reason})
            continue
        accepted.append(q)

    if rejected:
        safe_name = re.sub(r'[^\w\s-]', '', f"{lesson_name}_{unit_name}")
        safe_name = safe_name.replace(" ", "_")
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        filepath = os.path.join(REJECTED_DIR, f"{safe_name}_{ts}.json")
        envelope = {
            "lesson": lesson_name,
            "unit": unit_name,
            "rejected_at": datetime.now().isoformat(),
            "items": rejected,
        }
        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(envelope, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"   ⚠️ Reject log yazılamadı: {e}")

        # Konsolda özet
        reason_counts = {}
        for r in rejected:
            reason_counts[r["reason"]] = reason_counts.get(r["reason"], 0) + 1
        summary = ", ".join(f"{k}={v}" for k, v in reason_counts.items())
        print(f"   🚫 Kalite Gate: {len(rejected)}/{len(questions)} soru reddedildi ({summary}) → {filepath}")

    return accepted, rejected


def deploy_to_supabase(questions, lesson_name, unit_name):
    """Checkpoint wrapper: kalite gate → yerel yedek → Supabase yazımı."""
    # Faz 1: Kalite gate — düşük kalite soruları deploy öncesi filtrele
    accepted, _rejected = validate_question_batch(questions, lesson_name, unit_name)
    if not accepted:
        print(f"   ⚠️ Hiçbir soru kalite gate'i geçemedi — deploy atlandı: [{unit_name}]")
        return

    checkpoint_path = save_checkpoint(accepted, lesson_name, unit_name)
    if _write_to_supabase(accepted, lesson_name, unit_name):
        if checkpoint_path:
            clear_checkpoint(checkpoint_path)
    else:
        if checkpoint_path:
            print(f"   💾 Sorular yerel checkpoint'te korunuyor: {checkpoint_path}")
        else:
            print(f"   ⚠️ Supabase yazımı başarısız ve checkpoint kaydedilemedi: [{unit_name}]")
