export default async function handler(req, res) {
  // ✅ CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const OWNER = "tisbatuffolo";
  const REPO = "tisbatuffoblog";
  const FILE_PATH = "doccelunghe/docce.json";

  if (!GITHUB_TOKEN) {
    return res.status(500).json({ error: "GITHUB_TOKEN non impostato" });
  }

  try {
    // 1️⃣ Recupero del file docce.json da GitHub
    const getFileRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json"
        }
      }
    );

    if (!getFileRes.ok) {
      throw new Error("Impossibile leggere docce.json da GitHub");
    }

    const fileData = await getFileRes.json();
    const decodedContent = Buffer.from(
      fileData.content,
      "base64"
    ).toString("utf8");

    let docceData;
    try {
      docceData = JSON.parse(decodedContent);
    } catch {
      docceData = {};
    }

    // 2️⃣ Logica di incremento (ex aggiorna-docce.py)
    const today = new Date();
    const year = String(today.getFullYear());
    const month = String(today.getMonth() + 1);

    if (!docceData[year]) {
      docceData[year] = {};
      for (let m = 1; m <= 12; m++) {
        docceData[year][String(m)] = 0;
      }
    }

    docceData[year][month] = (docceData[year][month] || 0) + 1;

    // 3️⃣ Commit aggiornato su GitHub
    const updatedContentBase64 = Buffer.from(
      JSON.stringify(docceData, null, 2)
    ).toString("base64");

    const updateRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: "🚿 Incremento doccia",
          content: updatedContentBase64,
          sha: fileData.sha
        })
      }
    );

    if (!updateRes.ok) {
      throw new Error("Errore durante il commit su GitHub");
    }

    // ✅ Successo
    return res.status(200).json({
      success: true,
      year,
      month,
      valore: docceData[year][month]
    });

  } catch (err) {
    console.error("Errore update_docceAPI:", err);
    return res.status(500).json({ error: err.message });
  }
}