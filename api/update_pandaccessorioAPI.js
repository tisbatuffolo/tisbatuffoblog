export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Metodo non consentito" });

  try {
    const { 
        action = "update",
        oldTitolo, oldImmagine, oldTargetDir, oldJsFilePath, oldArrayName, 
        newTitolo, newTargetDir, newJsFilePath, newArrayName, pandaforma 
    } = req.body;

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const REPO_OWNER = "tisbatuffolo";
    const REPO_NAME = "tisbatuffoblog";
    
    const headers = {
        Authorization: `token ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json"
    };

    const cOldDir = oldTargetDir.startsWith("pandaccessori/") ? oldTargetDir : `pandaccessori/${oldTargetDir}`;
    const cOldJs = oldJsFilePath.startsWith("pandaccessori/") ? oldJsFilePath : `pandaccessori/${oldJsFilePath}`;
    const oldImgFullPath = `${cOldDir}/${oldImmagine}`;

    // Funzione helper JS File Array Parsing
    async function processJsFile(filePath, arrayName, arrayAction) {
        const getRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`, { headers });
        let decoded = `const ${arrayName} = [];\n`; let sha = null;
        
        if (getRes.ok) {
            const data = await getRes.json();
            sha = data.sha;
            decoded = Buffer.from(data.content, 'base64').toString('utf8');
        }

        const arrayRegex = new RegExp(`(const\\s+${arrayName}\\s*=\\s*)(\\[[\\s\\S]*?\\])(\\s*;)`);
        const match = decoded.match(arrayRegex);
        if (!match) throw new Error(`Array ${arrayName} non trovato in ${filePath}`);

        let arr = new Function(`return ${match[2]}`)();
        
        // Applica l'azione (rimuovi il vecchio, aggiorna, o aggiungi il nuovo)
        arr = arrayAction(arr);

        const newStr = JSON.stringify(arr, null, 4);
        decoded = decoded.replace(arrayRegex, `$1${newStr}$3`);

        const bodyData = { message: `Aggiornato DB Pandaccessori via API`, content: Buffer.from(decoded).toString("base64") };
        if (sha) bodyData.sha = sha;

        const putRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`, { method: "PUT", headers, body: JSON.stringify(bodyData) });
        if (!putRes.ok) throw new Error(`Errore aggiornamento file JS: ${filePath}`);
    }

    // ==========================================
    // LOGICA DI ELIMINAZIONE (DELETE)
    // ==========================================
    if (action === "delete") {
        
        // 1. Cerca ed elimina l'immagine da GitHub
        const oldImgRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${oldImgFullPath}`, { headers });
        if (oldImgRes.ok) {
            const oldImgData = await oldImgRes.json();
            await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${oldImgFullPath}`, {
                method: "DELETE", headers,
                body: JSON.stringify({ message: `Rimossa immagine (eliminazione): ${oldImmagine}`, sha: oldImgData.sha })
            });
        }

        // 2. Rimuovi l'oggetto dall'array JS
        await processJsFile(cOldJs, oldArrayName, (arr) => {
            return arr.filter(i => i.immagine !== oldImmagine);
        });

        return res.status(200).json({ message: "Pandaccessorio eliminato con successo!" });
    }

    // ==========================================
    // LOGICA DI MODIFICA (UPDATE)
    // ==========================================
    if (action === "update") {
        const cNewDir = newTargetDir.startsWith("pandaccessori/") ? newTargetDir : `pandaccessori/${newTargetDir}`;
        const cNewJs = newJsFilePath.startsWith("pandaccessori/") ? newJsFilePath : `pandaccessori/${newJsFilePath}`;
        const newFileNameClean = newTitolo.replace(/[^a-zA-Z0-9 \-_]/g, '').trim() + '.jpg';
        const newImgFullPath = `${cNewDir}/${newFileNameClean}`;

        // STEP 1: GESTIONE IMMAGINE (Sposta/Rinomina)
        if (oldImgFullPath !== newImgFullPath) {
            // Scarica la vecchia img
            const oldImgRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${oldImgFullPath}`, { headers });
            if (!oldImgRes.ok) throw new Error("Impossibile trovare l'immagine originale per lo spostamento.");
            const oldImgData = await oldImgRes.json();
            
            // Carica la nuova img
            const putImgRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${newImgFullPath}`, {
                method: "PUT", headers,
                body: JSON.stringify({ message: `Spostato/Rinominato Pandaccessorio in: ${newTitolo}`, content: oldImgData.content })
            });
            if (!putImgRes.ok) throw new Error("Errore durante il caricamento della nuova immagine.");

            // Elimina la vecchia img
            await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${oldImgFullPath}`, {
                method: "DELETE", headers,
                body: JSON.stringify({ message: `Rimossa immagine vecchia per: ${oldTitolo}`, sha: oldImgData.sha })
            });
        }

        // STEP 2: AGGIORNAMENTO FILE DATA JS
        if (cOldJs === cNewJs) {
            // Stessa cartella (Solo rinominato)
            await processJsFile(cOldJs, oldArrayName, (arr) => {
                const idx = arr.findIndex(i => i.immagine === oldImmagine);
                if (idx !== -1) {
                    arr[idx].titolo = newTitolo;
                    arr[idx].immagine = newFileNameClean;
                    arr[idx].pandaforma = pandaforma !== undefined ? pandaforma : false;
                }
                return arr;
            });
        } else {
            // Cartella diversa (Spostato)
            // 1. Rimuovi dal vecchio array
            await processJsFile(cOldJs, oldArrayName, (arr) => {
                return arr.filter(i => i.immagine !== oldImmagine);
            });
            
            // 2. Aggiungi al nuovo array
            await processJsFile(cNewJs, newArrayName, (arr) => {
                arr.push({ 
                    titolo: newTitolo, 
                    immagine: newFileNameClean, 
                    pandaforma: pandaforma !== undefined ? pandaforma : false 
                });
                return arr;
            });
        }

        return res.status(200).json({ message: "Pandaccessorio aggiornato con successo!" });
    }

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}