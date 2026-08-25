// PREVENZIONE BACKEND: Aumenta il limite del body per le immagini Base64
const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

async function handler(req, res) {
  // Configurazione CORS speculare agli altri endpoint
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Metodo non consentito" });
  }

  try {
    // Otteniamo solo i dati che pandosità.html effettivamente invia
    const { sezione, imageB64, mimeType } = req.body;

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const REPO_OWNER = "tisbatuffolo";
    const REPO_NAME = "tisbatuffoblog";

    if (!GITHUB_TOKEN) {
      throw new Error("Configurazione GitHub (GITHUB_TOKEN) mancante in Vercel.");
    }

    if (!sezione || !imageB64) {
      throw new Error("Dati mancanti: sezione o immagine non forniti dal client.");
    }

    // Mappatura delle directory, prefissi e formati in base alla sezione
    const configMap = {
      'sticker': { dir: 'img/sticker', prefix: 'sticker', ext: 'webp' },
      'gif': { dir: 'img/gif', prefix: 'pandagif', ext: 'gif' },
      'sbatuffolart': { dir: 'img/sbatuffolart', prefix: 'sbatuffolart', ext: 'jpg' },
      'sbatuffolai': { dir: 'img/sbatuffolAI', prefix: 'sbatuffolai', ext: 'jpg' },
      'lulu': { dir: 'img/lulu', prefix: 'lulu', ext: 'jpg' },
      'sfigatini': { dir: 'img/sfigatini', prefix: 'sfigatini', ext: 'jpg' }
    };

    const configTarget = configMap[sezione];
    if (!configTarget) {
      throw new Error(`Sezione non riconosciuta: ${sezione}`);
    }

    // ==========================================
    // STEP 1: TROVA L'ULTIMO INDICE (NUMERO SEQUENZIALE) NELLA CARTELLA
    // ==========================================
    const dirRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${configTarget.dir}`,
      {
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        }
      }
    );

    let nextIndex = 1;

    if (dirRes.ok) {
      const files = await dirRes.json();
      let maxIndex = 0;
      
      // Cerca file nel formato "prefisso (numero).estensione" es. "sticker (42).webp"
      const regex = new RegExp(`^${configTarget.prefix}\\s*\\((\\d+)\\)\\.[a-z0-9]+$`, 'i');
      
      for (const file of files) {
        if (file.type === 'file') {
          const match = file.name.match(regex);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxIndex) {
              maxIndex = maxIndex < num ? num : maxIndex;
            }
          }
        }
      }
      // Il prossimo numero disponibile
      nextIndex = maxIndex + 1;
    } else if (dirRes.status !== 404) {
      // Se la cartella restituisce 404 significa che è vuota o nuova, partirà da 1.
      const errorText = await dirRes.text();
      throw new Error(`Errore nel recupero della cartella ${configTarget.dir}: ${errorText}`);
    }

    // ==========================================
    // STEP 2: COSTRUISCI IL NOME E CARICA L'IMMAGINE
    // ==========================================
    const cleanFileName = `${configTarget.prefix} (${nextIndex}).${configTarget.ext}`;
    const imageFullPath = `${configTarget.dir}/${cleanFileName}`;

    const uploadImgRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${imageFullPath}`,
      {
        method: "PUT",
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({
          message: `Aggiunta nuova pandosità: ${cleanFileName} in ${sezione}`,
          content: imageB64 
        })
      }
    );

    if (!uploadImgRes.ok) {
        const errorText = await uploadImgRes.text();
        throw new Error(`Errore caricamento immagine su GitHub: ${errorText}`);
    }

    // Qui a differenza di pandamusic NON serve aggiornare alcun array JS
    return res.status(200).json({ message: "Immagine salvata con successo!", fileName: cleanFileName });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}

// Esportazioni in stile CommonJS identiche a quelle funzionanti di add_pandaccessorioAPI
module.exports = handler;
module.exports.config = config;