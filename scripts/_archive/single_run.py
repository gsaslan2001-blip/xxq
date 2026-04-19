"""
DUS BANKASI — Tek Seferlik Soru Üretim Scripti (Tur 1)
Kullanım: python single_run.py "dosya_yolu" "Ders" "Ünite"
"""
import os
import sys
import asyncio
import uuid
from pathlib import Path

# Modül yollarını ayarla
sys.path.insert(0, os.path.dirname(__file__))
from config import LIB_PATH, NOTEBOOK_ID
from shared import extract_json, deploy_to_supabase

if LIB_PATH not in sys.path:
    sys.path.append(LIB_PATH)

try:
    from notebooklm import NotebookLMClient
except ImportError:
    print("HATA: NotebookLM kütüphanesi bulunamadı!")
    sys.exit(1)

# TUR 1 PROMPT (Master Prompt)
PROMPT_1 = r"""Defalarca test ettiğimiz ve bu defterin "Sohbeti Yapılandırın (Özel)" ayarlarına yüklenmiş olan DUS Soru Yazarı (Master Prompt) kuralları devrededir.

Lütfen o ayarlardaki TÜM kalite kurallarına, <analiz> protokolüne ve spesifik JSON çıktısına harfiyen uyarak, sadece sana verdiğim bu kaynaktan ilk 30 soruluk ağırlık merkezleri (Batch 1, 2, 3) setini üret.
"""

async def run_single(file_path, lesson, unit):
    print(f"\n🚀 BAŞLATILIYOR: {lesson} - {unit}")
    print(f"📂 Kaynak: {file_path}")

    async with await NotebookLMClient.from_storage() as client:
        await client.refresh_auth()
        
        # 1. Temizlik
        sources = await client.sources.list(NOTEBOOK_ID)
        if sources:
            print(f"   🧹 {len(sources)} eski kaynak siliniyor...")
            for s in sources:
                await client.sources.delete(NOTEBOOK_ID, s.id)

        # 2. Yükleme
        print("   📤 Kaynak yükleniyor...")
        source = await client.sources.add_file(NOTEBOOK_ID, file_path, wait=True)
        
        # 3. Üretim (Tur 1)
        print("   🧠 Soru üretimi başlatıldı (Tur 1)...")
        conv_id = str(uuid.uuid4())
        res = await client.chat.ask(NOTEBOOK_ID, PROMPT_1, conversation_id=conv_id)
        
        questions = extract_json(res.answer)
        if questions:
            print(f"   ✅ {len(questions)} soru üretildi. Supabase'e kaydediliyor...")
            deploy_to_supabase(questions, lesson, unit)
            print("   ✨ İşlem başarıyla tamamlandı!")
        else:
            print("   ❌ Soru üretilemedi veya JSON parse edilemedi.")
            print("--- AI YANITI ---")
            print(res.answer)

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Kullanım: python single_run.py <dosya_yolu> <Ders> <Ünite>")
        sys.exit(1)
    
    f_path = sys.argv[1]
    l_name = sys.argv[2]
    u_name = sys.argv[3]
    
    asyncio.run(run_single(f_path, l_name, u_name))
