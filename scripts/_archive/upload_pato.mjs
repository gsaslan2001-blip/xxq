import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

// PDF dosya adı -> DB'de kullanılacak ünitenin "ideal" adı haritası
const unitMap = {
  "1- 1. GÜN HÜCRESEL ADAPTASYONLAR, HÜCRE HASARI, HÜCRE ÖLÜMÜ ve HEMODİNAMİK HASTALIKLAR.pdf": "Hücresel Adaptasyonlar, Hücre Hasarı, Hücre Ölümü ve Hemodinamik Hastalıklar",
  "2- 2. GÜN İNFLAMASYON ve TAMİR.pdf": "İnflamasyon ve Doku Tamiri",
  "3-HEMODİNAMİK HASTALIK VE ŞoK.pdf": "Hemodinamik Hastalık ve Şok",
  "4- 3. GÜN İMMÜN SİSTEM HASTALIKLARI.pdf": "İmmün Sistem Hastalıkları",
  "5- 4. GÜN NEOPLAZİ.pdf": "Neoplazi",
  "6-DERİ HASTALIKLARI.pdf": "Deri Hastalıkları",
  "7- 5. GÜN KEMİK, EKLEM ve YUMUŞAK DOKU HASTALIKLARI.pdf": "Kemik, Eklem Hastalıkları ve Yumuşak Doku Tümörleri",
  "10-DAMAR HAST.pdf": "Damar Hastalıkları",
  "ORAL PATOLOJİ FUL.pdf": "Oral Patoloji"
};

async function uploadPatoloji() {
  const directoryPath = 'C:\\Users\\FURKAN\\Desktop\\DUS\\patoloji\\pato ünite pdf';
  const lesson = 'Patoloji';
  
  if (!fs.existsSync(directoryPath)) {
    console.error("Klasör bulunamadı:", directoryPath);
    return;
  }

  const files = fs.readdirSync(directoryPath).filter(f => f.endsWith('.pdf'));
  console.log(`Toplam ${files.length} Patoloji dosyası bulundu. Yükleme başlıyor...\n`);
  
  let successCount = 0;

  for (const fileName of files) {
    const filePath = path.join(directoryPath, fileName);
    
    // Eşleşme varsa ondan al, yoksa .pdf'i silerek temizlemeye çalış
    const unit = unitMap[fileName] || fileName.replace(/\.pdf$/i, '');
    
    process.stdout.write(`Yükleniyor -> ${unit}... `);
    
    try {
      const fileContent = fs.readFileSync(filePath);
      const timestamp = Date.now();
      
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeLesson = lesson.replace(/[^a-zA-Z0-9_-]/g, '_');
      // Supabase storage path for unit string requires sanitization
      const safeUnit = unit.replace(/[^a-zA-Z0-9_-]/g, '_');
      
      const storagePath = `${safeLesson}/${safeUnit}/${timestamp}_${safeName}`;
      
      const { error: uploadError } = await supabase.storage
        .from('study-resources')
        .upload(storagePath, fileContent, {
          contentType: 'application/pdf',
          upsert: false
        });
        
      if (uploadError) throw new Error(`Storage: ${uploadError.message}`);
      
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
    }
  }

  console.log(`\n🎉 Tüm Patoloji PDF'leri eşleştirilip yüklendi. Başarılı: ${successCount}`);
}

uploadPatoloji().catch(console.error);
