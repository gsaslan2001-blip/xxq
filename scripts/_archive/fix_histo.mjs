import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Buffer } from 'buffer';

dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
const genAI = new GoogleGenerativeAI(process.env.VITE_GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

function fileToGenerativePart(filePath) {
  return { inlineData: { data: Buffer.from(fs.readFileSync(filePath)).toString("base64"), mimeType: "application/pdf" } };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fixAndUploadHistology() {
  const directoryPath = 'C:\\Users\\FURKAN\\Desktop\\DUS\\Histoloji\\histo ünite pdf\\Yeni klasör';
  const lesson = 'Histoloji';
  const files = fs.readdirSync(directoryPath).filter(f => f.endsWith('.pdf'));
  
  for (const fileName of files) {
    const filePath = path.join(directoryPath, fileName);
    const oldUnitName = fileName.replace(/\.pdf$/i, '');
    let newUnitName = oldUnitName;

    // Supabase'den kontrol et, yüklenmişse atla
    // fileName db'ye aktarılırken safeName kullanılmış olabilir ama biz unit ile de bakabiliriz.
    // Ancak unit adı değişti! O yüzden original file_name sütunu güvenli değil, biz sadece storage'ı değil DB'yi kontrol edelim
    // En iyisi "Eğer fileName ilk sayfaysa ve daha önceden eklendiyse (veritabanında varsa) atla" 
    // Ama yeni isimle eklendi.. O yüzden DB'den o dosyanın oldUnitName inden çıkardığı safeName'e veya oldUnitName'a bakalım.
    
    // Tembel çözüm: dosya db'de lesson="Histoloji" && file_name includes oldUnitName.replace(/[^a-zA-Z]/g,'_')
    const safeNameTry = newUnitName.replace(/[^a-zA-Z0-9.\u011E\u011F\u0130\u0131\u00D6\u00F6\u00C7\u00E7\u015E\u015F\u00DC\u00FC_-]/g, '_') + '.pdf';
    
    const { data: ext } = await supabase.from('reference_sources').select('id').eq('lesson', lesson).ilike('file_name', `%${fileName.replace(/[^a-zA-Z]/g, '%')}%`).limit(1);
    if (ext && ext.length > 0) {
       console.log(`⏩ Atlanıyor (Zaten var): ${fileName}`);
       continue;
    }

    if (fileName.includes("İlk sayfa") || fileName.includes("Kopya")) {
      process.stdout.write(`🧠 AI okuyor: ${fileName}... `);
      let success = false;
      let retries = 3;
      while (!success && retries > 0) {
        try {
          const filePart = fileToGenerativePart(filePath);
          const prompt = `Sen zeki bir tıbbi asistansın. Ekteki PDF bir Diş Hekimliği Histoloji çalışma notudur. Kapak sayfasındaki veya içeriğindeki büyük başlıklara bakarak, bu ünitenin asıl konusunun adını çıkar (Örn: Hücre, Epitel Dokusu, Kıkırdak Dokusu, Kan Dokusu vb). YALNIZCA ve kısaca ünitenin adını yaz, başka tek bir kelime bile yazma. Rakamla başlama.`;
          
          const result = await model.generateContent([prompt, filePart]);
          newUnitName = result.response.text().trim().replace(/[*"']/g, '').substring(0, 50);
          console.log(` => [ ${newUnitName} ]`);
          success = true;
          
          await supabase.from('questions').update({ unit: newUnitName }).eq('lesson', lesson).eq('unit', oldUnitName);
        } catch (err) {
          retries--;
          process.stdout.write(` Hata (${err.message}). Yeniden deneniyor... `);
          await sleep(2000);
        }
      }
      if (!success) {
        process.stdout.write(` ❌ AI Başarısız. Mevcut isimle devam ediliyor. `);
      }
    }

    process.stdout.write(`   🚀 Yükleniyor (${newUnitName})... `);
    const trMap = {'ç':'c', 'ğ':'g', 'ı':'i', 'ö':'o', 'ş':'s', 'ü':'u', 'Ç':'C', 'Ğ':'G', 'İ':'I', 'Ö':'O', 'Ş':'S', 'Ü':'U'};
    const cleanNames = (s) => s.replace(/[çğıöşüÇĞİÖŞÜ]/g, m => trMap[m]).replace(/[^a-zA-Z0-9_-]/g, '_');
    
    // DB için güvenli ad
    const safeName = newUnitName.replace(/[^a-zA-Z0-9.\u011E\u011F\u0130\u0131\u00D6\u00F6\u00C7\u00E7\u015E\u015F\u00DC\u00FC_-]/g, '_') + '.pdf';
    
    const storagePath = `${cleanNames(lesson)}/${cleanNames(newUnitName)}/${Date.now()}.pdf`;
    
    const { error: uploadError } = await supabase.storage.from('study-resources').upload(storagePath, fs.readFileSync(filePath), { contentType: 'application/pdf', upsert: false });
    if (uploadError) { console.log(` Storage Hatası: ${uploadError.message}`); continue; }
    
    const { error: insertError } = await supabase.from('reference_sources').insert({ lesson, unit: newUnitName, file_path: storagePath, file_name: fileName }); // Orijinal adı sakla
    if (insertError) console.log(` DB Ek Hatası: ${insertError.message}`);
    else console.log('✅ Bitti.');
  }
}
fixAndUploadHistology();
