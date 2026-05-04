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
    const { titolo, imageB64, targetDir, jsFilePath, arrayName } = req.body;

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const REPO_OWNER = "tisbatuffolo"; 
    const REPO_NAME = "tisbatuffoblog";

    // 1. Genera un nome file pulito
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
          content: imageB64 
        }),
        cache: 'no-store' // EVITIAMO LA CACHE
      }
    );

    if (!uploadImgRes.ok) {
        const errorText = await uploadImgRes.text();
        throw new Error(`Errore caricamento immagine: ${errorText}`);
    }

    // ==========================================
    // STEP 2: SCARICA IL FILE JS ESISTENTE (O PREPARALO SE NON ESISTE)
    // ==========================================
    // Aggiungiamo un timestamp (?t=...) per ingannare Vercel e GitHub forzando dati freschi
    const getJsFile = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${jsFilePath}?t=${Date.now()}`,
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
        // Se il file non esiste su GitHub, lo creiamo noi automaticamente al volo!
        decodedContent = `const ${arrayName} = [];\n`;
        console.log(`File JS non trovato. Ne verrà creato uno nuovo: ${jsFilePath}`);
    } else {
        const errorText = await getJsFile.text();
        throw new Error(`Impossibile recuperare il file JS: ${jsFilePath}. Dettaglio GitHub: ${errorText}`);
    }

    // ==========================================
    // STEP 3: MODIFICA IL FILE JS
    // ==========================================
    const arrayRegex = new RegExp(`(const\\s+${arrayName}\\s*=\\s*)(\\[[\\s\\S]*?\\])(\\s*;)`);
    const match = decodedContent.match(arrayRegex);

    if (!match) {
        throw new Error(`Impossibile trovare l'array ${arrayName} nel file JS. Assicurati che la sintassi sia "const ${arrayName} = [...];"`);
    }

    let currentArray = [];
    try {
        // Uso 'new Function' invece di JSON.parse: è un trucchetto fantastico 
        // per bypassare gli errori di sintassi se nel file hai usato apici singoli ('panda')
        currentArray = new Function(`return ${match[2]}`)();
    } catch (e) {
        throw new Error("Errore nel parsing dell'array interno al file .js");
    }

    // Aggiungiamo il nuovo record
    currentArray.push({
        "titolo": titolo,
        "immagine": cleanFileName
    });

    const newArrayString = JSON.stringify(currentArray, null, 4);
    decodedContent = decodedContent.replace(arrayRegex, `$1${newArrayString}$3`);

    // ==========================================
    // STEP 4: SALVA IL FILE JS SU GITHUB
    // ==========================================
    const bodyData = {
      message: `Aggiornato array in ${jsFilePath} per ${titolo}`,
      content: Buffer.from(decodedContent).toString("base64")
    };
    
    // Passiamo lo SHA solo se il file esisteva già, altrimenti GitHub sa che deve crearlo
    if (sha) {
        bodyData.sha = sha;
    }

    const updateJsRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${jsFilePath}`,
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