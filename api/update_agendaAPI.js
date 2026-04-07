export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const events = req.body;

    const response = await fetch(
      'https://api.github.com/repos/tisbatuffolo/tisbatuffoblog/dispatches',
      {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `token ${process.env.GITHUB_TOKEN}`
        },
        body: JSON.stringify({
          event_type: 'update_agenda',
          client_payload: { events }
        })
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return res.status(500).json({ error: text });
    }

    return res.status(200).json({ message: 'OK' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
