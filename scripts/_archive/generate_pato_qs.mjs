import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

const questions = [
  {
    lesson: "Patoloji",
    unit: "9.Ünit Oral Patoloji (1)",
    question: "Ellili yaşlarında bir kadın hasta, şiddetli yutma güçlüğü (disfaji) ve dilinde yanma şikayetiyle kliniğe başvuruyor. Yapılan muayenesinde dil dorsumunda papilla kaybı ile karakterize pürüzsüz kırmızı görünüm (atrofik glossit) saptanıyor. Laboratuvar tetkiklerinde kronik demir eksikliği anemisi tespit edilen bu hastada özofagoskopide üst özofagusta mukozal bantlar (özofageal web) izleniyor. Bu klinik tablo için en olası tanı ve bu hastada gelecekte gelişme riski en yüksek olan malignite aşağıdakilerden hangisidir?",
    options: {
      A: "Pernisiyöz anemi — Lenfoma",
      B: "Plummer-Vinson Sendromu — Skuamöz hücreli karsinom (SCC)",
      C: "Oral submüköz fibrozis — Bazal hücreli karsinom",
      D: "Pernisiyöz anemi — Mide karsinomu",
      E: "Sjögren Sendromu — Mukoepidermoid karsinom"
    },
    correctAnswer: "B",
    difficulty: "medium"
  },
  {
    lesson: "Patoloji",
    question: "Dilin hacimsel olarak normalden büyük olması (makroglossia) ile ilgili aşağıdaki ifadelerden hangisi yanlıştır?",
    unit: "9.Ünit Oral Patoloji (1)",
    options: {
      A: "Down sendromunda maksiller gelişim geriliğine bağlı göreceli (psödo) makroglossi izlenir.",
      B: "Duchenne muskuler distrofisinde, kas yıkımının yerini fibro-yağlı dokunun alması sonucu paradoksal bir makroglossi (psödohipertrofi) görülür.",
      C: "Kretenizmde makroglossinin nedeni bağ dokuda glikozaminoglikanların (miksödem) birikmesidir.",
      D: "MEN Tip 2B vakalarında, dildeki mukozal nöroma hiperplazisine bağlı makroglossi saptanır.",
      E: "Pierre Robin sekansında primer patoloji gerçek makroglossi olup, hava yolu tıkanıklığına neden olur."
    },
    correctAnswer: "E",
    difficulty: "hard"
  },
  {
    lesson: "Patoloji",
    unit: "9.Ünit Oral Patoloji (1)",
    question: "Dilin orta-posterior üçlü birleşim yerinde, foramen çekumun hemen anteriorunda yerleşen, asemptomatik, baklava (romboid) şeklinde kırmızı papiller atrofi alanı ile karakterize lezyonun güncel etiyopatogenezinde en sık suçlanan faktör aşağıdakilerden hangisidir?",
    options: {
      A: "Tüberkulum imparın embriyolojik kaynaşma defekti",
      B: "Vitamin B12 eksikliği",
      C: "Candida albicans enfeksiyonu",
      D: "Tütün ve alkol irritasyonu",
      E: "Tip 4 aşırı duyarlılık reaksiyonu"
    },
    correctAnswer: "C",
    difficulty: "medium"
  }
];

async function insertQuestions() {
  console.log("📝 Sorular veritabanına ekleniyor...\n");
  
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
