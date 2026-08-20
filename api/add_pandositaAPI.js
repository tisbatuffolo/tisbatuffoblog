export default async function handler(req, res) {
    // ✅ Configurazione CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // ✅ Gestione della richiesta preflight (OPTIONS)
    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Metodo non consentito' });
    }

    const { sezione, imageB64, mimeType } = req.body;
    if (!sezione || !imageB64) {
        return res.status(400).json({ error: 'Dati mancanti' });
    }

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN; 
    const GITHUB_OWNER = "tisbatuffolo"; 
    const GITHUB_REPO = "tisbatuffoblog";   
    const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

    if (!GITHUB_TOKEN) {
        return res.status(500).json({ error: 'Configurazione GitHub (GITHUB_TOKEN) mancante in Vercel.' });
    }

    // Funzione per ricavare l'estensione corretta dal mimeType in modo dinamico
    const getExtFromMime = (mime, defaultExt = 'jpg') => {
        if (!mime) return defaultExt;
        if (mime.includes('png')) return 'png';
        if (mime.includes('webp')) return 'webp';
        if (mime.includes('gif')) return 'gif';
        if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
        return defaultExt;
    };

    // Configurazione dettagliata per ogni sezione con estensione dinamica basata sul file caricato
    const mapSezioni = {
        'sticker':      { path: 'pandosita/img/sticker',      prefix: 'sticker',      ext: getExtFromMime(mimeType, 'webp') },
        'gif':          { path: 'pandosita/img/gif',          prefix: 'pandagif',     ext: getExtFromMime(mimeType, 'gif') },
        'sbatuffolart': { path: 'pandosita/img/sbatuffolart', prefix: 'sbatuffolart', ext: getExtFromMime(mimeType, 'jpg') },
        'sbatuffolai':  { path: 'pandosita/img/sbatuffolAI',  prefix: 'sbatuffolai',  ext: getExtFromMime(mimeType, 'jpg') },
        'lulu':         { path: 'pandosita/img/lulu',         prefix: 'lulu',         ext: getExtFromMime(mimeType, 'jpg') },
        'sfigatini':    { path: 'pandosita/img/sfigatini',    prefix: 'sfigatini',    ext: 'jpg' }
    };

    const config = mapSezioni[sezione];
    if (!config) return res.status(400).json({ error: 'Sezione non valida' });

    try {
        // 1. Legge la cartella su GitHub per calcolare il numero progressivo massimo
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
            const regex = new RegExp(`^${config.prefix} \\((\\d+)\\)\\.`);
            
            for (const file of files) {
                const match = file.name.match(regex);
                if (match) {
                    const num = parseInt(match[1], 10);
                    if (num > maxIndex) maxIndex = num;
                }
            }
        } else if (responseList.status !== 404) {
            throw new Error('Impossibile scansionare i file esistenti.');
        }

        if (maxIndex >= 1000) {
            return res.status(400).json({ error: 'Raggiunto il limite massimo di 1000 elementi per questa sezione.' });
        }

        // 2. Prepara il nuovo file con estensione corretta
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
};