import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

const questions = [
  {
    lesson: "Patoloji",
    unit: "9.Ünit Oral Patoloji (1)",
    question: "Ellili yaşlarında bir kadın hasta, şiddetli yutma güçlüğü (disfaji) ve dilinde yanma şikayetiyle kliniğe başvuruyor. Yapılan muayenesinde dil dorsumunda papilla kaybı ile karakterize pürüzsüz kırmızı görünüm (atrofik glossit) saptanıyor. Laboratuvar tetkiklerinde kronik demir eksikliği anemisi tespit edilen bu hastada özofagoskopide üst özofagusta mukozal bantlar (özofageal web) izleniyor. Bu klinik tablo için en olası tanı ve bu hastada gelecekte gelişme riski en yüksek olan malignite aşağıdakilerden hangisidir?",
    option_a: "Pernisiyöz anemi — Lenfoma",
    option_b: "Plummer-Vinson Sendromu — Skuamöz hücreli karsinom (SCC)",
    option_c: "Oral submüköz fibrozis — Bazal hücreli karsinom",
    option_d: "Pernisiyöz anemi — Mide karsinomu",
    option_e: "Sjögren Sendromu — Mukoepidermoid karsinom",
    correct_answer: "B",
    explanation: "Plummer-Vinson sendromu (Sideropenik disfaji); demir eksikliği anemisi, oral/özofageal mukoza atrofisi (atrofik glossit) ve özofageal weblere bağlı disfaji triadı ile karakterizedir. Bu sendrom prekanseröz bir durum olup, özellikle dil, oral kavite ve özofagusta Skuamöz Hücreli Karsinom (SCC) riskini belirgin şekilde artırır."
  },
  {
    lesson: "Patoloji",
    unit: "9.Ünit Oral Patoloji (1)",
    question: "Makroglossia (dilin hacimsel büyümesi) etiyolojisinde yer alan sendromlar ve mekanizmalar eşleştirildiğinde, aşağıdaki ifadelerden hangisi yanlıştır?",
    option_a: "Down sendromunda maksiller gelişim geriliğine bağlı göreceli (psödo) makroglossi izlenir.",
    option_b: "Duchenne muskuler distrofisinde, kas yıkımının yerini fibro-yağlı dokunun alması sonucu paradoksal bir makroglossi (psödohipertrofi) görülür.",
    option_c: "Kretenizmde makroglossinin nedeni bağ dokuda glikozaminoglikanların (miksödem) birikmesidir.",
    option_d: "MEN Tip 2B vakalarında, dildeki mukozal nöroma hiperplazisine bağlı makroglossi saptanır.",
    option_e: "Pierre Robin sekansında primer patoloji gerçek makroglossi olup, glossoptoz nedeniyle hava yolu tıkanıklığına neden olur.",
    correct_answer: "E",
    explanation: "Pierre Robin sekansında temel sorun makroglossi değildir; tam aksine mandibular mikrognati (küçük alt çene) ve buna bağlı olarak dilin geriye doğru yer değiştirmesi (glossoptoz) sonucu hava yolu tıkanıklığı gelişir. Makroglossi yapan sendromlar gerçek doku hiperplazisi veya psödohipertrofiye neden olur."
  },
  {
    lesson: "Patoloji",
    unit: "9.Ünit Oral Patoloji (1)",
    question: "Median romboid glossit (santral papiller atrofi) ile ilgili aşağıdaki ifadelerden hangisi doğrudur?",
    option_a: "Dilin gelişim aşamalarındaki tüberkulum imparın kaynaşma defekti sonucu oluşan konjenital bir anomalidir.",
    option_b: "Hastaların çoğunda şiddetli yanma ve ağrı (glossodinya) ile karakterize akut bir tablodur.",
    option_c: "Etiyopatogenezinde vakaların büyük bir kısmında Candida albicans kolonizasyonu saptanmaktadır.",
    option_d: "Dilin anterior uç kısmında, serbest kenarlarda yerleşen gezici (migratuvar) bir lezyondur.",
    option_e: "Malign transformasyon potansiyeli çok yüksek olan primer bir prekanseröz lezyondur.",
    correct_answer: "C",
    explanation: "Median romboid glossit artık gelişimsel bir anomali olarak kabul edilmemekte; patognomonik olarak vakaların yaklaşık %40'ında Candida albicans enfeksiyonu zemininde gelişen kronik inflamatuar-atrofik bir patoloji olduğu bilinmektedir. Tipik yerleşimi dil sırtı orta hatta, foramen çekum önüdür ve genellikle asemptomatiktir."
  }
];

async function insertQuestions() {
  console.log("📝 Sorular güncel şema ile veritabanına ekleniyor...\n");
  
  const { data, error } = await supabase
    .from('questions')
    .insert(questions)
    .select();

  if (error) {
    console.error("❌ Hata:", error.message);
  } else {
    console.log(`✅ Başarıyla ${data.length} adet yüksek verimli soru eklendi.`);
  }
}

insertQuestions();
