#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
girettimap_scraper.py
======================
Scarica gli ULTIMI 9 "giri" dalla raccolta pubblica GirettiMap di
Outdooractive (https://www.outdooractive.com/it/list/girettimap/240115709/),
gestendo l'infinite scroll, e produce:

  1) giri.js
        const GIRI = [
          { "titolo": ..., "link": ..., "img": ... },
          ...
        ]
     L'ULTIMISSIMO elemento in fondo alla pagina (dopo lo scroll) diventa
     il PRIMO elemento dell'array (come da specifica).

  2) img_giri/giro<N>_<ID>.webp
        Immagine di copertina (variante 800x600) di ciascun giro.
        N   = posizione 1..9 nello stesso ordine di giri.js
        ID  = id numerico del percorso ricavato dall'URL del giro
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import os
import random
import re
import shutil
import sys
import time
from typing import List, Optional

try:
    import requests
    from PIL import Image
    from selenium.common.exceptions import (
        NoSuchElementException,
        SessionNotCreatedException,
        StaleElementReferenceException,
        TimeoutException,
        WebDriverException,
    )
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.support.ui import WebDriverWait
    import undetected_chromedriver as uc
    _MISSING_DEPS: Optional[str] = None
except ImportError as _imp_exc:  # noqa: N816
    _MISSING_DEPS = str(_imp_exc)

    class WebDriverException(Exception):  # type: ignore[no-redef]
        pass

    NoSuchElementException = SessionNotCreatedException = (
        StaleElementReferenceException
    ) = TimeoutException = WebDriverException
    By = EC = WebDriverWait = uc = requests = Image = None  # type: ignore


# --------------------------------------------------------------------------
# Configurazione
# --------------------------------------------------------------------------

LIST_URL = "https://www.outdooractive.com/it/list/girettimap/240115709/"
HOME_URL = "https://www.outdooractive.com/it/"

# VARIABILE PER LA VISUALIZZAZIONE DEL BROWSER:
# True  = Browser disattivato/nascosto (Headless) -> Consigliato per GitHub Actions / Server
# False = Browser visivo (Apre la finestra sul desktop) -> Utile per test in locale
HEADLESS_DEFAULT = True

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_JS = os.path.join(SCRIPT_DIR, "giri.js")
IMG_DIR = os.path.join(SCRIPT_DIR, "img_giri")

NUM_ITEMS = 9

MAX_SCROLL_ATTEMPTS = 80          
STALL_LIMIT = 5                   
SCROLL_PAUSE_RANGE = (1.0, 2.2)   
INITIAL_WAIT = 15                 
MAX_PAGE_RETRIES = 3              

ROUTE_HREF_RE = re.compile(r"/route/.+/(\d+)/?(?:[?#].*)?$")

COVER_IMG_RE = re.compile(
    r"(?:https?:)?//[\w-]+\.oastatic\.com/[\w\-/]*?/(\d+)x(\d+)/[\w.\-]+"
    r"\.(?:webp|jpe?g|png|avif)(?:\?[^\s\"'<>]*)?",
    re.IGNORECASE,
)

