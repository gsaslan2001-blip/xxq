#!/bin/bash
# DUS Periodontoloji — Kalan PDF Pipeline Orkestrasyonu
# 6.c tamamlandıktan sonra çalıştırılır

PROJECT="C:/Users/FURKAN/Desktop/Projeler/DUSBANKASI"
URETIM="C:/Users/FURKAN/Desktop/DUS/üretim/Periodontoloji"
LESSON="Periodontoloji"

cd "$PROJECT"

echo "========================================"
echo "ADIM 1: 7.c - İleri Cerrahi İşlemler 3"
echo "========================================"
python -u scripts/notebooklm-exhaust.py \
  --file "$URETIM/7.c - İleri Cerrahi İşlemler 3.pdf" \
  --lesson "$LESSON" \
  2>&1 | tee /tmp/pipeline_7c.log

echo ""
echo "========================================"
echo "ADIM 2: 8.a - Destekleyici Periodontal Tedavi"
echo "========================================"
python -u scripts/notebooklm-exhaust.py \
  --file "$URETIM/8.a - Destekleyici Periodontal Tedavi.pdf" \
  --lesson "$LESSON" \
  2>&1 | tee /tmp/pipeline_8a.log

echo ""
echo "========================================"
echo "ADIM 3: Periodontoloji Kalite Denetimi"
echo "========================================"
python -u scripts/tools/smart_audit_pipeline.py \
  --lesson "$LESSON" \
  2>&1 | tee /tmp/audit_periodontoloji.log

echo ""
echo "========================================"
echo "TÜM ADIMLAR TAMAMLANDI"
echo "========================================"
