"""
aggiorna-giri.py (Versione con pulizia cartella, nomi giroN_IDgiro.webp e download via requests)
"""

import json
import os
import re
import sys
import requests
from io import BytesIO
from PIL import Image
from playwright.sync_api import sync_playwright

# --------------------------------------------------------------------------
# CONFIGURAZIONE
# --------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(BASE_DIR, "giri.js")
IMG_DIR = os.path.join(BASE_DIR, "img_giri")

URL = "https://www.outdooractive.com/it/list/girettimap/240115709/"
HEADLESS = True
N_GIRI = 9

POSSIBILI_SELETTORI = [
    ".oax_dp_snippet", "article.oax-card", ".list-item", 
    "li.oax-list-item", "[data-gtm-list-item]", ".oax-snippet"
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
}

# --------------------------------------------------------------------------
# FUNZIONI DI SUPPORTO
# --------------------------------------------------------------------------
def chiudi_banner_cookie(page):
    selettori_banner = [
        "#onetrust-accept-btn-handler", "button:has-text('Accetta tutti')",
        "button:has-text('Accetta')", "button:has-text('OK')"
    ]
    for sel in selettori_banner:
        try:
            btn = page.locator(sel).first
            if btn.is_visible(timeout=1000):
                btn.click(timeout=1000)
                page.wait_for_timeout(400)
                return
        except Exception:
            pass

def trova_selettore_attivo(page):
    for sel in POSSIBILI_SELETTORI:
        try:
            if page.locator(sel).count() > 0:
                print(f"✅ Selettore valido individuato: '{sel}'")
                return sel
        except Exception:
            pass
    return None

def scorri_fino_in_fondo(page, selector):
    tentativi_stabili = 0
    for tentativo in range(1, 81):
        conteggio_prima = page.locator(selector).count()
        page.evaluate("window.scrollTo(0, document.body.scrollHeight);")
        page.wait_for_timeout(1200)
        conteggio_dopo = page.locator(selector).count()
        
        if conteggio_dopo == conteggio_prima:
            tentativi_stabili += 1
            if tentativi_stabili >= 4:
                break
        else:
            tentativi_stabili = 0
    return page.locator(selector).count()

def estrai_id_da_link(link):
    match = re.search(r"/(\d+)/?(?:$|[?#])", link)
    return match.group(1) if match else "0"

