import requests
from bs4 import BeautifulSoup
import json
import os
import html
import re

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
output_path = os.path.join(BASE_DIR, "giri.js")
img_dir = os.path.join(BASE_DIR, "img_giri")

# Crea la cartella locale per le immagini se non esiste
os.makedirs(img_dir, exist_ok=True)

URL = "https://www.outdooractive.com/it/list/girettimap/240115709/"

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "it-IT,it;q=0.9"
}

print("🔄 Scarico la pagina...")
try:
    response = requests.get(URL, headers=headers, timeout=15)
    response.raise_for_status()
except Exception as err:
    print(f"❌ Errore durante il caricamento di Outdooractive: {err}")
    exit(1)

soup = BeautifulSoup(response.text, "html.parser")
items = soup.find_all("div", class_="oax-listImage-snippet")
print(f"Trovati {len(items)} elementi totali")

giri = []
downloaded_files = []

# Prendiamo gli ultimi 9 della GirettiMap
for idx, item in enumerate(items[::-1][:9]):
    try:
        # LINK
        a_tag = item.find("a")
        link = a_tag["href"] if a_tag else ""

        # TITOLO
        titolo_tag = item.find("strong", class_="oax-region-title")
        titolo = titolo_tag.get_text(strip=True) if titolo_tag else "Senza titolo"

        # ESTRAI L'ID UNICO DAL LINK (Es: /350310622/ -> 350310622)
        match_id = re.search(r'/(\d+)/?$', link)
        giro_id = match_id.group(1) if match_id else f"index_{idx + 1}"

        # IMMAGINE REMOTE URL
        img_remote = ""
        img_tag = item.find("img")
        if img_tag:
            img_remote = img_tag.get("data-src") or img_tag.get("src") or ""

        if not img_remote or img_remote.startswith("data:image/gif"):
            input_tag = item.select_one("output input.oax-load-path")
            if input_tag:
                value = html.unescape(input_tag.get("value", ""))
                match_src = re.search(r'src:\s*"([^"]+)"', value)
                if match_src:
                    img_remote = match_src.group(1)

        local_img_path = ""
        if img_remote:
            img_remote = img_remote.replace("120x120r", "800x600").replace("120x120", "800x600")
            
            ext = "webp"
            if ".jpg" in img_remote.lower():
                ext = "jpg"
            elif ".png" in img_remote.lower():
                ext = "png"

            # Il file avrà il nome univoco basato sull'ID del giro
            filename = f"giro_{giro_id}.{ext}"
            filepath = os.path.join(img_dir, filename)

            # Download dell'immagine
            try:
                img_res = requests.get(img_remote, headers=headers, timeout=10)
                if img_res.status_code == 200:
                    with open(filepath, "wb") as f:
                        f.write(img_res.content)
                    local_img_path = f"img_giri/{filename}"
                    downloaded_files.append(filename)
                    print(f"✔ Scaricata anteprima locale: {filename}")
                else:
                    local_img_path = img_remote
            except Exception as download_err:
                print(f"⚠️ Impossibile scaricare l'immagine per {titolo}:", download_err)
                local_img_path = img_remote

        giri.append({
            "titolo": titolo,
            "link": link,
            "img": local_img_path
        })

    except Exception as e:
        print("Errore:", e)

# Pulizia di vecchie immagini non più nei primi 9 (esclusa l'eccezione .gitkeep)
for file_in_dir in os.listdir(img_dir):
    if file_in_dir not in downloaded_files and file_in_dir != ".gitkeep":
        try:
            os.remove(os.path.join(img_dir, file_in_dir))
            print(f"🗑 Rimossa vecchia immagine non più utilizzata: {file_in_dir}")
        except Exception as e:
            print("Errore durante la pulizia:", e)

# SALVA COME JS
with open(output_path, "w", encoding="utf-8") as f:
    f.write("const GIRI = ")
    json.dump(giri, f, ensure_ascii=False, indent=2)

print("✅ giri.js e cartella img_giri aggiornati con successo!")