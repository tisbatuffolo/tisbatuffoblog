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

Uso:
    python girettimap_scraper.py
    python girettimap_scraper.py --debug       # salva screenshot/html di debug
    python girettimap_scraper.py --headless    # esegue senza finestra visibile

Dipendenze:
    pip install undetected-chromedriver selenium requests pillow

Requisiti di sistema:
    - Google Chrome installato (undetected-chromedriver ne rileva la versione
      e scarica automaticamente il driver corrispondente).

Note anti-bot:
  - Usiamo undetected-chromedriver al posto del Selenium "nudo": rimuove le
    tracce più comuni di automazione (navigator.webdriver, fingerprint CDP,
    ecc.) che i sistemi anti-bot controllano per primi.
  - User-Agent e lingua "it-IT" realistici, come un utente italiano.
  - Scroll incrementale con pause casuali ("umano"), invece di un salto
    diretto in fondo alla pagina, per non attivare rate-limiting.
  - Chiusura automatica del banner cookie/GDPR (necessario per interagire
    con la pagina sul dominio .it).
  - Le immagini vengono scaricate riusando i cookie di sessione del browser.
  - Se il sito dovesse comunque bloccare l'accesso: riprova con --headless
    disattivo (finestra visibile), rallenta ulteriormente SCROLL_PAUSE_RANGE,
    oppure esegui da una rete/IP residenziale.

IMPORTANTE:
    La struttura HTML di Outdooractive non è nota a priori con certezza al
    100% (il sito è renderizzato via JavaScript). Lo script usa selettori
    "robusti" basati sul pattern degli URL (/route/.../<ID>/) piuttosto che
    su classi CSS, proprio per resistere a piccole variazioni di markup.
    Se qualche campo (titolo o immagine) non dovesse essere trovato, esegui
    con --debug e ispeziona debug_page.html per adattare i selettori nelle
    funzioni extract_title() / extract_image_url().
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import os
import random
import re
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
    # Import "morbido": non falliamo subito all'avvio del modulo, così
    # `python scarica_giri.py --selftest` funziona anche su una macchina
    # dove le dipendenze del browser non sono ancora installate (il
    # selftest verifica solo la logica di parsing, senza aprire Chrome).
    # Il vero comando di scraping controlla _MISSING_DEPS in main() e
    # si ferma con un messaggio chiaro se qualcosa manca.
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

# Percorsi ASSOLUTI, ancorati alla cartella in cui si trova lo script
# (non alla cartella corrente da cui viene lanciato il comando "python").
# Senza questo, "giri.js" e "img_giri" finirebbero nella cartella di
# lavoro di PowerShell/CMD al momento del lancio, che può essere diversa
# dalla cartella dello script (è la causa più comune di "il file non
# viene creato" quando in realtà viene creato altrove).
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_JS = os.path.join(SCRIPT_DIR, "giri.js")
IMG_DIR = os.path.join(SCRIPT_DIR, "img_giri")

NUM_ITEMS = 9

MAX_SCROLL_ATTEMPTS = 80          # limite di sicurezza sui tentativi di scroll
STALL_LIMIT = 5                   # scroll consecutivi senza nuovi elementi -> stop
SCROLL_PAUSE_RANGE = (1.0, 2.2)   # pausa (sec) tra uno scroll e l'altro
INITIAL_WAIT = 15                 # attesa massima caricamento iniziale (sec)
MAX_PAGE_RETRIES = 3              # tentativi di ricaricare la pagina se torna un 404/blocco

# Riconosce un link a un singolo percorso, es:
# https://www.outdooractive.com/it/route/escursione/val-di-fassa/forca-rossa/350310622/
ROUTE_HREF_RE = re.compile(r"/route/.+/(\d+)/?(?:[?#].*)?$")

# Riconosce l'URL REALE di una foto di copertina Outdooractive, es:
# https://img2.oastatic.com/img2/636743303/800x600/variant.webp?revbust=1a01a98661b
# https://img1.oastatic.com/foto/12345/1200x900/cover.jpg
#
# NB: il dominio (img1/img2/img3.oastatic.com...) è assegnato dal
# bilanciatore di carico del sito ed è indipendente dal contenuto del
# path: il numero dopo "img" nel sottodominio NON è detto corrisponda al
# primo segmento del path (che a sua volta può non esistere affatto o
# chiamarsi diversamente). Una versione precedente di questa regex
# richiedeva il segmento letterale "/img2/" nel path: quando il sito
# assegnava un dominio diverso da "img2", *nessuna* immagine veniva mai
# trovata (bug: 100% delle foto mancanti, non solo alcune). Qui il primo
# segmento di path è quindi generico e facoltativo: contano solo (a) il
# dominio oastatic.com e (b) la cartella "<W>x<H>" seguita dal file
# immagine. Le iconcine (tipo attività, avatar profilo) vivono su
# domini/percorsi diversi (es. res*.oastatic.com/icons/...) e restano
# comunque escluse perché non hanno mai un'estensione immagine valida in
# quella posizione o non seguono questo pattern.
COVER_IMG_RE = re.compile(
    r"(?:https?:)?//[\w-]+\.oastatic\.com/[\w\-/]*?/(\d+)x(\d+)/[\w.\-]+"
    r"\.(?:webp|jpe?g|png|avif)(?:\?[^\s\"'<>]*)?",
    re.IGNORECASE,
)