# --------------------------------------------------------------------------
# PIPELINE PRINCIPALE
# --------------------------------------------------------------------------
def main():
    print("🔄 Apro il browser e carico GirettiMap...")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=HEADLESS, slow_mo=100)
        context = browser.new_context(user_agent=HEADERS["User-Agent"])
        page = context.new_page()
        
        try:
            page.goto(URL, timeout=45000)
        except Exception as e:
            print(f"❌ Errore di caricamento: {e}")
            sys.exit(1)

        chiudi_banner_cookie(page)
        page.wait_for_timeout(2000)

        selettore_attivo = trova_selettore_attivo(page)
        if not selettore_attivo:
            print("❌ Selettore non trovato.")
            sys.exit(1)

        print("📜 Scorro la lista...")
        scorri_fino_in_fondo(page, selettore_attivo)

        elementi = page.locator(selettore_attivo)
        totale_elementi = elementi.count()
        
        indice_iniziale = max(0, totale_elementi - N_GIRI)
        indici_ultimi = list(range(indice_iniziale, totale_elementi))
        indici_ultimi.reverse()

        giri_temp = []

        print(f"\n📋 Estrazione dati dei {len(indici_ultimi)} giri:")
        for posizione, idx in enumerate(indici_ultimi, start=1):
            el = elementi.nth(idx)
            
            try:
                el.scroll_into_view_if_needed()
                page.wait_for_timeout(300)
            except Exception:
                pass

            dati_giro = el.evaluate("""el => {
                const a = el.querySelector('a[href]');
                let link = a ? a.href : '';
                if (link && link.startsWith('/')) link = 'https://www.outdooractive.com' + link;

                let titolo = "Senza titolo";
                const titleEl = el.querySelector('[class*="title"], [class*="name"], [class*="headline"], h2, h3');
                if (titleEl && titleEl.textContent.trim()) titolo = titleEl.textContent.trim();
                else if (a && a.title) titolo = a.title.trim();

                let imgUrl = "";
                const imgs = el.querySelectorAll('img');
                for (let img of imgs) {
                    const src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.src || '';
                    if (src && !src.includes('/icons/') && !src.endsWith('.svg') && !src.startsWith('data:image/')) {
                        imgUrl = src;
                        break;
                    }
                }

                if (!imgUrl) {
                    const bgDivs = el.querySelectorAll('[style*="background-image"]');
                    for (let div of bgDivs) {
                        const style = div.style.backgroundImage;
                        const match = style.match(/url\\((['"]?)(.*?)\\1\\)/);
                        if (match && match[2]) {
                            const bgUrl = match[2];
                            if (!bgUrl.includes('/icons/') && !bgUrl.endsWith('.svg')) {
                                imgUrl = bgUrl;
                                break;
                            }
                        }
                    }
                }

                return { titolo, link, imgUrl };
            }""")

            titolo = dati_giro["titolo"]
            link = dati_giro["link"]
            img_originale = dati_giro["imgUrl"]
            
            img_800 = img_originale
            if img_800 and "oastatic.com" in img_800:
                img_800 = re.sub(r'/\d+x\d+[^/]*/', '/800x600/', img_800)

            print(f"  {posizione}. {titolo}")
            
            giri_temp.append({
                "titolo": titolo,
                "link": link,
                "img": img_800
            })

        # 1. SCRITTURA FILE JS
        with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
            f.write("const GIRI = ")
            json.dump(giri_temp, f, ensure_ascii=False, indent=2)
        print("\n📝 File giri.js scritto con successo.")
        
        # Chiudo il browser perché l'estrazione web è terminata
        browser.close()


    # 2. GESTIONE CARTELLA IMMAGINI (Cancellazione vecchie e download nuove)
    print("\n🧹 Pulizia della cartella delle immagini...")
    if not os.path.exists(IMG_DIR):
        os.makedirs(IMG_DIR)
        print(f"Cartella '{IMG_DIR}' creata.")
    else:
        # Cancella tutti i file presenti all'interno della cartella img_giri
        for file_nome in os.listdir(IMG_DIR):
            file_path = os.path.join(IMG_DIR, file_nome)
            if os.path.isfile(file_path):
                try:
                    os.remove(file_path)
                except Exception as e:
                    print(f"Impossibile eliminare {file_nome}: {e}")
        print("🗑️ Vecchie immagini rimosse con successo.")

    print("\n📥 Avvio download delle nuove immagini leggendo da giri.js...")

    with open(OUTPUT_PATH, "r", encoding="utf-8") as file:
        contenuto = file.read()

    # Pulizia del file per trasformarlo in un formato JSON valido
    json_str = contenuto.replace("const GIRI = ", "").strip()
    if json_str.endswith(";"):
        json_str = json_str[:-1]

    dati = json.loads(json_str)

    # Iterazione sugli elementi (posizione N parte da 1)
    for i, elemento in enumerate(dati, start=1):
        url_img = elemento.get("img") 
        link = elemento.get("link", "")
        
        # Estrae l'ID dal link del giro
        id_giro = estrai_id_da_link(link)
        
        # Nome file strutturato come richiesto: giroN_IDgiro.webp
        nome_file = f"giro{i}_{id_giro}.webp"
        percorso_salvataggio = os.path.join(IMG_DIR, nome_file)
        
        if url_img:
            print(f"Scaricando l'immagine {i} (ID: {id_giro})...")
            try:
                risposta = requests.get(url_img, timeout=10)
                
                if risposta.status_code == 200:
                    immagine = Image.open(BytesIO(risposta.content))
                    
                    # Forza il ridimensionamento a 800x600
                    immagine = immagine.resize((800, 600))
                    
                    if immagine.mode != "RGB":
                        immagine = immagine.convert("RGB")
                        
                    immagine.save(percorso_salvataggio, "WEBP")
                    print(f" -> Salvata correttamente in: img_giri/{nome_file}")
                else:
                    print(f" -> Errore {risposta.status_code} durante il download di {url_img}")
                    
            except Exception as e:
                print(f" -> Si è verificato un errore per l'immagine {i}: {e}")

    print("\n✅ Tutte le operazioni sono state completate con successo!")

if __name__ == "__main__":
    main()