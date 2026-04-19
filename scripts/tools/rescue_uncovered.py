import os
import sys
import subprocess
from pathlib import Path
import re

# Dizin Yolları
PROJECT_DIR = r"c:\Users\FURKAN\Desktop\Projeler\DUSBANKASI"
LOG_DIR = os.path.join(PROJECT_DIR, "scripts", "logs")
SCRIPT_PATH = os.path.join(PROJECT_DIR, "scripts", "notebooklm-exhaust.py")

BASE_DIR = r"C:\Users\FURKAN\Desktop\DUS\üretim"
LESSONS = {
    "Histoloji": os.path.join(BASE_DIR, "Histoloji"),
    "Endodonti": os.path.join(BASE_DIR, "Endodonti Ünite Pdf"),
    "Fizyoloji": os.path.join(BASE_DIR, "Fizyo ünite pdf"),
    "Periodontoloji": os.path.join(BASE_DIR, "Periodontoloji"),
    "Oral Patoloji": r"C:\Users\FURKAN\Desktop\DUS\patoloji\output\oral patoloji\md",
}

def find_file_and_lesson(unit_name):
    """Verilen ünite adına göre orjinal dosyayı ve ders adını bulur."""
    for lesson, folder in LESSONS.items():
        if not os.path.exists(folder):
            continue
        for f in Path(folder).iterdir():
            if f.suffix.lower() in [".pdf", ".md"] and f.stem == unit_name:
                return lesson, str(f)
    return None, None

def main():
    print("==================================================")
    print("🚀 UNCOVERED (ISKALANAN KAVRAMLAR) RESCUE SCRIPT")
    print("==================================================")

    if not os.path.exists(LOG_DIR):
        print("Log dizini bulunamadı!")
        sys.exit(1)

    uncovered_files = [f for f in os.listdir(LOG_DIR) if f.startswith("uncovered_") and f.endswith(".txt")]
    
    if not uncovered_files:
        print("Hiç uncovered_ dosyası bulunamadı.")
        return

    to_process = []

    for fname in uncovered_files:
        unit_name = fname.replace("uncovered_", "").replace(".txt", "")
        filepath = os.path.join(LOG_DIR, fname)
        
        # Dosyayı oku ve kalan sayısına bak
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        anchors = []
        for line in content.split('\n'):
            line = line.strip()
            if re.match(r'^\d+\.\s+', line):
                anchors.append(line)

        if len(anchors) > 0:
            lesson, original_file = find_file_and_lesson(unit_name)
            if lesson and original_file:
                to_process.append({
                    "unit": unit_name,
                    "lesson": lesson,
                    "file": original_file,
                    "count": len(anchors)
                })
            else:
                print(f"⚠️ {unit_name} için orjinal kaynak dosya bulunamadığı için atlanıyor.")

    if not to_process:
        print("✅ Harika! Tüm loglar temiz. ISKALANAN KAVRAM YOK!")
        return

    print(f"\nToplam {len(to_process)} ünitede kapsanmamış kavram tespit edildi.")
    for t in to_process:
        print(f" - {t['lesson']} / {t['unit']} ({t['count']} kavram)")

    print("\nKurtarma (Rescue) işlemi başlıyor...\n")

    for idx, t in enumerate(to_process, 1):
        print(f"[{idx}/{len(to_process)}] 👉 İşleniyor: {t['unit']} ({t['count']} eksik kavram)")
        
        cmd = [
            sys.executable,
            SCRIPT_PATH,
            "--file", t["file"],
            "--lesson", t["lesson"],
            "--unit", t["unit"],
            "--uncovered-only"
        ]
        
        try:
            # Otomatik devam eden bir süreç olduğu için exception fırlatırsa durmalı
            subprocess.run(cmd, check=True)
        except subprocess.CalledProcessError as e:
            print(f"!!! Error processing {t['unit']}: {e}")
            print("!!! Hata nedeniyle rescue_uncovered durduruldu.")
            sys.exit(1)
        
        print(f"✅ {t['unit']} için rescue tamamlandı.\n")

    print("🎉 TÜM ISKALANAN KAVRAMLAR BAŞARIYLA SORGULANDI!")

if __name__ == "__main__":
    main()
