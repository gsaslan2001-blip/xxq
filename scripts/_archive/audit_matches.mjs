import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function runAudit() {
  console.log("🔍 PDF - Ünite Eşleşme Denetimi Başlatıldı...\n");

  // 1. Sorulardaki tüm ders/ünite çiftlerini al
  const { data: qData, error: qErr } = await supabase
    .from('questions')
    .select('lesson, unit');

  if (qErr) {
    console.error("Sorular çekilemedi:", qErr.message);
    return;
  }

  const qUnits = new Set();
  qData.forEach(q => qUnits.add(`${q.lesson}|||${q.unit}`));

  // 2. Yüklenen PDF'lerin ders/ünite çiftlerini al
  const { data: rData, error: rErr } = await supabase
    .from('reference_sources')
    .select('lesson, unit');

  if (rErr) {
    console.error("Kaynaklar çekilemedi:", rErr.message);
    return;
  }

  const rUnits = new Set();
  rData.forEach(r => rUnits.add(`${r.lesson}|||${r.unit}`));

  // 3. Karşılaştır
  console.log("--------- ANALİZ RAPORU ---------");
  let missingTotal = 0;
  let matchTotal = 0;

  const lessons = Array.from(new Set(qData.map(q => q.lesson))).sort();

  for (const lesson of lessons) {
    const lessonUnits = Array.from(qUnits)
      .filter(u => u.startsWith(lesson + '|||'))
      .map(u => u.split('|||')[1]);

    const matchingInLesson = lessonUnits.filter(u => rUnits.has(`${lesson}|||${u}`));
    const missingInLesson = lessonUnits.filter(u => !rUnits.has(`${lesson}|||${u}`));

    if (matchingInLesson.length > 0 || missingInLesson.length > 0) {
      console.log(`\n[${lesson}]`);
      console.log(`✅ Eşleşen Ünite: ${matchingInLesson.length}`);
      if (missingInLesson.length > 0) {
        console.log(`❌ PDF'i Olmayan Üniteler (${missingInLesson.length}):`);
        missingInLesson.forEach(m => console.log(`   - ${m}`));
        missingTotal += missingInLesson.length;
      } else {
        console.log(`🎉 Tebrikler! Tüm üniteler PDF ile eşleşti.`);
      }
      matchTotal += matchingInLesson.length;
    }
  }

  console.log("\n---------------------------------");
  console.log(`TOPLAM ANALİZ:`);
  console.log(`Eşleşen: ${matchTotal}`);
  console.log(`Eksik: ${missingTotal}`);
}

runAudit();
