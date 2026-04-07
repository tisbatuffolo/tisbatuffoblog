export default async function handler(req, res) {
  // ✅ CORS (fondamentale)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const events = req.body;

    const response = await fetch(
      "https://api.github.com/repos/tisbatuffolo/tisbatuffoblog/dispatches",
      {
        method: "POST",
        headers: {
          "Accept": "application/vnd.github+json",
          // ✅ CORRETTO per TOKEN CLASSIC
          "Authorization": `token ${process.env.GITHUB_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          event_type: "update_agenda",
          client_payload: { events }
        })
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return res.status(500).json({ error: text });
    }

    return res.status(200).json({ message: "OK" });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}