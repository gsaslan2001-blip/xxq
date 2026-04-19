import os
import re
import subprocess
import sys
import asyncio
import signal
import atexit
from pathlib import Path

# Paths
BASE_DIR = r"C:\Users\FURKAN\Desktop\DUS\üretim"
PROJECT_DIR = r"c:\Users\FURKAN\Desktop\Projeler\DUSBANKASI"
SCRIPT_PATH = os.path.join(PROJECT_DIR, "scripts", "notebooklm-exhaust.py")
KEEPER_PATH = os.path.join(PROJECT_DIR, "scripts", "session_keeper.py")
KEEPER_INTERVAL = 1800  # saniye

# Lessons Configuration
LESSONS = {
    "Histoloji": os.path.join(BASE_DIR, "Histoloji"),
    "Endodonti": os.path.join(BASE_DIR, "Endodonti Ünite Pdf"),
    "Fizyoloji": os.path.join(BASE_DIR, "Fizyo ünite pdf"),
    "Periodontoloji": os.path.join(BASE_DIR, "Periodontoloji"),
    "Oral Patoloji": r"C:\Users\FURKAN\Desktop\DUS\patoloji\output\oral patoloji\md",
}

# ─── Session Keeper Yönetimi ──────────────────────────────────────────────────

_keeper_proc: subprocess.Popen | None = None


def _start_keeper():
    """session_keeper.py'ı arka planda başlatır."""
    global _keeper_proc
    if _keeper_proc is not None and _keeper_proc.poll() is None:
        return  # Zaten çalışıyor

    _keeper_proc = subprocess.Popen(
        [sys.executable, KEEPER_PATH, "--interval", str(KEEPER_INTERVAL)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
    )
    print(f"[KEEPER] Session Keeper baslatildi (PID: {_keeper_proc.pid}, aralik: {KEEPER_INTERVAL}s)")


def _stop_keeper():
    """Session Keeper'ı nazikçe durdurur."""
    global _keeper_proc
    if _keeper_proc is None or _keeper_proc.poll() is not None:
        return
    try:
        if sys.platform == "win32":
            _keeper_proc.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            _keeper_proc.terminate()
        _keeper_proc.wait(timeout=5)
    except Exception:
        _keeper_proc.kill()
    finally:
        print(f"[KEEPER] Session Keeper durduruldu (PID: {_keeper_proc.pid})")
        _keeper_proc = None


atexit.register(_stop_keeper)  # Herhangi bir çıkışta otomatik durdur


# ─── Auth Yönetimi ────────────────────────────────────────────────────────────

def _check_auth() -> bool:
    """Mevcut oturumun geçerliliğini kontrol eder."""
    try:
        from notebooklm.auth import fetch_tokens, load_auth_from_storage
        from notebooklm.paths import get_storage_path
        cookies = load_auth_from_storage(get_storage_path())
        asyncio.run(fetch_tokens(cookies))
        return True
    except Exception:
        return False


def _do_login():
    """notebooklm login'i interaktif olarak çalıştırır (kullanıcı giriş yapar)."""
    print("\n[AUTH] Oturum gecersiz veya bulunamadi.")
    print("[AUTH] notebooklm login baslatiliyor — tarayici acilacak...")
    print("[AUTH] Google hesabina giris yap, sonra terminale don ve ENTER'a bas.\n")
    result = subprocess.run(["notebooklm", "login"], check=False)
    if result.returncode != 0:
        print("[AUTH] Login basarisiz veya iptal edildi. Cikmak icin Ctrl+C.")
        sys.exit(1)
    print("[AUTH] Giris basarili.\n")


def ensure_logged_in():
    """Auth yoksa login açar, sonra keeper'ı başlatır."""
    if _check_auth():
        print("[AUTH] Oturum gecerli.")
    else:
        _do_login()
        if not _check_auth():
            print("[AUTH] Login sonrasi dogrulama basarisiz — tekrar dene.")
            sys.exit(1)
    _start_keeper()


# ─── Üretim Mantığı ───────────────────────────────────────────────────────────

def run_script(file_path, lesson, unit_name):
    print(f"\n>>> PROCESSING: {lesson} - {unit_name}")
    cmd = [
        sys.executable,
        SCRIPT_PATH,
        "--file", str(file_path),
        "--lesson", lesson,
        "--unit", unit_name,
    ]
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        print(f"!!! Error processing {unit_name}: {e}")
        print("!!! Üretim hatası nedeniyle pipeline durduruluyor.")
        sys.exit(1)


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Run Production Pipeline")
    parser.add_argument("--resume-lesson", default=None, help="Lesson to resume from")
    parser.add_argument("--resume-unit", default=None, help="Unit name to resume from")
    parser.add_argument("--skip-auth", action="store_true", help="Auth kontrolünü atla (debug)")
    args = parser.parse_args()

    # Oturum kontrol + keeper başlatma
    if not args.skip_auth:
        ensure_logged_in()
    else:
        _start_keeper()

    resume_lesson_found = args.resume_lesson is None
    resume_unit_found = args.resume_unit is None

    try:
        for lesson, folder in LESSONS.items():
            if not resume_lesson_found:
                if lesson == args.resume_lesson:
                    resume_lesson_found = True
                else:
                    print(f"Skipping lesson {lesson} (Waiting for resume target {args.resume_lesson})")
                    continue

            if not os.path.exists(folder):
                print(f"Skipping {lesson}: folder not found ({folder})")
                continue

            print(f"\n--- Starting {lesson} ---")
            files = [f for f in Path(folder).iterdir() if f.suffix.lower() in [".pdf", ".md"]]

            def natural_sort_key(s):
                return [int(t) if t.isdigit() else t.lower() for t in re.split("([0-9]+)", str(s))]

            files.sort(key=natural_sort_key)

            for file_path in files:
                unit_name = file_path.stem

                if not resume_unit_found and resume_lesson_found:
                    if unit_name == args.resume_unit:
                        resume_unit_found = True
                    else:
                        print(f"  Skipping {unit_name} (Waiting for resume target {args.resume_unit})")
                        continue

                run_script(file_path, lesson, unit_name)

    except KeyboardInterrupt:
        print("\n[PROD] Uretim kullanici tarafindan durduruldu.")
    finally:
        _stop_keeper()
        print("[PROD] Tamamlandi.")


if __name__ == "__main__":
    main()