# Fallback "generico": qualunque immagine oastatic.com con estensione
# nota, indipendentemente dal pattern <W>x<H> nel path. Usato SOLO come
# ultima spiaggia se COVER_IMG_RE non trova nulla su nessun livello di
# contenitore attorno al link del giro (copre un eventuale cambio di
# struttura URL da parte del sito che rimuova del tutto le dimensioni
# dal path, es. spostandole in querystring).
GENERIC_OASTATIC_IMG_RE = re.compile(
    r"(?:https?:)?//[\w-]+\.oastatic\.com/[^\s\"'<>]+\.(?:webp|jpe?g|png|avif)"
    r"(?:\?[^\s\"'<>]*)?",
    re.IGNORECASE,
)

# NB: NIENTE User-Agent finto/hardcoded qui. Impostare uno User-Agent
# manuale (es. una vecchia versione di Chrome) mentre il browser reale
# installato è più recente crea un disallineamento tra lo user-agent
# dichiarato e l'impronta reale (Client Hints "sec-ch-ua", TLS/JS
# fingerprint): è uno dei segnali più usati dai sistemi anti-bot per
# bloccare il traffico automatizzato (nel nostro caso probabilmente la
# causa del "404" restituito da Outdooractive). Lasciamo quindi che sia
# Chrome a dichiarare il proprio User-Agent reale, e lo leggiamo dal
# browser stesso dopo l'avvio (vedi main()).

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("girettimap")


# --------------------------------------------------------------------------
# Setup del browser (anti-bot)
# --------------------------------------------------------------------------

_VERSION_MISMATCH_RE = re.compile(
    r"Current browser version is (\d+)", re.IGNORECASE
)


def _new_chrome_options(headless: bool) -> "uc.ChromeOptions":
    """Crea un oggetto ChromeOptions NUOVO. undetected-chromedriver
    consuma/invalida l'oggetto ChromeOptions dopo il primo utilizzo, quindi
    ad ogni tentativo di avvio del driver serve un'istanza fresca (non
    riutilizzabile tra un tentativo e l'altro)."""
    options = uc.ChromeOptions()
    options.add_argument("--lang=it-IT")
    # Nessun --user-agent forzato: usiamo quello reale del browser installato
    # (vedi nota su USER_AGENT più sopra).
    options.add_argument("--disable-blink-features=AutomationControlled")
    if headless:
        # In modalità headless serve una dimensione esplicita del
        # "viewport" (non c'è una finestra reale da massimizzare).
        options.add_argument("--window-size=1440,2200")
    else:
        # Finestra visibile: la apriamo massimizzata invece di usare una
        # window-size fissa, così è sempre ben visibile qualunque sia la
        # risoluzione dello schermo. NON aggiungiamo qui nessun flag
        # "--headless": l'attivazione della modalità headless è delegata
        # esclusivamente al parametro `headless=` passato a uc.Chrome()
        # in build_driver(), che gestisce le patch anti-detection in modo
        # più affidabile rispetto ad aggiungere il flag manualmente.
        options.add_argument("--start-maximized")
    return options


def build_driver(headless: bool = False, chrome_major: Optional[int] = None) -> "uc.Chrome":
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
        # Caso tipico: undetected-chromedriver ha scaricato un driver per
        # una versione di Chrome diversa da quella installata sul PC
        # (es. "This version of ChromeDriver only supports Chrome version
        # 153. Current browser version is 152.0.7977.83"). Rileviamo la
        # versione REALMENTE installata dal messaggio d'errore e riproviamo
        # forzando quella, con un oggetto ChromeOptions NUOVO (quello
        # precedente non è più riutilizzabile), così undetected-chromedriver
        # scarica il driver corretto.
        if chrome_major:
            raise  # l'utente ha già forzato una versione: non ritentare
        match = _VERSION_MISMATCH_RE.search(str(exc))
        if not match:
            raise
        detected = int(match.group(1))
        log.warning(
            "ChromeDriver non compatibile con la Chrome installata: "
            "rilevata versione %d, riprovo forzando version_main=%d...",
            detected, detected,
        )
        driver = uc.Chrome(options=_new_chrome_options(headless), version_main=detected)

    driver.set_page_load_timeout(60)

    # Maschera ulteriori proprietà tipiche dei browser automatizzati
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


