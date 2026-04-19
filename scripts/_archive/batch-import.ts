import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const pdfDir = "C:\\Users\\FURKAN\\Desktop\\DUS\\Endodonti\\Endodonti Ünite Pdf";
const lessonName = "Endodonti";

// AUDIT: G2 — pdfDir ve lessonName env var'dan oku, hardcode path kaldırıldı
const pdfDirResolved = process.env.BATCH_PDF_DIR || pdfDir;
const lessonNameResolved = process.env.BATCH_LESSON_NAME || lessonName;
// AUDIT: K5 — --skip-until=N parametresi desteği (hardcode 2 yerine)
const skipUntilArg = process.argv.find(a => a.startsWith('--skip-until='));
const SKIP_UNTIL = skipUntilArg ? parseInt(skipUntilArg.split('=')[1], 10) : 0;

async function runBatch() {
    // AUDIT: K5 — başlangıç timestamp'i
    const startTime = Date.now();
    console.log(`=== DUS SERI ÜRETIM BAŞLIYOR === [${new Date().toISOString()}]`);
    console.log(`PDF Dizini: ${pdfDirResolved}`);
    console.log(`Ders: ${lessonNameResolved}`);
    if (SKIP_UNTIL > 0) console.log(`--skip-until=${SKIP_UNTIL}: ünite ${SKIP_UNTIL} ve öncesi atlanıyor.`);

    // 1. Dosyaları listele
    const files = fs.readdirSync(pdfDirResolved).filter((f: string) => f.endsWith('.pdf'));

    // 2. Sayısal sıraya göre sırala (Natural Sort)
    files.sort((a: string, b: string) => {
        const numA = parseInt(a.match(/\d+/)?.[0] || "0");
        const numB = parseInt(b.match(/\d+/)?.[0] || "0");
        return numA - numB;
    });

    console.log(`Toplam ${files.length} dosya bulundu. İşlem başlıyor...`);

    // AUDIT: K5 — partial tracking eklendi
    const results = {
        success: [] as string[],
        failed: [] as string[],
        partial: [] as string[],  // üretildi ama eksik
        skipped: [] as string[],
    };

    for (const file of files) {
        const unitNumber = parseInt(file.match(/\d+/)?.[0] || "0");

        if (unitNumber > 0 && unitNumber <= SKIP_UNTIL) {
            console.log(`- ${file} atlanıyor (--skip-until=${SKIP_UNTIL})`);
            results.skipped.push(file.replace('.pdf', ''));
            continue;
        }

        const fullPath = path.join(pdfDirResolved, file);
        const unitName = file.replace('.pdf', '');

        console.log(`\n>>> ŞU AN İŞLENİYOR: ${unitName}`);

        try {
            // AUDIT: K5 — execSync başarısızlıkta exception fırlatır (exit code != 0)
            execSync(
                `npx tsx scripts/ai-import.ts "${fullPath}" "${lessonNameResolved}" "${unitName}"`,
                { stdio: 'inherit' }
            );

            results.success.push(unitName);
            console.log(`✓ BAŞARI: ${unitName} tamamlandı.`);

            const pauseMs = 15000 + Math.floor(Math.random() * 5000);
            console.log(`${(pauseMs/1000).toFixed(1)} saniye mola veriliyor...`);
            await new Promise(resolve => setTimeout(resolve, pauseMs));

        } catch (error: unknown) {
            const exitCode = (error as { status?: number }).status;
            if (exitCode === 1) {
                // ai-import.ts açık hata ile çıktı
                console.error(`✗ HATA: ${unitName} üretim başarısız oldu (exit 1).`);
                results.failed.push(unitName);
            } else {
                // Sinyal, kill, vb. — partial olarak işaretle
                console.error(`⚠ KISMI: ${unitName} beklenmedik çıkış (exit ${exitCode ?? 'N/A'}).`);
                results.partial.push(unitName);
            }
            console.log("Hata sonrası 30s soğuma süresi...");
            await new Promise(resolve => setTimeout(resolve, 30000));
        }
    }

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const endTime = new Date().toISOString();
    console.log("\n=== SERI ÜRETIM RAPORU ===");
    console.log(`Tamamlanma: ${endTime}`);
    console.log(`Toplam Süre: ${elapsed} dakika`);
    console.log(`Başarılı:   ${results.success.length}`);
    console.log(`Hatalı:     ${results.failed.length}`);
    console.log(`Kısmi:      ${results.partial.length}`);
    console.log(`Atlandı:    ${results.skipped.length}`);
    if (results.failed.length > 0)  console.log("  → Hata alınan:", results.failed.join(", "));
    if (results.partial.length > 0) console.log("  → Kısmi üretim:", results.partial.join(", "));
    console.log("==========================");
}

runBatch();
