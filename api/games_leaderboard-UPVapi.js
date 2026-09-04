import { Redis } from '@upstash/redis';

let redis;

export default async function handler(req, res) {
  const { method } = req;
  const game = req.query.game || req.body?.game;

  const allowedGames = ['pandarun', 'pandatetris', 'pandapoops'];

  if (!game || !allowedGames.includes(game)) {
    return res.status(400).json({ success: false, error: 'Specificare un gioco valido' });
  }

  try {
    if (!redis) {
      redis = new Redis({
        url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
      });
    }
  } catch (error) {
    return res.status(500).json({ 
      success: false, 
      error: 'Variabili di ambiente Redis/KV mancanti su Vercel.' 
    });
  }

  const LEADERBOARD_KEY = `${game}:leaderboard`;

  if (method === 'GET') {
    try {
      const username = req.query.username;
      if (username) {
        const score = await redis.zscore(LEADERBOARD_KEY, username);
        return res.status(200).json({ success: true, bestScore: score !== null ? Number(score) : 0 });
      }

      const rawScores = await redis.zrange(LEADERBOARD_KEY, 0, 9, { rev: true, withScores: true });
      
      let formattedScores = [];
      if (rawScores) {
        if (Array.isArray(rawScores)) {
          if (rawScores.length > 0 && typeof rawScores[0] === 'object' && rawScores[0] !== null) {
            formattedScores = rawScores.map(item => ({ 
              username: String(item.member || item.username || ''), 
              score: Number(item.score || 0) 
            }));
          } else {
            for (let i = 0; i < rawScores.length; i += 2) {
              if (rawScores[i] !== undefined) {
                formattedScores.push({
                  username: String(rawScores[i]),
                  score: Number(rawScores[i + 1] || 0)
                });
              }
            }
          }
        }
      }

      return res.status(200).json({ success: true, scores: formattedScores });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  } 
  
  else if (method === 'POST') {
    try {
      const { username, score } = req.body;

      if (!username || typeof score !== 'number') {
        return res.status(400).json({ success: false, error: 'Dati non validi' });
      }

      const currentScore = await redis.zscore(LEADERBOARD_KEY, username);
      const currentBest = currentScore !== null ? Number(currentScore) : 0;

      let isNewBest = false;
      if (score > currentBest) {
        await redis.zadd(LEADERBOARD_KEY, { score, member: username });
        isNewBest = true;
      }

      return res.status(200).json({ success: true, bestScore: Math.max(score, currentBest), isNewBest });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  } 
  
  else {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, error: `Method ${method} Not Allowed` }); 
  }
}