import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load env vars
dotenv.config({ path: '.env.local' });

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("HATA: GEMINI_API_KEY .env.local dosyasında bulunamadı.");
    process.exit(1);
}

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
    console.error("HATA: VITE_SUPABASE_URL veya VITE_SUPABASE_ANON_KEY bulunamadı.");
    process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// AUDIT: G3 — Model string env var'dan oku, hardcode kaldırıldı
const MODEL_NAME = process.env.GEMINI_MODEL ?? 'gemini-2.5-pro-preview-05-06';

// Parse args
const pdfPath = process.argv[2];
const lessonParamRaw = process.argv[3];
const unitParamRaw = process.argv[4];

if (!pdfPath || !lessonParamRaw || !unitParamRaw) {
    console.error("Kullanım: npx tsx scripts/ai-import.ts <pdf-yolu> <ders-adı> <ünite-adı>");
    process.exit(1);
}

// AUDIT: K3 — Prompt injection guard güçlendirildi
function sanitizePromptArg(raw: string | undefined | null, fieldName: string): string {
    if (raw === undefined || raw === null) {
        console.error(`HATA: ${fieldName} argümanı eksik.`);
        process.exit(1);
    }
    // Unicode homograph saldırılarını normalize et
    const normalized = raw.normalize('NFKC');
    const sanitized = normalized
        .replace(/[`"\\]/g, '')
        .replace(/\$\{/g, '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/[<>]/g, '')          // HTML injection önle
        .trim()
        .slice(0, 80);                  // Ünite adları 80 karakterden uzun olmaz
    if (!sanitized) {
        console.error(`HATA: ${fieldName} temizleme sonrası boş kaldı.`);
        process.exit(1);
    }
    console.log(`[sanitize] ${fieldName}: "${sanitized}"`);
    return sanitized;
}

const lessonParam = sanitizePromptArg(lessonParamRaw, 'ders-adı');
const unitParam = sanitizePromptArg(unitParamRaw, 'ünite-adı');

if (!fs.existsSync(pdfPath)) {
    console.error(`HATA: Dosya bulunamadı -> ${pdfPath}`);
    process.exit(1);
}

// AUDIT: K3 — Template literal yerine replace pattern kullan (prompt injection riski azaltılır)
const MASTER_PROMPT_TEMPLATE = `# ROL
Sen bir DUS (Diş Uzmanlık Sınavı) soru yazarısın. ÖSYM sınav komisyonunda 15 yıl görev yapmış, ölçme-değerlendirme doktoralı, klinik diş hekimliği formasyonlu bir uzmansın. Soru yazarken şu zihniyeti benimsiyorsun: "Ezber değil mekanizma, tanım değil klinik korelasyon, tekil bilgi değil entegrasyon."

# GİZLİ ANALİZ PROTOKOLÜ (Chain of Thought)
Soruları üretmeden ÖNCE, bilişsel planlamanı MUTLAKA <analiz> ... </analiz> XML etiketleri içine yaz. Bu etiketin içinde şunları yap:

1. Kaynak metni tara, en yüksek verimli (high-yield) konseptleri listele.
2. Her konsepti bir Bloom basamağı ve zorluk seviyesiyle eşleştir.
3. Toplam konsept sayısını hesapla. Her bağımsız high-yield konsept MAKSIMUM 2-3 soru üretebilir. Konsept sayısı x 2 < 30 ise, soru sayısını konsept sayısı x 2 olarak sınırla ve kullanıcıya bildir.
4. Distraktör tasarımını planla: her soru için "hangi kavram yanılgısını hedefliyorum?" sorusunu cevapla.
5. Kaynak metinde bu sorunun dayandığı spesifik bilgiyi referansla (gizli grounding).
6. Doğru cevap dağılımını kontrol et (A-E arası 5-7 kez, art arda 3+ aynı şık YASAK).
7. Bloom taksonomisi dağılımını yüzde olarak hesapla: Hatırlama %15-20, Anlama %25-30, Uygulama %25-30, Analiz %15-20, Değerlendirme %5-10. Sapma varsa soruları yeniden kalibre et.
8. Klinik senaryo oranını kontrol et: Toplam soruların MINIMUM %25'i tam klinik senaryo formatında (yaş + cinsiyet + şikayet + muayene bulgusu) OLMALI. Eksikse batch planını revize et.

Bu etiketin içindeki yazılar senin karalama defterindir. Kullanıcı bu etiketin içini görmez. CEVAP ANAHTARINI BU ETİKET İÇİNE ASLA YAZMA — sızma riski var. Soruları ancak bu planlamayı bitirdikten sonra, etiket dışına yazmaya başla.

# SORU ÜRETİM KURALLARI

## A. ZORLUK AĞIRLIK MERKEZLERİ (30 soruluk set)

### Batch 1 (Soru 1-10): Temel-Orta
- 2-3 soru seviye 1-2 (tanım/hatırlama)
- 5-6 soru seviye 2-3 (mekanizma/uygulama)
- 1-2 soru seviye 3-4 (klinik uygulama/karşılaştırma)
- MINIMUM 2 tam klinik senaryo

### Batch 2 (Soru 11-20): Orta-Zor
- 1-2 soru seviye 2 (mekanizma)
- 5-6 soru seviye 3 (klinik uygulama)
- 2-3 soru seviye 4 (karşılaştırma/ayırıcı tanı)
- MINIMUM 3 tam klinik senaryo

### Batch 3 (Soru 21-30): Zor-Entegrasyon
- 2-3 soru seviye 3 (klinik uygulama)
- 4-5 soru seviye 4 (karşılaştırma/çoklu veri)
- 2-3 soru seviye 5 (çoklu konsept entegrasyonu — kaynak içi; branşlar arası entegrasyon SADECE kaynak çoklu branş içeriyorsa uygulanır)
- MINIMUM 3 tam klinik senaryo

## B. SORU FORMAT DAĞILIMI (30 soruluk set — yaklaşık hedefler)
- Doğrudan bilgi: 6-8 soru — "Aşağıdakilerden hangisi X'dir?" — kök MAKSIMUM 2 cümle
- Negatif soru: 6-8 soru — "yanlıştır / değildir / en az olası" — anahtar kelime MUTLAKA **kalın** markdown, istisna KABUL EDİLMEZ
- Klinik senaryo: 8-10 soru — Yaş, cinsiyet, şikayet, muayene bulgusu, radyografi — kök MAKSIMUM 5 cümle, her cümle kritik veri taşıyacak
- Kombine (I/II/III/IV): 4-5 soru — Öncüllü format
- Karşılaştırma/Sıralama: 1-2 soru — Büyükten küçüğe, önce-sonra

## C. SORU KÖK UZUNLUĞU KISITLAMASI
- Doğrudan bilgi ve negatif sorularda: MAKSIMUM 2-3 cümle. Dekoratif bilgi YASAK.
- Klinik senaryo sorularında: MAKSIMUM 5 cümle. Her cümle cevaba katkı sağlamalı.
- "Doğrusu hangisi / yanlışı hangisi" formatındaki genel tarama soruları MINIMUM düzeyde tutulacak (30 soruda MAKSIMUM 3 adet).

## D. BLOOM TAKSONOMİSİ DAĞILIMI
- Hatırlama: %15-20
- Anlama: %25-30
- Uygulama: %25-30
- Analiz: %15-20
- Değerlendirme: %5-10

## E. 2025 GÜNCEL SINAV TRENDLERİ
2025 DUS sınavlarında tespit edilen değişiklikler — soru üretiminde bunları yansıt:
- Klinik senaryo uzunluğu kısalmış ama yoğunluğu artmış. Her cümle kritik veri taşıyor. Gereksiz anamnez bilgisi yok.
- "En az olası" formatı yaygınlaşmış. "En olası" yerine "en az olası" sorarak ters düşünme becerisi test ediliyor.
- Kombine (I/II/III/IV) format artışı.
- Tanı-tedavi birlikte sorulma trendi. "En olası tanı VE tedavi aşağıdakilerin hangisinde birlikte verilmiştir?"

# ŞIK (DİSTRAKTÖR) YAZIM KURALLARI — KRİTİK

## Altın Kural
Doğru cevabı bilmeyen ama konuyu yüzeysel bilen biri, en az 2 şıkta kararsız kalmalı.

## Zorunlu Kurallar
1. **Homojenite:** Tüm şıklar aynı kategoriden. Enzimse hepsi enzim, sinirse hepsi sinir, ilaçsa hepsi aynı gruptan ilaç.
2. **Komşuluk tuzağı:** Distraktörler doğru cevapla aynı anatomik bölge / fizyolojik sistem / ilaç sınıfından seçilecek.
3. **Yaygın yanılgı hedefleme:** En az 1 distraktör, öğrencilerin sıkça karıştırdığı kavramı içerecek.
4. **Bariz eleme yasağı:** Hiçbir şık konu dışı veya absürt olmayacak.
5. **Uzunluk tutarlılığı:** Doğru cevap diğerlerinden belirgin şekilde uzun/kısa OLMAYACAK.
6. **Doğru cevap dağılımı:** 30 soruda A-E her şık 5-7 kez doğru cevap olacak. Rastgele dağıt.
7. **"Hepsi doğru/yanlış" şıkkı YASAK.**
8. **Aynı şık art arda 3+ kez doğru cevap OLMAYACAK.**

# KAYNAK ÇAPALAMA (Grounding) KURALI
- Her soruyu yazarken, kaynak metinde bu sorunun referans aldığı spesifik cümle/kavramı zihninde kilitle.
- Sorunun hiçbir kelimesi kaynak metnin kapsamı dışına çıkamaz.
- Eğer kaynak metin 30 kaliteli soru üretmek için yeterli derinlikte DEĞİLSE, zorlama soru üretme. "Kaynak metin X adet nitelikli soru üretmeye uygundur" de ve sayıyı optimize et. Formül: Her bağımsız high-yield konsept MAKSIMUM 2-3 soru. Konsept sayısı x 2 < hedef soru sayısı ise soru sayısını düşür.
- Model kendi genel tıp veritabanından bilgi ekleme eğilimindedir — bu YASAK. SADECE verilen kaynaktan soru üret.

# ÇIKTI FORMATI — KESİN KURALLAR

## Tek Mesajda Tamamlama
Tüm soruları, doğru cevapları ve açıklamaları TEK MESAJDA üret. Kullanıcıdan cevap BEKLEME. Etkileşimli aşama YOK.

## JSON Yapısı
Çıktı SADECE aşağıdaki JSON dizisi formatında olacak. JSON dışında AÇIKLAMA, GİRİŞ CÜMLESİ veya KAPANIŞ METNİ YAZMA.
HER SORU İÇİN lesson DEĞERİ: "__LESSON__" VE unit DEĞERİ: "__UNIT__" OLARAK AYARLANMALIDIR.

\`\`\`json
[
  {
    "lesson": "__LESSON__",
    "unit": "__UNIT__",
    "question": "Soru metni...",
    "options": {
      "A": "Seçenek A",
      "B": "Seçenek B",
      "C": "Seçenek C",
      "D": "Seçenek D",
      "E": "Seçenek E"
    },
    "correctAnswer": "A",
    "explanation": "3-4 cümlelik açıklama..."
  }
]
\`\`\`
`;

// AUDIT: K3 — placeholder'ları güvenli replace ile doldur
function buildMasterPrompt(lesson: string, unit: string): string {
    return MASTER_PROMPT_TEMPLATE
        .replace(/__LESSON__/g, lesson)
        .replace(/__UNIT__/g, unit);
}

async function main() {
    let tempPath = "";
    try {
        const ai = new GoogleGenAI({ apiKey: apiKey });

        if (!fs.existsSync(pdfPath)) {
            console.error(`HATA: Dosya bulunamadı -> ${pdfPath}`);
            process.exit(1);
        }

        tempPath = path.join(process.cwd(), `temp_upload_${Date.now()}.pdf`);
        fs.copyFileSync(pdfPath, tempPath);

        console.log("PDF Gemini'ye yükleniyor...");
        const file = await ai.files.upload({ file: tempPath, mimeType: 'application/pdf' });
        console.log(`PDF başarıyla yüklendi: ${file.name}`);

        console.log("Model analiz ve soru üretimini tek aşamada gerçekleştiriyor (Master Prompt)...");
        // AUDIT: G3 — model env var'dan gelir
        console.log(`Model: ${MODEL_NAME}`);

        // AUDIT: G3 — başlangıçta model validasyonu (list erişimi olmayabilir, sessiz geç)
        try {
            const modelList = await ai.models.list();
            const modelBase = MODEL_NAME.split('-preview')[0];
            const valid = modelList.models?.some((m: { name?: string }) => m.name?.includes(modelBase));
            if (!valid) console.warn(`UYARI: Model '${MODEL_NAME}' listede bulunamadı. Devam ediliyor.`);
        } catch { /* list erişimi kısıtlı olabilir */ }

        const chat = ai.chats.create({
            model: MODEL_NAME,
            config: {
                temperature: 0.1,
                maxOutputTokens: 32768,
            }
        });

        const RETRIABLE_STATUSES = [429, 500, 502, 503, 504];
        const sendMessageWithRetry = async (msg: any, stage: string) => {
            let retries = 10;
            let waitTime = 20000;
            while (retries > 0) {
                try {
                    return await chat.sendMessage({ message: msg });
                } catch (err: any) {
                    const status: number | undefined = err.status ?? err.code;
                    const msgStr: string = err.message || '';
                    const matchedStatus = RETRIABLE_STATUSES.find(
                        (s) => status === s || msgStr.includes(String(s))
                    );
                    if (matchedStatus) {
                        // Retry-After header (saniye) varsa ona uy
                        const retryAfterRaw = err.headers?.['retry-after'] ?? err.retryAfter;
                        const retryAfterMs = retryAfterRaw ? Number(retryAfterRaw) * 1000 : null;
                        const actualWait = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : waitTime;
                        console.log(`${stage}: Geçici hata (${matchedStatus}), ${actualWait/1000}s sonra tekrar... (Kalan: ${retries-1})`);
                        await new Promise(resolve => setTimeout(resolve, actualWait));
                        waitTime = Math.min(waitTime + 10000, 120000);
                        retries--;
                    } else {
                        throw err;
                    }
                }
            }
            throw new Error(`${stage} başarısız oldu: Gemini API sürekli hata veriyor.`);
        };

        const MASTER_PROMPT = buildMasterPrompt(lessonParam, unitParam);
        const response = await sendMessageWithRetry([
            { fileData: { fileUri: file.uri, mimeType: file.mimeType } },
            MASTER_PROMPT
        ], "Üretim Aşaması");

        console.log("Yanıt alındı, JSON ayrıştırılıyor...");
        const textResult: string = response.text ?? '';

        // JSON Extract logic — non-greedy, çoklu strateji
        function extractJson(text: string): string {
            // 1) ```json ... ``` code bloğu (non-greedy)
            const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
            if (fenced && fenced[1] && fenced[1].trim().startsWith('[')) {
                return fenced[1].trim();
            }
            // 2) İlk '[' ile son ']' arası (JSON array)
            const firstBracket = text.indexOf('[');
            const lastBracket = text.lastIndexOf(']');
            if (firstBracket !== -1 && lastBracket > firstBracket) {
                return text.slice(firstBracket, lastBracket + 1).trim();
            }
            return text.trim();
        }

        let questions: any;
        try {
            questions = JSON.parse(extractJson(textResult));
        } catch (parseErr) {
            console.error("JSON parse hatası. İlk 500 karakter:", textResult.slice(0, 500));
            throw parseErr;
        }
        if (!Array.isArray(questions)) throw new Error("Gelen cevap dizi formatında (Array) değil!");

        console.log(`Toplam ${questions.length} soru ayrıştırıldı. Supabase kaydı başlıyor...`);

        const rows = questions.map((q: any) => ({
            lesson: q.lesson,
            unit: q.unit,
            question: q.question,
            option_a: q.options.A,
            option_b: q.options.B,
            option_c: q.options.C,
            option_d: q.options.D,
            option_e: q.options.E,
            correct_answer: q.correctAnswer,
            explanation: q.explanation,
        }));

        const { data, error } = await supabase.from('questions').insert(rows).select('id');
        if (error) {
            console.error("Supabase'e kayıt sırasında hata oluştu:");
            console.error(error);
            process.exit(1);
        }

        console.log(`TEBRİKLER! ${data.length} adet yeni DUS sorusu başarıyla sisteme eklendi.`);

        try {
            await ai.files.delete({ name: file.name });
            console.log("Ön bellek temizlendi.");
        } catch (e) { }

    } catch (error) {
        console.error("BİR HATA OLUŞTU:", error);
        // AUDIT: K5 — başarısız üretimde exit(1) kullan, batch-import bunu yakalar
        if (tempPath && fs.existsSync(tempPath)) {
            try { fs.unlinkSync(tempPath); } catch {}
        }
        process.exit(1);
    }
    // AUDIT: K5 — sadece gerçek başarıda exit(0)
    if (tempPath && fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
    }
    process.exit(0);
}

main();
