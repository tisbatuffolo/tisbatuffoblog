// PREVENZIONE BACKEND: Aumenta il limite del body per le immagini Base64
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  // Configurazione CORS speculare agli altri endpoint[cite: 12]
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();[cite: 12]
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Metodo non consentito" });[cite: 12]
  }

  try {
    // Otteniamo solo i dati che pandosità.html effettivamente invia[cite: 12]
    const { sezione, imageB64, mimeType } = req.body;[cite: 12]

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;[cite: 12]
    const REPO_OWNER = "tisbatuffolo";[cite: 12]
    const REPO_NAME = "tisbatuffoblog";[cite: 12]

    if (!GITHUB_TOKEN) {
      throw new Error("Configurazione GitHub (GITHUB_TOKEN) mancante in Vercel.");[cite: 12]
    }

    if (!sezione || !imageB64) {
      throw new Error("Dati mancanti: sezione o immagine non forniti dal client.");[cite: 12]
    }

    // Mappatura delle directory, prefissi e formati in base alla sezione[cite: 12]
    const configMap = {
      'sticker': { dir: 'img/sticker', prefix: 'sticker', ext: 'webp' },[cite: 12]
      'gif': { dir: 'img/gif', prefix: 'pandagif', ext: 'gif' },[cite: 12]
      'sbatuffolart': { dir: 'img/sbatuffolart', prefix: 'sbatuffolart', ext: 'jpg' },[cite: 12]
      'sbatuffolai': { dir: 'img/sbatuffolAI', prefix: 'sbatuffolai', ext: 'jpg' },[cite: 12]
      'lulu': { dir: 'img/lulu', prefix: 'lulu', ext: 'jpg' },[cite: 12]
      'sfigatini': { dir: 'img/sfigatini', prefix: 'sfigatini', ext: 'jpg' }[cite: 12]
    };

    const configTarget = configMap[sezione];
    if (!configTarget) {
      throw new Error(`Sezione non riconosciuta: ${sezione}`);[cite: 12]
    }

    // ==========================================
    // STEP 1: TROVA L'ULTIMO INDICE (NUMERO SEQUENZIALE) NELLA CARTELLA[cite: 12]
    // ==========================================
    const dirRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${configTarget.dir}`,[cite: 12]
      {
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,[cite: 12]
          Accept: "application/vnd.github+json",[cite: 12]
        }
      }
    );

    let nextIndex = 1;[cite: 12]

    if (dirRes.ok) {
      const files = await dirRes.json();[cite: 12]
      let maxIndex = 0;[cite: 12]
      
      // Cerca file nel formato "prefisso (numero).estensione" es. "sticker (42).webp"[cite: 12]
      const regex = new RegExp(`^${configTarget.prefix}\\s*\\((\\d+)\\)\\.[a-z0-9]+$`, 'i');[cite: 12]
      
      for (const file of files) {
        if (file.type === 'file') {
          const match = file.name.match(regex);[cite: 12]
          if (match) {
            const num = parseInt(match[1], 10);[cite: 12]
            if (num > maxIndex) {
              maxIndex = num;[cite: 12]
            }
          }
        }
      }
      // Il prossimo numero disponibile[cite: 12]
      nextIndex = maxIndex + 1;[cite: 12]
    } else if (dirRes.status !== 404) {
      // Se la cartella restituisce 404 significa che è vuota o nuova, partirà da 1.[cite: 12]
      const errorText = await dirRes.text();[cite: 12]
      throw new Error(`Errore nel recupero della cartella ${configTarget.dir}: ${errorText}`);[cite: 12]
    }

    // ==========================================
    // STEP 2: COSTRUISCI IL NOME E CARICA L'IMMAGINE[cite: 12]
    // ==========================================
    const cleanFileName = `${configTarget.prefix} (${nextIndex}).${configTarget.ext}`;[cite: 12]
    const imageFullPath = `${configTarget.dir}/${cleanFileName}`;[cite: 12]

    const uploadImgRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${imageFullPath}`,[cite: 12]
      {
        method: "PUT",[cite: 12]
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,[cite: 12]
          "Content-Type": "application/json",[cite: 12]
          Accept: "application/vnd.github+json",[cite: 12]
        },
        body: JSON.stringify({
          message: `Aggiunta nuova pandosità: ${cleanFileName} in ${sezione}`,[cite: 12]
          content: imageB64 [cite: 12]
        })
      }
    );

    if (!uploadImgRes.ok) {
        const errorText = await uploadImgRes.text();[cite: 12]
        throw new Error(`Errore caricamento immagine su GitHub: ${errorText}`);[cite: 12]
    }

    // Qui a differenza di pandamusic NON serve aggiornare alcun array JS[cite: 12]
    return res.status(200).json({ message: "Immagine salvata con successo!", fileName: cleanFileName });[cite: 12]

  } catch (error) {
    console.error(error);[cite: 12]
    return res.status(500).json({ error: error.message });[cite: 12]
  }
}