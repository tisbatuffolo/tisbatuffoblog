// Configurazione per aumentare la dimensione massima del body accettato (previene l'errore 405/413 con stringhe Base64 grandi)
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '10mb',
        },
    },
};

export default async function handler(req, res) {
    // Configurazione CORS completa
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Metodo non consentito' });
    }

    const { sezione, imageB64, mimeType } = req.body || {};
    if (!sezione || !imageB64) {
        return res.status(400).json({ error: 'Dati mancanti' });
    }

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN; 
    const GITHUB_OWNER = "tisbatuffolo"; 
    const GITHUB_REPO = "tisbatuffoblog";   
    const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

    if (!GITHUB_TOKEN) {
        return res.status(500).json({ error: 'Configurazione GitHub mancante.' });
    }

    // Ricava l'estensione corretta
    const getExtFromMime = (mime, defaultExt = 'jpg') => {
        if (!mime) return defaultExt;
        if (mime.includes('png')) return 'png';
        if (mime.includes('webp')) return 'webp';
        if (mime.includes('gif')) return 'gif';
        if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
        return defaultExt;
    };

    const mapSezioni = {
        'sticker':      { path: 'pandosita/img/sticker',      prefix: 'sticker',      ext: getExtFromMime(mimeType, 'webp') },
        'gif':          { path: 'pandosita/img/gif',          prefix: 'pandagif',     ext: getExtFromMime(mimeType, 'gif') },
        'sbatuffolart': { path: 'pandosita/img/sbatuffolart', prefix: 'sbatuffolart', ext: getExtFromMime(mimeType, 'jpg') },
        'sbatuffolai':  { path: 'pandosita/img/sbatuffolAI',  prefix: 'sbatuffolai',  ext: getExtFromMime(mimeType, 'jpg') },
        'lulu':         { path: 'pandosita/img/lulu',         prefix: 'lulu',         ext: getExtFromMime(mimeType, 'jpg') },
        'sfigatini':    { path: 'pandosita/img/sfigatini',    prefix: 'sfigatini',    ext: 'jpg' }
    };

    const configSection = mapSezioni[sezione];
    if (!configSection) return res.status(400).json({ error: 'Sezione non valida' });

    try {
        const repoPathUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${configSection.path}?ref=${GITHUB_BRANCH}&t=${Date.now()}`;
        const responseList = await fetch(repoPathUrl, {
            headers: { 
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'SbatuffoBlog-App'
            }
        });

        let maxIndex = 0;
        
        if (responseList.ok) {
            const files = await responseList.json();
            const regex = new RegExp(`^${configSection.prefix} \\((\\d+)\\)\\.`);
            
            if (Array.isArray(files)) {
                for (const file of files) {
                    const match = file.name.match(regex);
                    if (match) {
                        const num = parseInt(match[1], 10);
                        if (num > maxIndex) maxIndex = num;
                    }
                }
            }
        } else if (responseList.status !== 404) {
            throw new Error('Impossibile scansionare i file esistenti.');
        }

        if (maxIndex >= 1000) {
            return res.status(400).json({ error: 'Raggiunto il limite di 1000 file.' });
        }

        // Calcola nuovo file
        const nextIndex = maxIndex + 1;
        const newFileName = `${configSection.prefix} (${nextIndex}).${configSection.ext}`;
        const newFilePath = `${configSection.path}/${newFileName}`;

        // Salva Immagine
        const uploadUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${newFilePath}`;
        const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'User-Agent': 'SbatuffoBlog-App'
            },
            body: JSON.stringify({
                message: `Aggiunta Pandosità: ${newFileName}`,
                content: imageB64,
                branch: GITHUB_BRANCH
            })
        });

        if (!uploadRes.ok) {
            const errJson = await uploadRes.json();
            throw new Error(errJson.message || 'Errore upload GitHub');
        }

        return res.status(200).json({ success: true, fileName: newFileName });
        
    } catch (error) {
        console.error("Errore API upload:", error);
        return res.status(500).json({ error: error.message });
    }
}