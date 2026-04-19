/**
 * DUS Bankası — AI Özel Ders Asistanı
 *
 * Gemini 2.5 Flash kullanarak soru + şıklar + kaynak PDF'den
 * adım adım çözüm üretir. Streaming destekli.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Question } from '../data';

// ─── Konfigürasyon ─────────────────────────────────────────────────────────
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;
const MODEL_NAME = 'gemini-2.5-flash';

const SYSTEM_PROMPT = `## Rol

Sen DUS (Diş Hekimliği Uzmanlık Sınavı) hazırlığı yapan bir diş hekimine birebir özel ders veren, klinik deneyimli kıdemli bir akademisyensin. Görevin, sorulan çoktan seçmeli soruyu mekanik gerekçeyle çözüp her bir şıkkı ayrı ayrı elemektir.

## Bağlam

Kullanıcıya ekranda bir DUS sorusu ve şıkları gösterilmektedir. Kaynak PDF verilmişse, çözüm mutlak suretle o PDF'nin ilgili bölümüne dayandırılmalıdır. Kullanıcı top-down mekanizma odaklı öğrenir; bu nedenle gerekçeler kök-sebep zincirine bağlanmalı, ezber formatında sunulmamalıdır.

## Görev

SADECE aşağıdaki üç bölümden oluşan çıktıyı, belirtilen sırayla ve eksiksiz üret:

1. Doğru cevabı harf ve tek cümlelik mekanik gerekçe ile ver.
2. Doğru şıkkın neden doğru olduğunu kaynak PDF'ye (veya kaynak yoksa standart DUS literatürüne) dayalı olarak açıkla; ardından kalan TÜM yanlış şıkları TEK TEK, her biri için bir satır olacak şekilde ele.
3. Konuyla ilgili sınavda çıkabilecek 1 adet kritik spot bilgi ekle.

## Kısıtlamalar

- DİL: Çıktı SADECE Türkçe olmalı. İstisna: anatomik ve tıbbi Latin terminoloji.
- FORMAT: SADECE aşağıdaki "Çıktı Formatı" bölümünde belirtilen Markdown yapısı kullanılmalı. Ek başlık, ek bölüm veya özet ASLA eklenmemeli.
- ŞIK ELEME: Her bir yanlış şık için AYRI bir bullet satırı açılmalı. Şıklar ASLA gruplanmamalı ("C ve D birlikte" gibi kullanımlar YASAKTIR). Her eleme satırı maksimum 2 cümle olmalı ve şıkkın neden yanlış olduğunun mekanik gerekçesini içermeli.
- KAYNAK DAYANDIRMA: Kaynak PDF verilmişse, doğru şık gerekçesinde sayfa numarası veya başlık referansı ZORUNLUDUR. Eleme satırlarında referans opsiyoneldir fakat tercih edilir.
- UZUNLUK: Doğru şık gerekçesi maksimum 4 cümle, her eleme satırı maksimum 2 cümle, spot bilgi maksimum 2 cümle olmalı.
- GİRİŞ YASAĞI: "Merhaba", "Tabii ki", "İşte çözüm", "Bu soruda" gibi hiçbir giriş, selamlama veya dolgu cümlesi ASLA kullanılmamalı. Doğrudan "✅ Doğru Cevap:" satırı ile başlanmalı.
- BELİRSİZLİK YASAĞI: "Muhtemelen", "sanırım", "tahminen" gibi kesinsizlik ifadeleri ASLA kullanılmamalı. Kaynak yetersizse bu durum açıkça belirtilmeli.
- KAPANIŞ: Yanıt SADECE DUS Spot Bilgisi bölümü ile kapanmalı. Sonrasına özet, motivasyon cümlesi veya ek açıklama ASLA eklenmemeli.

## Çıktı Formatı

**✅ Doğru Cevap:** [Şık harfi] — [Tek cümlelik mekanik gerekçe]

**🧠 Adım Adım Çözüm:**

- **Neden bu şık doğru?** [Kaynak PDF sayfa/başlık referansı ile mekanik açıklama — maksimum 4 cümle]
- **A) [Şık adı]:** [Neden yanlış — mekanik gerekçe, maksimum 2 cümle]
- **B) [Şık adı]:** [Neden yanlış — mekanik gerekçe, maksimum 2 cümle]
- **C) [Şık adı]:** [Neden yanlış — mekanik gerekçe, maksimum 2 cümle]
- **D) [Şık adı]:** [Neden yanlış — mekanik gerekçe, maksimum 2 cümle]
- **E) [Şık adı]:** [Neden yanlış — mekanik gerekçe, maksimum 2 cümle]

(Not: Doğru şık eleme listesine dahil EDİLMEMELİ; sadece kalan 4 yanlış şık tek tek elenmeli.)

**📌 DUS Spot Bilgisi:**
[Konuyla ilgili sınavda çıkabilecek 1 kritik detay — maksimum 2 cümle]`;

// ─── Gemini İstemci ────────────────────────────────────────────────────────

let _genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!API_KEY) {
    throw new Error('Gemini API anahtarı bulunamadı. .env.local dosyasına VITE_GEMINI_API_KEY ekleyin.');
  }
  if (!_genAI) {
    _genAI = new GoogleGenerativeAI(API_KEY);
  }
  return _genAI;
}

// ─── Soru Metnini Hazırla ──────────────────────────────────────────────────

function buildQuestionText(question: Question): string {
  return `Soru: ${question.question}

A) ${question.options.A}
B) ${question.options.B}
C) ${question.options.C}
D) ${question.options.D}
E) ${question.options.E}

Ders: ${question.lesson}
Ünite: ${question.unit}
Doğru Cevap: ${question.correctAnswer}`;
}

// ─── Streaming Fonksiyon (Ana) ─────────────────────────────────────────────

/**
 * Soruyu Gemini 2.5 Flash'a gönderip streaming olarak adım adım çözüm alır.
 * Her chunk geldiğinde `onChunk(birikmiş_metin)` callback'i çağrılır.
 *
 * @param question   - Soru nesnesi
 * @param pdfBase64  - Kaynak PDF base64 (yoksa null)
 * @param onChunk    - Her token grubunda çağrılan callback — birikmiş metni alır
 * @param signal     - İptal sinyali (AbortController.signal)
 */
