"""
NotebookLM Session Keeper
Arka planda Playwright profiliyle oturumu periyodik olarak tazeler.
Kullanım: python session_keeper.py [--interval 1800] [--once]
"""

import asyncio
import json
import logging
import sys
import argparse
import subprocess
from datetime import datetime
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [KEEPER] %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

DEFAULT_INTERVAL = 1800  # 30 dakika
NOTEBOOKLM_URL = "https://notebooklm.google.com/"


def _get_paths():
    from notebooklm.paths import get_storage_path, get_browser_profile_dir
    return get_storage_path(), get_browser_profile_dir()


def _refresh_via_playwright() -> bool:
    """
    Playwright persistent profile ile NotebookLM'e sessizce baglanir,
    taze cookie kaydeder. True = basari.
    """
    try:
        from playwright.sync_api import sync_playwright, Error as PlaywrightError
    except ImportError:
        log.error("Playwright yuklu degil. Calistir: pip install playwright && playwright install chromium")
        return False

    try:
        storage_path, browser_profile = _get_paths()
    except Exception as e:
        log.error("Yol alinamadi: %s", e)
        return False

    if not browser_profile.exists():
        log.error(
            "Playwright profili bulunamadi: %s\n"
            "   Once 'notebooklm login' komutunu calistir.",
            browser_profile,
        )
        return False

    import asyncio as _asyncio
    if sys.platform == "win32":
        _asyncio.set_event_loop_policy(_asyncio.DefaultEventLoopPolicy())

    try:
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                user_data_dir=str(browser_profile),
                headless=True,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--password-store=basic",
                    "--no-sandbox",
                ],
                ignore_default_args=["--enable-automation"],
            )
            try:
                page = context.pages[0] if context.pages else context.new_page()

                # NotebookLM'e git — zaten giris yapiliysa cookie tazlenir
                try:
                    page.goto(NOTEBOOKLM_URL, timeout=30000, wait_until="networkidle")
                except PlaywrightError:
                    page.goto(NOTEBOOKLM_URL, timeout=30000, wait_until="commit")

                final_url = page.url
                if "accounts.google.com" in final_url or "signin" in final_url.lower():
                    log.warning(
                        "Google giris sayfasina yonlendirildi — oturum tamamen sona ermis.\n"
                        "   Cozum: 'notebooklm login' komutunu manual calistir."
                    )
                    return False

                # Cookie'leri kaydet
                storage_path.parent.mkdir(parents=True, exist_ok=True)
                context.storage_state(path=str(storage_path))
                log.info("Cookie yenilendi -> %s", storage_path)
                return True

            finally:
                context.close()

    except PlaywrightError as e:
        log.error("Playwright hatasi: %s", e)
        return False
    except Exception as e:
        log.error("Beklenmedik hata: %s", e)
        return False


async def _verify_auth() -> bool:
    """Kaydedilen cookie'lerin NotebookLM'de gecerli olup olmadigini kontrol eder."""
    try:
        from notebooklm.auth import fetch_tokens, load_auth_from_storage
        from notebooklm.paths import get_storage_path
        cookies = load_auth_from_storage(get_storage_path())
        await fetch_tokens(cookies)
        return True
    except Exception as e:
        log.warning("Auth dogrulama basarisiz: %s", e)
        return False


async def keep_alive(interval: int) -> None:
    """Ana dongü: interval saniyede bir cookie'yi tazeler ve dogrular."""
    log.info("Session Keeper basladi (yenileme arasi: %ds = %.0f dk)", interval, interval / 60)

    # Ilk kontrolü hemen yap
    first_check = await _verify_auth()
    if first_check:
        log.info("Mevcut oturum gecerli — ilk yenileme atlandi.")
    else:
        log.info("Oturum suresi dolmus, hemen yenileniyor...")
        _refresh_via_playwright()

    while True:
        await asyncio.sleep(interval)
        ts = datetime.now().strftime("%H:%M:%S")
        log.info("[%s] Periyodik cookie yenileme basliyor...", ts)

        ok = _refresh_via_playwright()
        if ok:
            valid = await _verify_auth()
            if valid:
                log.info("Oturum taze ve gecerli.")
            else:
                log.warning("Cookie yazildi ama NotebookLM dogrulamasi basarisiz.")
        else:
            log.error("Cookie yenileme basarisiz. %ds sonra tekrar denenecek.", interval)


def main():
    parser = argparse.ArgumentParser(description="NotebookLM oturumunu taze tutar")
    parser.add_argument(
        "--interval",
        type=int,
        default=DEFAULT_INTERVAL,
        help=f"Yenileme araligi (saniye, varsayilan: {DEFAULT_INTERVAL})",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Tek seferlik yenile ve cik (cron icin)",
    )
    args = parser.parse_args()

    if args.once:
        ok = _refresh_via_playwright()
        if ok:
            valid = asyncio.run(_verify_auth())
            if valid:
                print("Oturum yenilendi ve dogrulandi.")
                sys.exit(0)
            else:
                print("Cookie yazildi ama dogrulama basarisiz.")
                sys.exit(1)
        else:
            print("Cookie yenileme basarisiz.")
            sys.exit(1)

    try:
        asyncio.run(keep_alive(args.interval))
    except KeyboardInterrupt:
        log.info("Session Keeper durduruldu.")


if __name__ == "__main__":
    main()