GENERIC_OASTATIC_IMG_RE = re.compile(
    r"(?:https?:)?//[\w-]+\.oastatic\.com/[^\s\"'<>]+\.(?:webp|jpe?g|png|avif)"
    r"(?:\?[^\s\"'<>]*)?",
    re.IGNORECASE,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("girettimap")


# --------------------------------------------------------------------------
# Setup del browser (anti-bot + compatibilità GitHub Actions / Linux)
# --------------------------------------------------------------------------

_VERSION_MISMATCH_RE = re.compile(
    r"Current browser version is (\d+)", re.IGNORECASE
)


def _new_chrome_options(headless: bool) -> "uc.ChromeOptions":
    options = uc.ChromeOptions()
    options.add_argument("--lang=it-IT")
    options.add_argument("--disable-blink-features=AutomationControlled")
    
    # Parametri obbligatori per eseguire Chrome in ambienti Linux / GitHub Actions senza interfaccia
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")

    if headless:
        options.add_argument("--window-size=1440,2200")
    else:
        options.add_argument("--start-maximized")
    return options


def build_driver(headless: bool = True, chrome_major: Optional[int] = None) -> "uc.Chrome":
    log.info(
        "Avvio Chrome in modalità %s.",
        "HEADLESS (nessuna finestra visibile)" if headless else "con finestra visibile",
    )
    kwargs = {
        "headless": headless,
        "use_subprocess": True,
    }
    if chrome_major:
        kwargs["version_main"] = chrome_major

    try:
        driver = uc.Chrome(options=_new_chrome_options(headless), **kwargs)
    except SessionNotCreatedException as exc:
        if chrome_major:
            raise
        match = _VERSION_MISMATCH_RE.search(str(exc))
        if not match:
            raise
        detected = int(match.group(1))
        log.warning(
            "ChromeDriver non compatibile con il Chrome installato: "
            "rilevata versione %d, riprovo forzando version_main=%d...",
            detected, detected,
        )
        driver = uc.Chrome(options=_new_chrome_options(headless), version_main=detected)

    driver.set_page_load_timeout(60)

    try:
        driver.execute_cdp_cmd(
            "Page.addScriptToEvaluateOnNewDocument",
            {
                "source": """
                    Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
                    Object.defineProperty(navigator, 'languages', {get: () => ['it-IT', 'it']});
                    Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
                """
            },
        )
    except WebDriverException:
        pass

    return driver


CONSENT_KEYWORDS = [
    "acconsento", "accetto", "accetta tutt", "accetta", "consenti tutt",
    "consenti", "accept all", "i agree", "agree", "ho capito", "d'accordo",
]


def _click_consent_button_in_current_context(driver) -> bool:
    try:
        elements = driver.find_elements(
            By.CSS_SELECTOR,
            "button, a[role='button'], div[role='button'], input[type='button'], input[type='submit']",
        )
    except WebDriverException:
        return False

    for el in elements:
        try:
            text = (el.text or "").strip().lower()
            if not text:
                text = (el.get_attribute("aria-label") or "").strip().lower()
            if not text:
                text = (el.get_attribute("value") or "").strip().lower()
            if not text:
                continue
            if any(kw in text for kw in CONSENT_KEYWORDS):
                if el.is_displayed() and el.is_enabled():
                    el.click()
                    return True
        except (StaleElementReferenceException, WebDriverException):
            continue
    return False


def dismiss_cookie_banner(driver, timeout: float = 10.0) -> None:
    deadline = time.time() + timeout
    closed_any = False

    while time.time() < deadline:
        if _click_consent_button_in_current_context(driver):
            closed_any = True
            log.info("Banner di consenso chiuso.")
            time.sleep(1)
            continue

        found_in_iframe = False
        try:
            iframes = driver.find_elements(By.TAG_NAME, "iframe")
        except WebDriverException:
            iframes = []

        for frame in iframes:
            try:
                driver.switch_to.frame(frame)
            except WebDriverException:
                continue
            try:
                if _click_consent_button_in_current_context(driver):
                    found_in_iframe = True
            finally:
                driver.switch_to.default_content()
            if found_in_iframe:
                break

        if found_in_iframe:
            closed_any = True
            log.info("Banner di consenso (in iframe) chiuso.")
            time.sleep(1)
            continue

        if closed_any:
            break
        time.sleep(0.5)


# --------------------------------------------------------------------------
# Infinite scroll & parsing
# --------------------------------------------------------------------------

def collect_route_anchors(driver) -> List:
    anchors = driver.find_elements(By.CSS_SELECTOR, "a[href*='/route/']")
    seen = set()
    unique = []
    for a in anchors:
        href = a.get_attribute("href") or ""
        if ROUTE_HREF_RE.search(href) and href not in seen:
            seen.add(href)
            unique.append(a)
    return unique


def scroll_to_load_all(driver, min_items: int = NUM_ITEMS) -> List:
    stall = 0
    last_count = 0

    for attempt in range(1, MAX_SCROLL_ATTEMPTS + 1):
        anchors = collect_route_anchors(driver)
        count = len(anchors)

        stall = stall + 1 if count == last_count else 0
        last_count = count

        log.info("Scroll #%d — giri caricati finora: %d", attempt, count)

        if stall >= STALL_LIMIT and count >= min_items:
            log.info("Nessun nuovo elemento dopo %d scroll: fine infinite scroll.", stall)
            break

        driver.execute_script(
            "window.scrollBy(0, Math.floor(window.innerHeight * 0.85));"
        )
        time.sleep(random.uniform(*SCROLL_PAUSE_RANGE))

        if attempt % 4 == 0:
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(random.uniform(*SCROLL_PAUSE_RANGE))

    driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
    time.sleep(2)

    return collect_route_anchors(driver)


def extract_title(driver, anchor) -> str:
    try:
        el = driver.execute_script(
            "return arguments[0].querySelector('strong, b, h2, h3');", anchor
        )
        if el:
            text = (el.get_attribute("textContent") or "").strip()
            if text:
                return text
    except WebDriverException:
        pass

    for attr in ("aria-label", "title"):
        val = anchor.get_attribute(attr)
        if val and val.strip():
            return val.strip()

    text = (anchor.get_attribute("textContent") or "").strip()
    return text.splitlines()[0].strip() if text else "Senza titolo"


def _normalize_protocol_relative(url: str) -> str:
    return "https:" + url if url.startswith("//") else url


def pick_cover_image_from_html(html: str) -> Optional[str]:
    if not html or "oastatic.com" not in html:
        return None

    candidates = [
        (m.group(0), int(m.group(1)), int(m.group(2)))
        for m in COVER_IMG_RE.finditer(html)
    ]
    if not candidates:
        return None

    for url, w, h in candidates:
        if w == 800 and h == 600:
            return _normalize_protocol_relative(url)

    candidates.sort(key=lambda c: abs(c[1] - 800) + abs(c[2] - 600))
    best_url, _, _ = candidates[0]
    upgraded = re.sub(r"/\d+x\d+/", "/800x600/", best_url, count=1)
    return _normalize_protocol_relative(upgraded)


def pick_cover_image_generic(html: str) -> Optional[str]:
    if not html or "oastatic.com" not in html:
        return None
    m = GENERIC_OASTATIC_IMG_RE.search(html)
    return _normalize_protocol_relative(m.group(0)) if m else None


def _gather_ancestor_htmls(driver, anchor, max_levels: int = 6) -> List[str]:
    try:
        driver.execute_script(
            "arguments[0].scrollIntoView({block: 'center', behavior: 'instant'});",
            anchor,
        )
    except WebDriverException:
        pass
    time.sleep(0.35)
    try:
        driver.execute_script("window.scrollBy(0, 2); window.scrollBy(0, -2);")
    except WebDriverException:
        pass
    time.sleep(0.25)

    js = """
    const a = arguments[0];
    const maxLevels = arguments[1];
    let node = a;
    const htmls = [];
    for (let i = 0; i < maxLevels && node; i++) {
        htmls.push(node.outerHTML || '');
        node = node.parentElement;
    }
    return htmls;
    """
    try:
        return driver.execute_script(js, anchor, max_levels) or []
    except WebDriverException:
        return []


def extract_image_url(driver, anchor) -> Optional[str]:
    htmls = _gather_ancestor_htmls(driver, anchor)
    for html in htmls:
        found = pick_cover_image_from_html(html)
        if found:
            return found

    for html in htmls:
        found = pick_cover_image_generic(html)
        if found:
            return found

    return None


def extract_route_id(href: str) -> str:
    m = ROUTE_HREF_RE.search(href)
    return m.group(1) if m else "unknown"


def build_requests_session(driver, user_agent: str) -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": user_agent,
            "Referer": LIST_URL,
            "Accept-Language": "it-IT,it;q=0.9",
        }
    )
    for cookie in driver.get_cookies():
        try:
            session.cookies.set(cookie["name"], cookie["value"], domain=cookie.get("domain"))
        except Exception:
            continue
    return session