# Parole chiave dei pulsanti di consenso cookie/GDPR più comuni sui siti
# italiani/EU (diverse piattaforme — Sourcepoint, Quantcast, OneTrust,
# Cookiebot, ecc. — usano etichette diverse, a volte anche sulla stessa
# pagina in punti diversi, es. "Accetta" sulla home ma "Acconsento" sulla
# pagina di una raccolta).
CONSENT_KEYWORDS = [
    "acconsento", "accetto", "accetta tutt", "accetta", "consenti tutt",
    "consenti", "accept all", "i agree", "agree", "ho capito", "d'accordo",
]


def _click_consent_button_in_current_context(driver) -> bool:
    """Cerca, nel documento/frame correntemente attivo, un pulsante che
    contenga una delle CONSENT_KEYWORDS e lo clicca. Ritorna True se
    trovato e cliccato con successo."""
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
    """Chiude eventuali banner/modali di consenso cookie/GDPR, riprovando
    per qualche secondo (spesso compaiono con un piccolo ritardo dopo il
    caricamento della pagina) e cercando anche dentro eventuali iframe
    (molte piattaforme di consenso li renderizzano in un iframe dedicato,
    invisibile a una semplice ricerca nel documento principale)."""
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

    if not closed_any:
        log.info("Nessun banner di consenso rilevato (o già chiuso).")


# --------------------------------------------------------------------------
# Infinite scroll
# --------------------------------------------------------------------------

def collect_route_anchors(driver) -> List:
    """Ritorna la lista di elementi <a> che puntano a un percorso, in
    ordine di apparizione nel DOM (= ordine cronologico di caricamento),
    senza duplicati."""
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
    """Scrolla la pagina in modo incrementale finché il numero di 'giri'
    caricati smette di crescere (fine infinite scroll) o si raggiunge il
    limite di sicurezza."""
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

        # scroll incrementale "umano" invece di un salto secco in fondo
        driver.execute_script(
            "window.scrollBy(0, Math.floor(window.innerHeight * 0.85));"
        )
        time.sleep(random.uniform(*SCROLL_PAUSE_RANGE))

        # ogni tanto forziamo uno scroll fino in fondo per attivare il trigger
        if attempt % 4 == 0:
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(random.uniform(*SCROLL_PAUSE_RANGE))

    # scroll finale + pausa per dare tempo alle ultime immagini (lazy-load)
    # di comparire prima di leggerne gli attributi
    driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
    time.sleep(2)

    return collect_route_anchors(driver)


# --------------------------------------------------------------------------
# Estrazione dati di un giro
# --------------------------------------------------------------------------

def extract_title(driver, anchor) -> str:
    """Ricava il titolo del giro provando più strategie in cascata."""
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
    """Antepone 'https:' agli URL protocol-relative (//dominio/...), che
    alcuni componenti usano in srcset/style invece dell'URL assoluto."""
    return "https:" + url if url.startswith("//") else url


def pick_cover_image_from_html(html: str) -> Optional[str]:
    """Cerca nel frammento HTML fornito l'URL della foto di copertina,
    preferendo la variante 800x600 e altrimenti la variante con
    dimensioni più vicine (che viene poi "aggiornata" a 800x600 nel
    path). Funzione pura (nessuna dipendenza da Selenium/browser): è
    quindi testabile in isolamento, vedi `python scarica_giri.py
    --selftest`.
    """
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
    """Fallback meno preciso di `pick_cover_image_from_html`: prende la
    prima immagine oastatic.com nel blocco, qualunque sia il pattern del
    path. Usato solo se la funzione precisa non trova nulla su nessun
    livello di contenitore."""
    if not html or "oastatic.com" not in html:
        return None
    m = GENERIC_OASTATIC_IMG_RE.search(html)
    return _normalize_protocol_relative(m.group(0)) if m else None