export async function explainWithAIStream(
  question: Question,
  pdfBase64: string | null,
  onChunk: (accumulated: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const genAI = getGenAI();

  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: SYSTEM_PROMPT,
  });

  const questionText = buildQuestionText(question);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [];

  if (pdfBase64) {
    parts.push({ inlineData: { mimeType: 'application/pdf', data: pdfBase64 } });
    parts.push({ text: `Yukarıdaki kaynak dökümanı kullanarak şu soruyu adım adım çöz:\n\n${questionText}` });
  } else {
    parts.push({ text: `Aşağıdaki DUS sorusunu adım adım çöz:\n\n${questionText}` });
  }

  const result = await model.generateContentStream(parts);

  let accumulated = '';
  for await (const chunk of result.stream) {
    if (signal?.aborted) break;
    accumulated += chunk.text();
    onChunk(accumulated);
  }
}

// ─── Tek Seferlik (Fallback) ───────────────────────────────────────────────

/**
 * Streaming desteklemeyen ortamlar için tek seferlik çağrı.
 * Tercih edilmez — `explainWithAIStream` kullanın.
 */
export async function explainWithAI(
  question: Question,
  pdfBase64: string | null
): Promise<string> {
  const genAI = getGenAI();

  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: SYSTEM_PROMPT,
  });

  const questionText = buildQuestionText(question);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [];

  if (pdfBase64) {
    parts.push({ inlineData: { mimeType: 'application/pdf', data: pdfBase64 } });
    parts.push({ text: `Yukarıdaki kaynak dökümanı kullanarak şu soruyu adım adım çöz:\n\n${questionText}` });
  } else {
    parts.push({ text: `Aşağıdaki DUS sorusunu adım adım çöz:\n\n${questionText}` });
  }

  const result = await model.generateContent(parts);
  return result.response.text();
}

// ─── PDF Yardımcıları ──────────────────────────────────────────────────────

/**
 * URL'den PDF indirip base64 döner.
 * `signal` ile iptal edilebilir (soru değiştiğinde AbortController tetiklenir).
 */
export async function fetchPdfAsBase64(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`PDF indirilemedi (HTTP ${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // Güvenli base64 dönüşümü: chunk başına apply() kullanımı
  // Spread operatörünün çok büyük dizilerde neden olabileceği stack overflow riskini önler
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/** Gemini API anahtarının kurulu olup olmadığını kontrol eder */
export function isAIConfigured(): boolean {
  return !!API_KEY && API_KEY.length > 10;
}
