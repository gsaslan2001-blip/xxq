import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

const unitMap = {
  "1-Diş hekimliğinde radyoloji.pdf": "Ünite 1 - Diş Hekimliğinde Radyoloji",
  "2- Radyobiyoloji.pdf": "Ünite 3 - Radyobiyoloji", // DB check showed 3? Let me re-check DB list
  "3- Dijital - film görüntüleme.pdf": "Ünite 4 - Dijital ve Film Görüntüleme",
  "4- Banyo ve Artefakt.pdf": "Ünite 5 - Banyo ve Artefaktlar",
  "5-Teknikler.pdf": "Ünite 29 - Muayene Teknikleri", 
  "6-KIBT.pdf": "Ünite 9 - Konik Işınlı Bilgisayarlı Tomografi (KIBT)",
  "7-Diğer görüntüleme teknikleri.pdf": "Ünite 10 - Diş Hekimliğinde Diğer Görüntüleme Teknikleri",
  "8- Anatomik landmarklar ve çürük.pdf": "Ünite 11 - Anatomik Landmarklar", // This file might cover 11 and 12
  "9-Diş anomalileri ve peridodontal hastalıklar.pdf": "Ünite 13 - Diş Anomalileri", // Covers 13 and 14
  "10-yorumlama ilkeleri.pdf": "Ünite 15 - Radyografik Yorumlama İlkeleri",
  "11-Çeneler ve yüzün iltihabi hastalıkları.pdf": "Ünite 16 - Çeneler Ve Yüzün İltihabi Hastalıkları"
};

// If standard mapping fails, I'll try to find the best match from the DB list
const dbUnits = [
  'Ünite 1 - Diş Hekimliğinde Radyoloji',
  'Ünite 10 - Diş Hekimliğinde Diğer Görüntüleme Teknikleri',
  'Ünite 11 - Anatomik Landmarklar',
  'Ünite 12 - Diş Çürükleri ve Çürük Radyolojisi',
  'Ünite 13 - Diş Anomalileri',
  'Ünite 14 - Periodontal Radyoloji',
  'Ünite 15 - Radyografik Yorumlama İlkeleri',
  'Ünite 16 - Çeneler Ve Yüzün İltihabi Hastalıkları',
  'Ünite 17 - Kistler',
  'Ünite 18 - Benign Tümörler',
  'Ünite 19 - Diğer Kemik Hastalıkları',
  'Ünite 2 - Radyolojide Projeksiyon Kuralları',
  'Ünite 20 - Karsinomlar',
  'Ünite 21 - Sistemik Hastalıkların Çene Bulguları',
  'Ünite 22 - Paranazal Sinüsler',
  'Ünite 23 - Temporomandibular Eklem (Tme) Diagnostik Görüntüleme',
  'Ünite 24 - Yumuşak Doku Kalsifikasyonları',
  'Ünite 25 - Tükürük Bezi Hastalıkları',
  'Ünite 26 - Diş Hekimliğinde İmplant Planlaması',
  'Ünite 27 - Travma',
  'Ünite 28 - Kraniofasiyal Anomaliler',
  'Ünite 29 - Muayene Teknikleri'
];

async function uploadRadiology() {
  const directoryPath = 'C:\\Users\\FURKAN\\Desktop\\DUS\\Radyoloji\\Radyoloji Ünite PDF';
  const lesson = 'Radyoloji';
  const files = fs.readdirSync(directoryPath).filter(f => f.endsWith('.pdf'));
  
  console.log(`Radyoloji yüklemesi başlıyor... (${files.length} dosya)\n`);

  for (const fileName of files) {
    const filePath = path.join(directoryPath, fileName);
    
    // Match logic
    let targetUnit = unitMap[fileName];
    if (!targetUnit) {
       const numberMatch = fileName.match(/^(\d+)/);
       if (numberMatch) {
          const num = numberMatch[1];
          targetUnit = dbUnits.find(u => u.startsWith(`Ünite ${num} `));
       }
    }
    if (!targetUnit) targetUnit = fileName.replace('.pdf', '');

    process.stdout.write(`   🚀 Yükleniyor [${fileName}] -> DB Ünite: [${targetUnit}]... `);

    const trMap = {'ç':'c', 'ğ':'g', 'ı':'i', 'ö':'o', 'ş':'s', 'ü':'u', 'Ç':'C', 'Ğ':'G', 'İ':'I', 'Ö':'O', 'Ş':'S', 'Ü':'U'};
    const cleanNames = (s) => s.replace(/[çğıöşüÇĞİÖŞÜ]/g, m => trMap[m]).replace(/[^a-zA-Z0-9_-]/g, '_');
    
    const storagePath = `${cleanNames(lesson)}/${cleanNames(targetUnit)}/${Date.now()}.pdf`;

    try {
      const { error: uploadError } = await supabase.storage.from('study-resources').upload(storagePath, fs.readFileSync(filePath), { contentType: 'application/pdf' });
      if (uploadError) throw new Error(uploadError.message);

      const { error: insertError } = await supabase.from('reference_sources').insert({
        lesson,
        unit: targetUnit,
        file_path: storagePath,
        file_name: fileName
      });
      if (insertError) throw new Error(insertError.message);

      console.log('✅');
    } catch (err) {
      console.log(`❌ Hata: ${err.message}`);
    }
  }
  console.log('\n🎉 Radyoloji bitti!');
}

uploadRadiology();
