
import os
import subprocess
import sys
from pathlib import Path

# Paths
BASE_DIR = r"C:\Users\FURKAN\Desktop\DUS\üretim"
PROJECT_DIR = r"c:\Users\FURKAN\Desktop\Projeler\DUSBANKASI"
SCRIPT_PATH = os.path.join(PROJECT_DIR, "scripts", "notebooklm-exhaust.py")

# Lessons Configuration
LESSONS = {
    "Histoloji": os.path.join(BASE_DIR, "Histoloji"),
    "Endodonti": os.path.join(BASE_DIR, "Endodonti Ünite Pdf"),
    "Fizyoloji": os.path.join(BASE_DIR, "Fizyo ünite pdf"),
    "Periodontoloji": os.path.join(BASE_DIR, "Periodontoloji"),
}

def run_script(file_path, lesson, unit_name):
    print(f"\n>>> PROCESSING: {lesson} - {unit_name}")
    cmd = [
        sys.executable, 
        SCRIPT_PATH, 
        "--file", str(file_path),
        "--lesson", lesson,
        "--unit", unit_name
    ]
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        print(f"!!! Error processing {unit_name}: {e}")

def main():
    # Histoloji mapping for clear DB names
    for lesson, folder in LESSONS.items():
        if not os.path.exists(folder):
            print(f"Skipping {lesson}: folder not found ({folder})")
            continue
            
        print(f"\n--- Starting {lesson} ---")
        files = [f for f in Path(folder).iterdir() if f.suffix.lower() in [".pdf", ".md"]]
        
        # Sort files (specifically for Histoloji and Endodonti numbered files)
        # Assuming format like "1 hücre .pdf" or "Ünite 1 - GİRİŞ.pdf"
        import re
        def natural_sort_key(s):
            return [int(text) if text.isdigit() else text.lower()
                    for text in re.split('([0-9]+)', str(s))]

        files.sort(key=natural_sort_key)

        for file_path in files:
            unit_name = file_path.stem
            run_script(file_path, lesson, unit_name)

if __name__ == "__main__":
    main()