def _gather_ancestor_htmls(driver, anchor, max_levels: int = 6) -> List[str]:
    """Porta l'anchor in vista (per forzare eventuale lazy-load basato su
    IntersectionObserver o su evento scroll) e poi raccoglie l'outerHTML
    dell'anchor stesso e dei suoi genitori, fino a `max_levels` livelli
    in su. Le foto di copertina vengono cercate su più livelli perché a
    seconda del componente possono trovarsi nell'anchor stesso o in un
    contenitore genitore (card/wrapper)."""
    try:
        driver.execute_script(
            "arguments[0].scrollIntoView({block: 'center', behavior: 'instant'});",
            anchor,
        )
    except WebDriverException:
        pass
    time.sleep(0.35)
    try:
        # Piccolo "nudge" di scroll: alcuni loader lazy più datati si
        # agganciano all'evento scroll invece che a un IntersectionObserver
        # e non si attivano con scrollIntoView da solo.
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
    """Trova l'URL reale della foto di copertina del giro.

    Non ci basiamo su un attributo img/srcset specifico: il sito carica le
    foto in lazy-loading e, finché non sono nel viewport, l'<img> mostra
    solo un placeholder, mentre l'URL vero può stare in vari attributi a
    seconda del componente. Invece cerchiamo direttamente, nel codice
    HTML del blocco che contiene il link, un URL che rispetti il pattern
    noto delle foto di copertina di Outdooractive — funziona
    indipendentemente da quale attributo lo contiene.
    """
    htmls = _gather_ancestor_htmls(driver, anchor)

    # Strategia 1 (precisa): pattern con dimensioni <W>x<H> nel path,
    # su ciascun livello di contenitore.
    for html in htmls:
        found = pick_cover_image_from_html(html)
        if found:
            return found

    # Strategia 2 (fallback): qualunque immagine oastatic.com nel blocco,
    # usata solo se la strategia 1 non ha trovato nulla su nessun livello.
    for html in htmls:
        found = pick_cover_image_generic(html)
        if found:
            return found

    return None


def extract_route_id(href: str) -> str:
    m = ROUTE_HREF_RE.search(href)
    return m.group(1) if m else "unknown"


# --------------------------------------------------------------------------
# Download immagini
# --------------------------------------------------------------------------

def build_requests_session(driver, user_agent: str) -> requests.Session:
    """Sessione requests che riusa i cookie del browser, così le richieste
    alle immagini arrivano con la stessa 'identità' (user-agent + cookie)
    della pagina appena visitata."""
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
        except Exception:  # noqa: BLE001
            continue
    return session


