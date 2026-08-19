export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Metodo non consentito" });

  try {
    const { 
      action = "update", // "add", "update", "delete"
      titolo, imageB64,
      oldTitolo, oldImmagine, 
      newTitolo, 
      targetDir, jsFilePath, arrayName 
    } = req.body;

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const REPO_OWNER = "tisbatuffolo";
    const REPO_NAME = "tisbatuffoblog";
    
    const headers = {
      Authorization: `token ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json"
    };

    const cDir = targetDir.startsWith("pandaccessori/") ? targetDir : `pandaccessori/${targetDir}`;
    const cJs = jsFilePath.startsWith("pandaccessori/") ? jsFilePath : `pandaccessori/${jsFilePath}`;

    // Helper per leggere, modificare e salvare il file JS dell'array extra
    async function processJsFile(filePath, arrName, arrayAction) {
      const getRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`, { headers });
      let decoded = `const ${arrName} = [];\n`; 
      let sha = null;
      
      if (getRes.ok) {
        const data = await getRes.json();
        sha = data.sha;
        decoded = Buffer.from(data.content, 'base64').toString('utf8');
      }

      const arrayRegex = new RegExp(`(const\\s+${arrName}\\s*=\\s*)(\\[[\\s\\S]*?\\])(\\s*;)`);
      const match = decoded.match(arrayRegex);
      if (!match) throw new Error(`Array ${arrName} non trovato in ${filePath}`);

      let arr = new Function(`return ${match[2]}`)();
      arr = arrayAction(arr);

      const newStr = JSON.stringify(arr, null, 4);
      decoded = decoded.replace(arrayRegex, `$1${newStr}$3`);

      const bodyData = { 
        message: `Aggiornato DB Extra Accessori via API (${action})`, 
        content: Buffer.from(decoded).toString("base64") 
      };
      if (sha) bodyData.sha = sha;

      const putRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`, { 
        method: "PUT", 
        headers, 
        body: JSON.stringify(bodyData) 
      });
      if (!putRes.ok) throw new Error(`Errore aggiornamento file JS: ${filePath}`);
    }

    // ==========================================
    // AZIONE 1: AGGIUNGI NUOVO OGGETTO EXTRA
    // ==========================================
    if (action === "add") {
      if (!titolo || !imageB64) throw new Error("Titolo e immagine sono obbligatori.");
      
      const cleanFileName = titolo.replace(/[^a-zA-Z0-9 \-_]/g, '').trim() + '.jpg';
      const imageFullPath = `${cDir}/${cleanFileName}`;

      // 1. Carica la nuova immagine
      const uploadImgRes = await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${imageFullPath}`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({
            message: `Aggiunta nuova immagine Extra: ${titolo}`,
            content: imageB64
          })
        }
      );

      if (!uploadImgRes.ok) {
        const errorText = await uploadImgRes.text();
        throw new Error(`Errore caricamento immagine extra: ${errorText}`);
      }

      // 2. Inserisci nell'array JS
      await processJsFile(cJs, arrayName, (arr) => {
        arr.push({ "titolo": titolo, "immagine": cleanFileName });
        return arr;
      });

      return res.status(200).json({ message: "Nuovo oggetto extra aggiunto!", filename: cleanFileName });
    }

    // ==========================================
    // AZIONE 2: MODIFICA OGGETTO EXTRA ESISTENTE
    // ==========================================
    if (action === "update") {
      const oldImgFullPath = `${cDir}/${oldImmagine}`;
      const newFileNameClean = newTitolo.replace(/[^a-zA-Z0-9 \-_]/g, '').trim() + '.jpg';
      const newImgFullPath = `${cDir}/${newFileNameClean}`;

      if (oldImgFullPath !== newImgFullPath) {
        const oldImgRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${oldImgFullPath}`, { headers });
        if (!oldImgRes.ok) throw new Error("Impossibile trovare l'immagine extra originale.");
        const oldImgData = await oldImgRes.json();
        
        // Crea nuova immagine con nome aggiornato
        const putImgRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${newImgFullPath}`, {
          method: "PUT", headers,
          body: JSON.stringify({ message: `Rinominata immagine Extra: ${newTitolo}`, content: oldImgData.content })
        });
        if (!putImgRes.ok) throw new Error("Errore durante la rinomina dell'immagine extra.");

        // Elimina vecchia immagine
        await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${oldImgFullPath}`, {
          method: "DELETE", headers,
          body: JSON.stringify({ message: `Rimossa vecchia immagine Extra: ${oldTitolo}`, sha: oldImgData.sha })
        });
      }

      // Aggiorna l'array JS
      await processJsFile(cJs, arrayName, (arr) => {
        const idx = arr.findIndex(i => i.immagine === oldImmagine);
        if (idx !== -1) {
          arr[idx].titolo = newTitolo;
          arr[idx].immagine = newFileNameClean;
        }
        return arr;
      });

      return res.status(200).json({ message: "Oggetto extra aggiornato con successo!", filename: newFileNameClean });
    }

    // ==========================================
    // AZIONE 3: ELIMINA OGGETTO EXTRA
    // ==========================================
    if (action === "delete") {
      const oldImgFullPath = `${cDir}/${oldImmagine}`;

      // Elimina immagine da GitHub
      const oldImgRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${oldImgFullPath}`, { headers });
      if (oldImgRes.ok) {
        const oldImgData = await oldImgRes.json();
        await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${oldImgFullPath}`, {
          method: "DELETE", headers,
          body: JSON.stringify({ message: `Rimossa immagine Extra: ${oldImmagine}`, sha: oldImgData.sha })
        });
      }

      // Rimuovi dall'array JS
      await processJsFile(cJs, arrayName, (arr) => {
        return arr.filter(i => i.immagine !== oldImmagine);
      });

      return res.status(200).json({ message: "Oggetto extra eliminato con successo!" });
    }

    return res.status(400).json({ message: "Azione non valida" });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}