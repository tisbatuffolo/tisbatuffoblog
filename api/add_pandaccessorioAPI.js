export default async function handler(req, res) {
  // Configurazione CORS (stessa del tuo file pandagenda)
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
    const { titolo, imageB64, targetDir, jsFilePath, arrayName } = req.body;

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const REPO_OWNER = "tisbatuffolo"; 
    const REPO_NAME = "tisbatuffoblog";

    // 1. Genera un nome file pulito dall'input dell'utente (rimuove caratteri strani)
    const cleanFileName = titolo.replace(/[^a-zA-Z0-9 \-_]/g, '').trim() + '.jpg';
    const imageFullPath = `${targetDir}/${cleanFileName}`;

    // ==========================================
    // STEP 1: CARICA L'IMMAGINE SU GITHUB
    // ==========================================
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
          message: `Aggiunta immagine Pandaccessorio: ${titolo}`,
          content: imageB64 // È già puro base64 inviato dal client
        }),
      }
    );

    if (!uploadImgRes.ok) {
        // Se il file esiste già fallirà perché serve lo SHA, ma è improbabile se i nomi sono unici.
        const errorText = await uploadImgRes.text();
        throw new Error(`Errore caricamento immagine: ${errorText}`);
    }

    // ==========================================
    // STEP 2: SCARICA IL FILE JS ESISTENTE
    // ==========================================
    const getJsFile = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${jsFilePath}`,
      {
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (!getJsFile.ok) {
      throw new Error(`Impossibile recuperare il file JS: ${jsFilePath}`);
    }

    const jsFileData = await getJsFile.json();
    const sha = jsFileData.sha;
    
    // Decodifica il contenuto da base64
    let decodedContent = Buffer.from(jsFileData.content, 'base64').toString('utf8');

    // ==========================================
    // STEP 3: MODIFICA IL FILE JS (Regex Magica)
    // ==========================================
    // Cerchiamo l'array const arrayName = [ ... ];
    const arrayRegex = new RegExp(`(const\\s+${arrayName}\\s*=\\s*)(\\[[\\s\\S]*?\\])(\\s*;)`);
    const match = decodedContent.match(arrayRegex);

    if (!match) {
        throw new Error(`Impossibile trovare l'array ${arrayName} nel file JS.`);
    }

    // Facciamo il parse dell'array esistente
    let currentArray = [];
    try {
        // Tolgo eventuali virgole finali spurie che fanno arrabbiare JSON.parse
        let cleanArrayStr = match[2].replace(/,\s*\]$/, ']'); 
        currentArray = JSON.parse(cleanArrayStr);
    } catch (e) {
        throw new Error("Errore nel parsing del JSON interno al file .js");
    }

    // Aggiungiamo il nuovo record
    currentArray.push({
        "titolo": titolo,
        "immagine": cleanFileName
    });

    // Ricostruiamo la stringa con una formattazione pulita
    const newArrayString = JSON.stringify(currentArray, null, 4);
    
    // Sostituiamo il vecchio array con quello nuovo nel file .js
    decodedContent = decodedContent.replace(arrayRegex, `$1${newArrayString}$3`);

    // ==========================================
    // STEP 4: SALVA IL FILE JS SU GITHUB
    // ==========================================
    const updateJsRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${jsFilePath}`,
      {
        method: "PUT",
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({
          message: `Aggiornato array in ${jsFilePath} per ${titolo}`,
          content: Buffer.from(decodedContent).toString("base64"),
          sha: sha
        }),
      }
    );

    if (!updateJsRes.ok) {
      const errorMsg = await updateJsRes.text();
      throw new Error(`Errore durante l'aggiornamento del file JS: ${errorMsg}`);
    }

    return res.status(200).json({ message: "Immagine e Dati salvati con successo!" });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}