def download_and_save_webp(session: requests.Session, url: str, dest_path: str) -> bool:
    """Scarica l'immagine e la salva SEMPRE come .webp valido (convertendo
    se necessario), verificando che il file scritto sia integro."""
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
    except Exception as exc:  # noqa: BLE001
        log.error("Impossibile convertire/salvare l'immagine %s: %s", url, exc)
        return False

    ok = os.path.isfile(dest_path) and os.path.getsize(dest_path) > 0
    if ok:
        log.info("Immagine salvata: %s (%d KB)", dest_path, os.path.getsize(dest_path) // 1024)
    else:
        log.error("File immagine non scritto correttamente: %s", dest_path)
    return ok


def dump_debug_card(driver, anchor, idx: int) -> None:
    """Salva (solo in modalità --debug) l'HTML dei livelli di contenitore
    attorno all'anchor di un giro, per capire perché non vi si è trovata
    l'immagine di copertina."""
    js = """
    const a = arguments[0];
    let node = a;
    const htmls = [];
    for (let i = 0; i < 6 && node; i++) {
        htmls.push(node.outerHTML || '');
        node = node.parentElement;
    }
    return htmls;
    """
    try:
        htmls = driver.execute_script(js, anchor) or []
    except WebDriverException:
        htmls = []

    path = os.path.join(SCRIPT_DIR, f"debug_card_{idx}.html")
    try:
        with open(path, "w", encoding="utf-8") as f:
            for level, html in enumerate(htmls):
                f.write(f"<!-- ===== livello {level} ===== -->\n{html}\n\n")
        log.info("Salvato %s per capire perché manca l'immagine.", path)
    except OSError as exc:
        log.warning("Impossibile salvare %s: %s", path, exc)


def page_looks_blocked(driver) -> bool:
    """Rileva se la pagina caricata è in realtà un blocco anti-bot
    travestito da 404 (pattern osservato: titolo/contenuto '404 Not
    Found' servito da nginx invece della pagina reale della raccolta)."""
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


def load_list_page(driver) -> bool:
    """Carica la pagina della lista con un 'riscaldamento' della sessione:
    passa prima dalla home page (come farebbe un utente reale che arriva
    da Google/homepage, non un link diretto) e ritenta con pause
    crescenti se la pagina torna bloccata (404 sospetto)."""
    for attempt in range(1, MAX_PAGE_RETRIES + 1):
        if attempt == 1:
            log.info("Riscaldo la sessione: apro prima %s", HOME_URL)
            try:
                driver.get(HOME_URL)
                time.sleep(random.uniform(2.5, 4.0))
                dismiss_cookie_banner(driver)
                time.sleep(random.uniform(1.0, 2.0))
            except WebDriverException as exc:
                log.warning("Riscaldamento fallito (%s), procedo comunque.", exc)

        log.info("Tentativo %d/%d — apro %s", attempt, MAX_PAGE_RETRIES, LIST_URL)
        driver.get(LIST_URL)

        try:
            WebDriverWait(driver, INITIAL_WAIT).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "a[href*='/route/'], body"))
            )
        except TimeoutException:
            log.warning("Timeout in attesa del primo caricamento.")

        if not page_looks_blocked(driver):
            return True

        wait_s = 5 * attempt
        log.warning(
            "La pagina sembra bloccata (404 sospetto) al tentativo %d/%d. "
            "Riprovo tra %d secondi (passando di nuovo dalla home)...",
            attempt, MAX_PAGE_RETRIES, wait_s,
        )
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
    parser.add_argument("--headless", action="store_true", help="esegue il browser senza finestra")
    parser.add_argument("--debug", action="store_true", help="salva screenshot/html per debug")
    parser.add_argument(
        "--chrome-major", type=int, default=None,
        help="forza la versione major di Chrome (es. 152) se l'auto-rilevamento fallisce",
    )
    args = parser.parse_args()

    os.makedirs(IMG_DIR, exist_ok=True)

    driver = build_driver(headless=args.headless, chrome_major=args.chrome_major)
    try:
        real_ua = driver.execute_script("return navigator.userAgent;")
        log.info("User-Agent reale del browser: %s", real_ua)

        if not load_list_page(driver):
            log.error(
                "La pagina risulta bloccata (404 sospetto) dopo %d tentativi. "
                "Probabile blocco anti-bot lato Outdooractive. Prova a: "
                "attendere qualche minuto, eseguire SENZA --headless, oppure "
                "cambiare rete/IP.",
                MAX_PAGE_RETRIES,
            )
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
            log.error(
                "Nessun giro trovato. Il markup del sito potrebbe essere "
                "cambiato oppure la pagina è stata bloccata: esegui con "
                "--debug e ispeziona debug_page.html / debug_screenshot.png."
            )
            return 1

        if len(anchors) < NUM_ITEMS:
            log.warning(
                "Trovati solo %d giri (< %d richiesti): uso quelli disponibili.",
                len(anchors), NUM_ITEMS,
            )

        # ultimi N elementi nell'ordine del DOM (dall'alto verso il basso)
        last_n = anchors[-NUM_ITEMS:]

        # l'ultimissimo elemento in fondo alla pagina deve diventare il
        # PRIMO elemento dell'array in giri.js -> invertiamo l'ordine
        ordered = list(reversed(last_n))

        session = build_requests_session(driver, real_ua)

        giri_data = []
        for idx, anchor in enumerate(ordered, start=1):
            href = anchor.get_attribute("href") or ""
            title = extract_title(driver, anchor)
            img_url = extract_image_url(driver, anchor)
            route_id = extract_route_id(href)

            log.info("[%d/%d] %s (id=%s)", idx, len(ordered), title, route_id)

            if not img_url:
                log.error("Nessuna immagine trovata per '%s' — salto il download.", title)
                if args.debug:
                    dump_debug_card(driver, anchor, idx)
            else:
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

        # ------------------------------------------------------------
        # Scrittura di giri.js
        # ------------------------------------------------------------
        js_body = json.dumps(giri_data, indent=2, ensure_ascii=False)
        js_content = f"const GIRI = {js_body}\n"

        with open(OUTPUT_JS, "w", encoding="utf-8") as f:
            f.write(js_content)

        # verifica integrità del file appena scritto
        with open(OUTPUT_JS, "r", encoding="utf-8") as f:
            written = f.read()
        if written != js_content:
            log.error("Il contenuto scritto su %s non corrisponde a quello atteso!", OUTPUT_JS)
            return 1

        log.info("File %s scritto correttamente (%d giri).", OUTPUT_JS, len(giri_data))
        return 0

    except WebDriverException as exc:
        log.error(
            "Il browser si è chiuso o non risponde più (%s). Se hai chiuso "
            "manualmente la finestra di Chrome, rilancia lo script e lasciala "
            "aperta fino alla fine.",
            exc.__class__.__name__,
        )
        return 1

    finally:
        try:
            driver.quit()
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    sys.exit(main())