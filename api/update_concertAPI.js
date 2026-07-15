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
    const concerts = req.body; // Riceve l'array completo dei concerti
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const REPO_OWNER = "tisbatuffolo"; 
    const REPO_NAME = "tisbatuffoblog";
    const FILE_PATH = "pandamusic/concert.json"; // Punta al nuovo file JSON dei concerti

    // 1. Recupero dello SHA del file esistente
    const getFile = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`,
      {
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    let sha = null;
    if (getFile.ok) {
      const fileData = await getFile.json();
      sha = fileData.sha;
    } else if (getFile.status !== 404) {
      // Se l'errore non è un semplice 404 (file non trovato), lanciamo eccezione
      throw new Error("Impossibile recuperare lo SHA di concert.json");
    }

    // 2. Aggiornamento del file su GitHub tramite API
    const updatePayload = {
      message: "Update concert.json via PandaMusic UI",
      content: Buffer.from(JSON.stringify(concerts, null, 2)).toString("base64"),
    };
    if (sha) updatePayload.sha = sha;

    const updateFile = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`,
      {
        method: "PUT",
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify(updatePayload),
      }
    );

    if (!updateFile.ok) {
      const errorMsg = await updateFile.text();
      throw new Error(`Errore durante l'aggiornamento su GitHub: ${errorMsg}`);
    }

    return res.status(200).json({ message: "Concerti aggiornati con successo!" });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.message });
  }
}