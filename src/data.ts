export type Question = {
  id: string;
  lesson: string;
  unit: string;
  question: string;
  options: {
    A: string;
    B: string;
    C: string;
    D: string;
    E: string;
  };
  correctAnswer: 'A' | 'B' | 'C' | 'D' | 'E';
  explanation: string;
  is_favorite?: boolean;
  quality_flag?: string | null;
};

export const sampleData: Question[] = [
  {
    id: "soru-1",
    lesson: "Endodonti",
    unit: "Ünite 20 - ENDODONTİK TEDAVİ SONRASI RESTORATİF İŞLEMLER",
    question: "Endodontik tedavi görmüş ve koronal dokularının üçte ikisinden fazlası kaybedilmiş bir dişte aşağıdaki restoratif yaklaşımlardan hangisi kontrendikedir?",
    options: {
      A: "Kompozit onley",
      B: "Seramik onley",
      C: "Endokuron",
      D: "Direkt kompozit",
      E: "Döküm post-kor"
    },
    correctAnswer: "D",
    explanation: "Endodontik tedavi sonrası dişlerde en kritik sorun, koronal doku kaybına bağlı kırılganlığın artmasıdır. Koronal dokunun üçte ikisinden fazlasının kaybedildiği vakalarda, restorasyonun dişi bir bütün olarak tutabilmesi ve kuvvetleri karşılayabilmesi için kuron kaplamaları, onleyler, endokuronlar veya post-kor gibi indirekt restorasyonlar zorunludur.\n\nDirekt kompozit restorasyonlar bu boyuttaki devasa kayıplarda yetersiz rezistans (direnç) formu sağlar ve polimerizasyon büzülmesi kalan zayıf duvarlarda yüksek stres yaratır. Bu durum erken dönem restorasyon veya kök fraktürleri ile sonuçlanacağı için kontrendikedir."
  },
  {
    id: "soru-2",
    lesson: "Endodonti",
    unit: "Ünite 20 - ENDODONTİK TEDAVİ SONRASI RESTORATİF İŞLEMLER",
    question: "35 yaşında kadın hasta, endodontik tedavisi yeni tamamlanmış mandibular birinci molar dişinin restorasyonu için kliniğe başvurmuştur. Yapılan değerlendirmede aşırı madde kaybı olduğu saptanmış, ancak diş kesimi yapılmaksızın kalan diş dokusunun korunarak restorasyon yapılması planlanmıştır. Bu klinik senaryoda tercih edilmesi en uygun restorasyon tipi aşağıdakilerden hangisidir?",
    options: {
      A: "Direkt kompozit restorasyon",
      B: "Döküm metal post ve full kuron",
      C: "Kompozit veya seramik onley",
      D: "Aktif retansiyonlu prefabrik post",
      E: "Pasif retansiyonlu karbon fiber post"
    },
    correctAnswer: "A",
    explanation: "Vaka senaryosunda kritik ifade 'diş kesimi yapılmaksızın kalan diş dokusunun korunarak' ibaresidir. Onley, endokuron veya döküm kuron gibi indirekt restorasyonlar dişten belirli kurallara göre (kavite duvarlarının paralelliği, basamak hazırlığı vb.) ekstra madde kaldırılmasını (diş kesimi) gerektirir.\n\nGelişen adeziv diş hekimliği prensipleri sayesinde, kalan diş dokusunun makromekanik tutuculuk için feda edilmek istenmediği durumlarda, retansiyonu tamamen mikromekanik bağlanmadan (adezyondan) alan direkt kompozit restorasyonlar en koruyucu yaklaşımdır."
  },
  {
    id: "soru-3",
    lesson: "Endodonti",
    unit: "Ünite 20 - ENDODONTİK TEDAVİ SONRASI RESTORATİF İŞLEMLER",
    question: "Kök kanal tedavisi sonrasında dişte meydana gelen fiziksel ve yapısal değişikliklerle ilgili aşağıdakilerden hangisi yanlıştır?",
    options: {
      A: "Diş dokularında adezyon kapasitesi artar.",
      B: "Fiziksel karakteristiklerde değişiklikler meydana gelir.",
      C: "Olası renklenmeler ortaya çıkabilir.",
      D: "Dişin kırılganlığında artış gözlenir.",
      E: "Madde kaybı yapılacak restoratif yaklaşımı değiştirir."
    },
    correctAnswer: "A",
    explanation: "Endodontik tedavi sırasında kullanılan sodyum hipoklorit (NaOCl) gibi güçlü irrigasyon solüsyonları, dentin kollajen ağını parçalar ve yüzeyde oksijenden zengin bir tabaka bırakır. Bu durum rezin monomerlerinin polimerizasyonunu baskılayarak dişin adezyon (bağlanma) kapasitesini belirgin şekilde düşürür.\n\nAyrıca pulpanın alınmasıyla dişin su ve nem içeriği azalır, pulpa tavanının kaldırılması (endodontik giriş kavitesi) dişin kırılganlığını artırır ve kanal içi pat/kanamalar nedeniyle renklenmeler gözlenebilir."
  },
  {
    id: "soru-4",
    lesson: "Endodonti",
    unit: "Biyomekanik Prensipler",
    question: "Dişeti seviyesinin koronalindeki sağlam diş dokusunun kuron tarafından bir bütün olarak sarılması ve dişin rezistansı ile retansiyonunu artırarak kırılma direncini yükseltmesi durumuna ne ad verilir?",
    options: {
      A: "Adezyon etkisi",
      B: "Retansiyon formu",
      C: "Rezistans formu",
      D: "Koronal sızdırmazlık",
      E: "Ferrule etkisi"
    },
    correctAnswer: "E",
    explanation: "Ferrule etkisi, yapılacak olan restorasyonun (kuronun) boyun kısmının, sağlam kök dentinini çepeçevre bir bilezik gibi sarmasıdır. Bu mekanik sarma, okluzal kuvvetlerin kökte yaratacağı kama etkisini (wedge effect) nötralize eder.\n\nBaşarılı bir post-kor restorasyonun en kritik unsuru ferrule varlığıdır. Kök kırıklarını önler, restorasyonun devrilme kuvvetlerine karşı rezistansını ve yerinden çıkmaya karşı retansiyonunu dramatik düzeyde artırır. İdeal olarak en az 1.5 - 2 mm yüksekliğinde sağlam dairesel dentin gerektirir."
  },
  {
    id: "soru-5",
    lesson: "Fizyoloji",
    unit: "Hücre Fizyolojisi",
    question: "Aşağıdakilerden hangisi hücre zarının temel özelliklerinden biri değildir?",
    options: {
      A: "Seçici geçirgen (yarı geçirgen) yapıdadır.",
      B: "Çift katlı fosfolipid tabakasından oluşur.",
      C: "Sadece aktif taşıma ile madde geçişine izin verir.",
      D: "Kolesterol, zarın akışkanlığını düzenler.",
      E: "Proteinler zar üzerinde çeşitli görevler üstlenir."
    },
    correctAnswer: "C",
    explanation: "Hücre zarı seçici geçirgendir ve sadece aktif taşıma ile DEĞİL, pasif taşıma (difüzyon, osmoz) ile de madde geçişine izin verir. C şıkkı yanlıştır."
  }
];
