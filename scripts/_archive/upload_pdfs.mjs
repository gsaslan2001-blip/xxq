import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Buffer } from 'buffer';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Hata: .env.local dosyasında Supabase değişkenleri bulunamadı.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function uploadFiles() {
  const directoryPath = 'C:\\Users\\FURKAN\\Desktop\\DUS\\protez\\Yeni klasör\\Parcalanmis';
  const lesson = 'Protez'; // Veritabanına kaydedilecek ders adı
  
  if (!fs.existsSync(directoryPath)) {
    console.error("Hata: Klasör bulunamadı -", directoryPath);
    return;
  }

  const files = fs.readdirSync(directoryPath);
  console.log(`Toplam ${files.length} dosya bulundu. Yükleme başlıyor...\n`);
  
  let successCount = 0;
  let failCount = 0;

  for (const fileName of files) {
    if (!fileName.toLowerCase().endsWith('.pdf')) continue;
    
    const filePath = path.join(directoryPath, fileName);
    const unit = fileName.replace(/\.pdf$/i, ''); // Örn: '01-Diş Anatomisi'
    
    process.stdout.write(`Yükleniyor -> ${unit}... `);
    
    try {
      const fileContent = fs.readFileSync(filePath);
      const timestamp = Date.now();
      
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeLesson = lesson.replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeUnit = unit.replace(/[^a-zA-Z0-9_-]/g, '_');
      
      const storagePath = `${safeLesson}/${safeUnit}/${timestamp}_${safeName}`;
      
      // 1. Storage'a Yükle
      const { error: uploadError } = await supabase.storage
        .from('study-resources')
        .upload(storagePath, fileContent, {
          contentType: 'application/pdf',
          upsert: false
        });
        
      if (uploadError) throw new Error(`Storage: ${uploadError.message}`);
      
      // 2. Veritabanına Ekle
      const { error: insertError } = await supabase
        .from('reference_sources')
        .insert({
          lesson: lesson,
          unit: unit,
          file_path: storagePath,
          file_name: fileName
        });
        
      if (insertError) throw new Error(`DB: ${insertError.message}`);
      
      console.log('✅ İşlem Tamam.');
      successCount++;
    } catch (err) {
      console.log(`\n❌ Hata: ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n🎉 Tüm yüklemeler bitti. Başarılı: ${successCount}, Başarısız: ${failCount}`);
}

uploadFiles().catch(err => console.error("Beklenmeyen hata:", err));
