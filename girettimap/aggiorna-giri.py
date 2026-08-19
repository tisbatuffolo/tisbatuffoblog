import requests
from bs4 import BeautifulSoup
import json
import os
import html
import re

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
output_path = os.path.join(BASE_DIR, "giri.js")

URL = "https://www.outdooractive.com/it/list/girettimap/240115709/"

headers = {
    "User-Agent": "Mozilla/5.0",
    "Accept-Language": "it-IT,it;q=0.9"
}

print("🔄 Scarico la pagina...")
response = requests.get(URL, headers=headers)
response.raise_for_status()

soup = BeautifulSoup(response.text, "html.parser")

items = soup.find_all("div", class_="oax-listImage-snippet")
print(f"Trovati {len(items)} elementi totali")

giri = []

# Limita a 9 elementi per una perfetta griglia 3x3
for item in items[:9]:
    try:
        # LINK
        a_tag = item.find("a")
        link = a_tag["href"] if a_tag else ""

        # TITOLO
        titolo_tag = item.find("strong", class_="oax-region-title")
        titolo = titolo_tag.get_text(strip=True) if titolo_tag else "Senza titolo"

        # IMMAGINE
        img = ""

        # 1️⃣ prova data-src sull'immagine
        img_tag = item.find("img")
        if img_tag:
            img = img_tag.get("data-src") or img_tag.get("src") or ""

        # 2️⃣ se è placeholder vuoto, allora prendi dal input nascosto
        if not img or img.startswith("data:image/gif"):
            input_tag = item.select_one("output input.oax-load-path")
            if input_tag:
                value = html.unescape(input_tag.get("value", ""))
                # regex per trovare src: "URL"
                match = re.search(r'src:\s*"([^"]+)"', value)
                if match:
                    img = match.group(1)

        # Migliora qualità immagine
        if img:
            img = img.replace("120x120r", "800x600").replace("120x120", "800x600")

        giri.append({
            "titolo": titolo,
            "link": link,
            "img": img
        })

        print(f"✔ {titolo} → {img}")

    except Exception as e:
        print("Errore:", e)

# SALVA COME JS
with open(output_path, "w", encoding="utf-8") as f:
    f.write("const GIRI = ")
    json.dump(giri, f, ensure_ascii=False, indent=2)

print("✅ giri.js creato!")