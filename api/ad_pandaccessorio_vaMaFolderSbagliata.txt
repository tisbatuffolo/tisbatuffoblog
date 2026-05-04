export default async function handler(req, res) {
  // Configurazione CORS
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
    const { titolo, imageB64, targetDir, jsFilePath, arrayName } = req.body;[cite: 9]

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;[cite: 9]
    const REPO_OWNER = "tisbatuffolo";[cite: 9]
    const REPO_NAME = "tisbatuffoblog";[cite: 9]

    // FIX PERCORSI: Forza l'inserimento nella sottocartella pandaccessori/
    const fixPath = (path) => path.startsWith("pandaccessori/") ? path : `pandaccessori/${path}`;
    const finalTargetDir = fixPath(targetDir);
    const finalJsFilePath = fixPath(jsFilePath);

    // 1. Genera un nome file pulito
    const cleanFileName = titolo.replace(/[^a-zA-Z0-9 \-_]/g, '').trim() + '.jpg';
    const imageFullPath = `${finalTargetDir}/${cleanFileName}`;

    // ==========================================
    // STEP 1: CARICA L'IMMAGINE SU GITHUB[cite: 9]
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
          content: imageB64 
        }),
        cache: 'no-store'
      }
    );

    if (!uploadImgRes.ok) {
        const errorText = await uploadImgRes.text();
        throw new Error(`Errore caricamento immagine: ${errorText}`);
    }

    // ==========================================
    // STEP 2: SCARICA IL FILE JS ESISTENTE[cite: 9]
    // ==========================================
    const getJsFile = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${finalJsFilePath}?t=${Date.now()}`,
      {
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
        cache: 'no-store'
      }
    );

    let sha = null;
    let decodedContent = "";

    if (getJsFile.ok) {
        const jsFileData = await getJsFile.json();
        sha = jsFileData.sha;
        decodedContent = Buffer.from(jsFileData.content, 'base64').toString('utf8');
    } else if (getJsFile.status === 404) {
        decodedContent = `const ${arrayName} = [];\n`;[cite: 9]
    } else {
        const errorText = await getJsFile.text();
        throw new Error(`Impossibile recuperare il file JS: ${finalJsFilePath}. Dettaglio: ${errorText}`);
    }

    // ==========================================
    // STEP 3: MODIFICA IL FILE JS[cite: 9]
    // ==========================================
    const arrayRegex = new RegExp(`(const\\s+${arrayName}\\s*=\\s*)(\\[[\\s\\S]*?\\])(\\s*;)`);
    const match = decodedContent.match(arrayRegex);

    if (!match) {
        throw new Error(`Impossibile trovare l'array ${arrayName} nel file JS.`);
    }

    let currentArray = [];
    try {
        currentArray = new Function(`return ${match[2]}`)();[cite: 9]
    } catch (e) {
        throw new Error("Errore nel parsing dell'array interno al file .js");
    }

    currentArray.push({
        "titolo": titolo,
        "immagine": cleanFileName
    });

    const newArrayString = JSON.stringify(currentArray, null, 4);
    decodedContent = decodedContent.replace(arrayRegex, `$1${newArrayString}$3`);

    // ==========================================
    // STEP 4: SALVA IL FILE JS SU GITHUB[cite: 9]
    // ==========================================
    const bodyData = {
      message: `Aggiornato array in ${finalJsFilePath} per ${titolo}`,
      content: Buffer.from(decodedContent).toString("base64")
    };
    
    if (sha) {
        bodyData.sha = sha;
    }

    const updateJsRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${finalJsFilePath}`,
      {
        method: "PUT",
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify(bodyData),
        cache: 'no-store'
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