def download_and_save_webp(session: requests.Session, url: str, dest_path: str) -> bool:
    try:
        resp = session.get(url, timeout=20)
        resp.raise_for_status()
    except requests.RequestException as exc:
        log.error("Download fallito per %s: %s", url, exc)
        return False

    try:
        img = Image.open(io.BytesIO(resp.content))
        img.load()
        img = img.convert("RGBA") if img.mode in ("RGBA", "P", "LA") else img.convert("RGB")
        img.save(dest_path, "WEBP", quality=90)
    except Exception as exc:
        log.error("Impossibile convertire/salvare l'immagine %s: %s", url, exc)
        return False

    return os.path.isfile(dest_path) and os.path.getsize(dest_path) > 0


def page_looks_blocked(driver) -> bool:
    try:
        title = (driver.title or "").lower()
        if "404" in title:
            return True
        body_text = driver.execute_script(
            "return document.body ? document.body.innerText.slice(0, 300) : '';"
        ) or ""
        if "404" in body_text and "not found" in body_text.lower():
            return True
    except WebDriverException:
        pass
    return False


def cleanup_output_artifacts(output_js_path: str, img_dir: str) -> None:
    os.makedirs(img_dir, exist_ok=True)
    if os.path.exists(output_js_path):
        os.remove(output_js_path)
    for name in os.listdir(img_dir):
        full_path = os.path.join(img_dir, name)
        try:
            if os.path.isdir(full_path) and not os.path.islink(full_path):
                shutil.rmtree(full_path)
            else:
                os.remove(full_path)
        except OSError:
            pass


