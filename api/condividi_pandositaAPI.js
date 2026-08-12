module.exports = async (req, res) => {
  // CORS Headers per Vercel
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { imageUrl, platform, title } = req.query || req.body || {};

    if (!imageUrl) {
      return res.status(400).json({ success: false, error: 'Parametro imageUrl mancante.' });
    }

    const shareTitle = title || 'Pandosità';
    const textMsg = `Guarda questo contenuto da SbatuffoBlog - ${shareTitle}: ${imageUrl}`;
    const encodedText = encodeURIComponent(textMsg);
    const encodedUrl = encodeURIComponent(imageUrl);

    let redirectUrl = '';

    switch (platform) {
      case 'whatsapp':
        redirectUrl = `https://api.whatsapp.com/send?text=${encodedText}`;
        break;
      case 'telegram':
        redirectUrl = `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent('SbatuffoBlog - ' + shareTitle)}`;
        break;
      case 'email':
      case 'mail':
        redirectUrl = `mailto:?subject=${encodeURIComponent('SbatuffoBlog - ' + shareTitle)}&body=${encodedText}`;
        break;
      default:
        redirectUrl = imageUrl;
    }

    return res.status(200).json({
      success: true,
      imageUrl,
      platform: platform || 'link',
      title: shareTitle,
      shareUrl: redirectUrl
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};