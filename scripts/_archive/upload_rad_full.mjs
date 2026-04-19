import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function uploadRadiologyFull() {
  const directoryPath = 'C:\\Users\\FURKAN\\Desktop\\DUS\\Radyoloji\\Yeni klasör\\Parcalanmis';
  const lesson = 'Radyoloji';
  const files = fs.readdirSync(directoryPath).filter(f => f.endsWith('.pdf'));
  
  console.log(`Kapsamlı Radyoloji yüklemesi başlıyor... (${files.length} dosya)\n`);

  for (const fileName of files) {
    const filePath = path.join(directoryPath, fileName);
    const unitName = fileName.replace('.pdf', '');

    process.stdout.write(`   🚀 Yükleniyor -> [${unitName}]... `);

    const trMap = {'ç':'c', 'ğ':'g', 'ı':'i', 'ö':'o', 'ş':'s', 'ü':'u', 'Ç':'C', 'Ğ':'G', 'İ':'I', 'Ö':'O', 'Ş':'S', 'Ü':'U'};
    const cleanNames = (s) => s.replace(/[çğıöşüÇĞİÖŞÜ]/g, m => trMap[m]).replace(/[^a-zA-Z0-9_-]/g, '_');
    
    const storagePath = `${cleanNames(lesson)}/${cleanNames(unitName)}/${Date.now()}.pdf`;

    try {
      const { error: uploadError } = await supabase.storage.from('study-resources').upload(storagePath, fs.readFileSync(filePath), { contentType: 'application/pdf' });
      if (uploadError) throw new Error(uploadError.message);

      const { error: insertError } = await supabase.from('reference_sources').insert({
        lesson,
        unit: unitName,
        file_path: storagePath,
        file_name: fileName
      });
      if (insertError) throw new Error(insertError.message);

      console.log('✅');
    } catch (err) {
      console.log(`❌ Hata: ${err.message}`);
    }
  }
  console.log('\n🎉 Kapsamlı Radyoloji yüklemesi tamamlandı!');
}

uploadRadiologyFull();
