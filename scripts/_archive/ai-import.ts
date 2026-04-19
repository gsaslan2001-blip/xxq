import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: '.env.local' });

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
    console.error("HATA: OPENAI_API_KEY .env.local dosyasında bulunamadı.");
    process.exit(1);
}

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
    console.error("HATA: VITE_SUPABASE_URL veya VITE_SUPABASE_ANON_KEY bulunamadı.");
    process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

const MODEL_NAME = process.env.OPENAI_MODEL ?? 'gpt-4o';
const EMBED_MODEL = 'text-embedding-3-small';

const pdfPath = process.argv[2];
const lessonParamRaw = process.argv[3];
const unitParamRaw = process.argv[4];

if (!pdfPath || !lessonParamRaw || !unitParamRaw) {
    console.error("Kullanım: npx tsx scripts/_archive/ai-import.ts <pdf-yolu> <ders-adı> <ünite-adı>");
    process.exit(1);
}

function sanitizePromptArg(raw: string | undefined | null, fieldName: string): string {
    if (raw === undefined || raw === null) {
        console.error(`HATA: ${fieldName} argümanı eksik.`);
        process.exit(1);
    }
    const normalized = raw.normalize('NFKC');
    const sanitized = normalized
        .replace(/[`"\\]/g, '')
        .replace(/\$\{/g, '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/[<>]/g, '')
        .trim()
        .slice(0, 80);
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

function buildMasterPrompt(lesson: string, unit: string): string {
    return MASTER_PROMPT_TEMPLATE
        .replace(/__LESSON__/g, lesson)
        .replace(/__UNIT__/g, unit);
}

function extractJson(text: string): string {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]?.trim().startsWith('[')) return fenced[1].trim();
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
        return text.slice(firstBracket, lastBracket + 1).trim();
    }
    return text.trim();
}

async function main() {
    const openai = new OpenAI({ apiKey });
    let uploadedFileId = '';

    try {
        console.log("PDF OpenAI'ye yükleniyor...");
        const uploadedFile = await openai.files.create({
            file: fs.createReadStream(pdfPath),
            purpose: 'user_data',
        });
        uploadedFileId = uploadedFile.id;
        console.log(`PDF başarıyla yüklendi: ${uploadedFileId}`);

        console.log(`Model: ${MODEL_NAME} — analiz ve soru üretimi başlıyor...`);
        const MASTER_PROMPT = buildMasterPrompt(lessonParam, unitParam);

        const RETRIABLE_STATUSES = [429, 500, 502, 503, 504];

        const callWithRetry = async (): Promise<string> => {
            let retries = 10;
            let waitTime = 20000;
            while (retries > 0) {
                try {
                    const response = await (openai as any).responses.create({
                        model: MODEL_NAME,
                        input: [{
                            role: 'user',
                            content: [
                                { type: 'input_file', file_id: uploadedFileId },
                                { type: 'input_text', text: MASTER_PROMPT },
                            ],
                        }],
                        max_output_tokens: 32768,
                    });
                    return response.output_text ?? '';
                } catch (err: any) {
                    const status: number | undefined = err.status;
                    if (status !== undefined && RETRIABLE_STATUSES.includes(status)) {
                        const retryAfterMs = err.headers?.['retry-after']
                            ? Number(err.headers['retry-after']) * 1000
                            : null;
                        const actualWait = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : waitTime;
                        console.log(`Geçici hata (${status}), ${actualWait / 1000}s sonra tekrar... (Kalan: ${retries - 1})`);
                        await new Promise(resolve => setTimeout(resolve, actualWait));
                        waitTime = Math.min(waitTime + 10000, 120000);
                        retries--;
                    } else {
                        throw err;
                    }
                }
            }
            throw new Error('Üretim başarısız oldu: OpenAI API sürekli hata veriyor.');
        };

        const textResult = await callWithRetry();
        console.log("Yanıt alındı, JSON ayrıştırılıyor...");

        let questions: any[];
        try {
            questions = JSON.parse(extractJson(textResult));
        } catch (parseErr) {
            console.error("JSON parse hatası. İlk 500 karakter:", textResult.slice(0, 500));
            throw parseErr;
        }
        if (!Array.isArray(questions)) throw new Error("Gelen cevap dizi formatında (Array) değil!");
        console.log(`Toplam ${questions.length} soru ayrıştırıldı.`);

        // Inline embedding üretimi — 1536-dim, Supabase schema ile uyumlu
        console.log(`Embedding'ler üretiliyor (${EMBED_MODEL})...`);
        const semanticTexts = questions.map((q: any) =>
            `${q.question ?? ''} ${q.explanation ?? ''}`.trim()
        );
        let embeddings: number[][] = [];
        try {
            const embResp = await openai.embeddings.create({
                model: EMBED_MODEL,
                input: semanticTexts,
            });
            embeddings = embResp.data.map(item => item.embedding);
            console.log(`${embeddings.length} embedding üretildi (dim: ${embeddings[0]?.length ?? 0}).`);
        } catch (e) {
            console.warn(`⚠️ Embedding üretimi başarısız, sorular embeddingsiz eklenecek: ${e}`);
        }

        const rows = questions.map((q: any, i: number) => {
            const row: any = {
                lesson: q.lesson,
                unit: q.unit,
                question: q.question,
                option_a: q.options?.A ?? '',
                option_b: q.options?.B ?? '',
                option_c: q.options?.C ?? '',
                option_d: q.options?.D ?? '',
                option_e: q.options?.E ?? '',
                correct_answer: q.correctAnswer,
                explanation: q.explanation,
            };
            if (embeddings[i]) row.embedding = embeddings[i];
            return row;
        });

        console.log(`Supabase kaydı başlıyor...`);
        const { data, error } = await supabase.from('questions').insert(rows).select('id');
        if (error) {
            console.error("Supabase'e kayıt sırasında hata oluştu:");
            console.error(error);
            process.exit(1);
        }
        console.log(`TEBRİKLER! ${data.length} adet yeni DUS sorusu başarıyla sisteme eklendi.`);

    } catch (error) {
        console.error("BİR HATA OLUŞTU:", error);
        process.exit(1);
    } finally {
        if (uploadedFileId) {
            try {
                await openai.files.delete(uploadedFileId);
                console.log("Yüklenen PDF dosyası OpenAI'den temizlendi.");
            } catch {}
        }
    }
    process.exit(0);
}

main();