def load_list_page(driver) -> bool:
    for attempt in range(1, MAX_PAGE_RETRIES + 1):
        if attempt == 1:
            log.info("Riscaldo la sessione: apro prima %s", HOME_URL)
            try:
                driver.get(HOME_URL)
                time.sleep(random.uniform(2.5, 4.0))
                dismiss_cookie_banner(driver)
                time.sleep(random.uniform(1.0, 2.0))
            except WebDriverException:
                pass

        log.info("Tentativo %d/%d — apro %s", attempt, MAX_PAGE_RETRIES, LIST_URL)
        driver.get(LIST_URL)

        try:
            WebDriverWait(driver, INITIAL_WAIT).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "a[href*='/route/'], body"))
            )
        except TimeoutException:
            pass

        if not page_looks_blocked(driver):
            return True

        wait_s = 5 * attempt
        log.warning("La pagina sembra bloccata. Riprovo tra %d secondi...", wait_s)
        time.sleep(wait_s)
        try:
            driver.get(HOME_URL)
            time.sleep(random.uniform(2.0, 3.5))
        except WebDriverException:
            pass

    return False


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Scarica gli ultimi 9 giri da GirettiMap.")
    parser.add_argument(
        "--headless",
        dest="headless",
        action="store_true",
        default=HEADLESS_DEFAULT,
        help="esegue il browser in background senza finestra",
    )
    parser.add_argument(
        "--visible",
        dest="headless",
        action="store_false",
        help="apre la finestra del browser e lo esegue in modalità visibile",
    )
    parser.add_argument("--debug", action="store_true", help="salva screenshot/html per debug")
    parser.add_argument("--chrome-major", type=int, default=None)
    args = parser.parse_args()

    os.makedirs(IMG_DIR, exist_ok=True)
    cleanup_output_artifacts(OUTPUT_JS, IMG_DIR)

    driver = build_driver(headless=args.headless, chrome_major=args.chrome_major)
    try:
        real_ua = driver.execute_script("return navigator.userAgent;")
        log.info("User-Agent reale del browser: %s", real_ua)

        if not load_list_page(driver):
            log.error("La pagina risulta bloccata (404/anti-bot) dopo %d tentativi.", MAX_PAGE_RETRIES)
            if args.debug:
                driver.save_screenshot(os.path.join(SCRIPT_DIR, "debug_screenshot.png"))
                with open(os.path.join(SCRIPT_DIR, "debug_page.html"), "w", encoding="utf-8") as f:
                    f.write(driver.page_source)
                log.info("Salvati debug_screenshot.png e debug_page.html")
            return 1

        dismiss_cookie_banner(driver)

        anchors = scroll_to_load_all(driver, min_items=NUM_ITEMS)
        log.info("Totale giri trovati dopo lo scroll: %d", len(anchors))

        if args.debug:
            driver.save_screenshot(os.path.join(SCRIPT_DIR, "debug_screenshot.png"))
            with open(os.path.join(SCRIPT_DIR, "debug_page.html"), "w", encoding="utf-8") as f:
                f.write(driver.page_source)
            log.info("Salvati debug_screenshot.png e debug_page.html")

        if not anchors:
            log.error("Nessun giro trovato.")
            return 1

        last_n = anchors[-NUM_ITEMS:]
        ordered = list(reversed(last_n))

        session = build_requests_session(driver, real_ua)

        giri_data = []
        for idx, anchor in enumerate(ordered, start=1):
            href = anchor.get_attribute("href") or ""
            title = extract_title(driver, anchor)
            img_url = extract_image_url(driver, anchor)
            route_id = extract_route_id(href)

            log.info("[%d/%d] %s (id=%s)", idx, len(ordered), title, route_id)

            if img_url:
                filename = f"giro{idx}_{route_id}.webp"
                dest_path = os.path.join(IMG_DIR, filename)
                download_and_save_webp(session, img_url, dest_path)

            giri_data.append(
                {
                    "titolo": title,
                    "link": href,
                    "img": img_url or "",
                }
            )

        js_body = json.dumps(giri_data, indent=2, ensure_ascii=False)
        js_content = f"const GIRI = {js_body}\n"

        with open(OUTPUT_JS, "w", encoding="utf-8") as f:
            f.write(js_content)

        log.info("File %s scritto correttamente (%d giri).", OUTPUT_JS, len(giri_data))
        return 0

    except WebDriverException as exc:
        log.error("Il browser si è chiuso o non risponde più (%s).", exc.__class__.__name__)
        return 1

    finally:
        try:
            driver.quit()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())