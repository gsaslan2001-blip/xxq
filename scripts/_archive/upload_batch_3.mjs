import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

const tasks = [
  {
    lesson: 'Endodonti',
    directoryPath: 'C:\\Users\\FURKAN\\Desktop\\DUS\\Endodonti\\Endodonti Ünite Pdf'
  },
  {
    lesson: 'Fizyoloji',
    directoryPath: 'C:\\Users\\FURKAN\\Desktop\\DUS\\Fizyoloji\\Fizyo ünite pdf'
  },
  {
    lesson: 'Periodontoloji',
    directoryPath: 'C:\\Users\\FURKAN\\Desktop\\DUS\\Periodontoloji\\Yeni klasör'
  }
];

async function runBatchUpload() {
  console.log("🛠️ Toplu Yükleme Başlatıldı (Endodonti, Fizyoloji, Periodontoloji)\n");

  const trMap = {'ç':'c', 'ğ':'g', 'ı':'i', 'ö':'o', 'ş':'s', 'ü':'u', 'Ç':'C', 'Ğ':'G', 'İ':'I', 'Ö':'O', 'Ş':'S', 'Ü':'U'};
  const cleanNames = (s) => s.replace(/[çğıöşüÇĞİÖŞÜ]/g, m => trMap[m]).replace(/[^a-zA-Z0-9_-]/g, '_');

  for (const task of tasks) {
    const { lesson, directoryPath } = task;
    
    if (!fs.existsSync(directoryPath)) {
      console.error(`❌ Klasör bulunamadı: ${directoryPath}`);
      continue;
    }

    const files = fs.readdirSync(directoryPath).filter(f => f.toLowerCase().endsWith('.pdf'));
    console.log(`📂 [${lesson}] Klasörü: ${files.length} PDF dosyası bulundu.`);

    for (const fileName of files) {
      const filePath = path.join(directoryPath, fileName);
      const unitName = fileName.replace(/\.pdf$/i, '');

      process.stdout.write(`   🚀 Yükleniyor -> [${unitName}]... `);

      const timestamp = Date.now();
      const safeLesson = cleanNames(lesson);
      const safeUnit = cleanNames(unitName);
      const storagePath = `${safeLesson}/${safeUnit}/${timestamp}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      try {
        const { error: uploadError } = await supabase.storage
          .from('study-resources')
          .upload(storagePath, fs.readFileSync(filePath), {
            contentType: 'application/pdf',
            upsert: false
          });
          
        if (uploadError) throw new Error(`Storage: ${uploadError.message}`);
        
        const { error: insertError } = await supabase
          .from('reference_sources')
          .insert({
            lesson: lesson,
            unit: unitName,
            file_path: storagePath,
            file_name: fileName
          });
          
        if (insertError) throw new Error(`DB: ${insertError.message}`);
        
        console.log('✅ İşlem Başarılı.');
      } catch (err) {
        console.log(`❌ Hata: ${err.message}`);
      }
    }
    console.log(`✨ [${lesson}] Yüklemesi Tamamlandı.\n`);
  }

  console.log("🎉 Tüm toplu yüklemeler başarıyla bitti!");
}

runBatchUpload().catch(err => console.error("Kritik Hata:", err));
