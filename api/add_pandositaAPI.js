export default async function handler(req, res) {
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
      'sticker': { dir: 'pandosita/img/sticker', prefix: 'sticker', ext: 'webp' },
      'gif': { dir: 'pandosita/img/gif', prefix: 'pandagif', ext: 'gif' },
      'sbatuffolart': { dir: 'pandosita/img/sbatuffolart', prefix: 'sbatuffolart', ext: 'jpg' },
      'sbatuffolai': { dir: 'pandosita/img/sbatuffolAI', prefix: 'sbatuffolai', ext: 'jpg' },
      'lulu': { dir: 'pandosita/img/lulu', prefix: 'lulu', ext: 'jpg' },
      'sfigatini': { dir: 'pandosita/img/sfigatini', prefix: 'sfigatini', ext: 'jpg' }
    };

    const configTarget = configMap[sezione];
    if (!configTarget) {
      throw new Error(`Sezione non riconosciuta: ${sezione}`);
    }

    // ==========================================
    // STEP 1: TROVA L'ULTIMO INDICE NELLA CARTELLA
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
      
      const regex = new RegExp(`^${configTarget.prefix}\\s*\\((\\d+)\\)\\.[a-z0-9]+$`, 'i');
      
      for (const file of files) {
        if (file.type === 'file') {
          const match = file.name.match(regex);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxIndex) {
              maxIndex = num;
            }
          }
        }
      }
      nextIndex = maxIndex + 1;
    } else if (dirRes.status !== 404) {
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

    return res.status(200).json({ message: "Immagine salvata con successo!", fileName: cleanFileName });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}