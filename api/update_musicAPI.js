export default async function handler(req, res) {
  // Configurazione CORS per permettere chiamate dal tuo sito GitHub Pages
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
    const playlists = req.body; // Riceve l'array completo delle playlist
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const REPO_OWNER = "tisbatuffolo"; 
    const REPO_NAME = "tisbatuffoblog";
    const FILE_PATH = "pandamusic/playlist.json"; // Percorso del file JSON nel tuo repo

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

    if (!getFile.ok) {
      throw new Error("Impossibile recuperare lo SHA di playlist.json");
    }

    const fileData = await getFile.json();
    const sha = fileData.sha;

    // 2. Aggiornamento del file su GitHub tramite API
    const updateFile = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`,
      {
        method: "PUT",
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({
          message: "Update playlist.json via PandaMusic UI",
          content: Buffer.from(JSON.stringify(playlists, null, 2)).toString("base64"),
          sha: sha, 
        }),
      }
    );

    if (!updateFile.ok) {
      const errorMsg = await updateFile.text();
      throw new Error(`Errore durante l'aggiornamento su GitHub: ${errorMsg}`);
    }

    return res.status(200).json({ message: "Playlist aggiornate con successo!" });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.message });
  }
}