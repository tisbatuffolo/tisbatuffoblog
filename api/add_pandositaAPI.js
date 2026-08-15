export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Metodo non consentito' });
    }

    const { sezione, imageB64, mimeType } = req.body;
    if (!sezione || !imageB64) {
        return res.status(400).json({ error: 'Dati mancanti' });
    }

    // Parametri GitHub da impostare come Variabili d'Ambiente su Vercel
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN; 
    const GITHUB_OWNER = process.env.GITHUB_OWNER; // Es: "Tuonomeutente"
    const GITHUB_REPO = process.env.GITHUB_REPO;   // Es: "tisbatuffolo"
    const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main'; // O 'master'

    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
        return res.status(500).json({ error: 'Configurazione GitHub (Variabili d\'ambiente) mancante in Vercel.' });
    }

    // Configurazione dettagliata per ogni sezione (Gestione cartelle, nomi ed estensioni)
    const mapSezioni = {
        'sticker':      { path: 'pandosita/img/sticker',      prefix: 'sticker',      ext: 'webp' },
        'gif':          { path: 'pandosita/img/gif',          prefix: 'pandagif',     ext: mimeType === 'image/gif' ? 'gif' : 'jpg' },
        'sbatuffolart': { path: 'pandosita/img/sbatuffolart', prefix: 'sbatuffolart', ext: 'jpg' },
        'sbatuffolai':  { path: 'pandosita/img/sbatuffolAI',  prefix: 'sbatuffolai',  ext: 'jpg' },
        'lulu':         { path: 'pandosita/img/lulu',         prefix: 'lulu',         ext: 'jpg' },
        'sfigatini':    { path: 'pandosita/img/sfigatini',    prefix: 'sfigatini',    ext: 'jpg' }
    };

    const config = mapSezioni[sezione];
    if (!config) return res.status(400).json({ error: 'Sezione non valida' });

    try {
        // 1. Legge la cartella su GitHub per capire quale sia il numero massimo
        const repoPathUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${config.path}?ref=${GITHUB_BRANCH}`;
        const responseList = await fetch(repoPathUrl, {
            headers: { 
                'Authorization': `Bearer ${GITHUB_TOKEN}`, 
                'Accept': 'application/vnd.github.v3+json' 
            }
        });

        let maxIndex = 0;
        
        if (responseList.ok) {
            const files = await responseList.json();
            
            // Regex per trovare il numero nel nome (es: "sbatuffolart (120).jpg")
            const regex = new RegExp(`^${config.prefix} \\((\\d+)\\)\\.`);
            
            for (const file of files) {
                const match = file.name.match(regex);
                if (match) {
                    const num = parseInt(match[1], 10);
                    if (num > maxIndex) maxIndex = num;
                }
            }
        } else if (responseList.status !== 404) {
            // Se c'è un errore e non è "Cartella non trovata", fallisce
            throw new Error('Impossibile scansionare i file esistenti.');
        }

        // Limite di 1000 elementi
        if (maxIndex >= 1000) {
            return res.status(400).json({ error: 'Raggiunto il limite massimo di 1000 elementi per questa sezione.' });
        }

        // 2. Prepara il nuovo file
        const nextIndex = maxIndex + 1;
        const newFileName = `${config.prefix} (${nextIndex}).${config.ext}`;
        const newFilePath = `${config.path}/${newFileName}`;

        // 3. Salva l'immagine tramite commit su GitHub
        const uploadUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${newFilePath}`;
        const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: `Upload automatico: aggiunta pandosita ${newFileName}`,
                content: imageB64,
                branch: GITHUB_BRANCH
            })
        });

        if (!uploadRes.ok) {
            const errJson = await uploadRes.json();
            throw new Error(errJson.message || 'Errore durante l\'upload su GitHub');
        }

        res.status(200).json({ success: true, fileName: newFileName });
        
    } catch (error) {
        console.error("Errore API upload:", error);
        res.status(500).json({ error: error.message });
    }
}