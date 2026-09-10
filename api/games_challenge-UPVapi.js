import { Redis } from '@upstash/redis';

let redis;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Metodo non consentito' });
  }

  try {
    if (!redis) {
      redis = new Redis({
        url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
      });
    }
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Redis non configurato' });
  }

  const { action, roomId, username, score } = req.body;

  try {
    if (action === 'create') {
      const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      const state = { 
        p1: username, p2: null, 
        p1_score: null, p2_score: null, 
        p1_rematch: false, p2_rematch: false, 
        status: 'waiting' 
      };
      await redis.set(`challenge:${newRoomId}`, state, { ex: 3600 });
      return res.status(200).json({ success: true, roomId: newRoomId, state });
    }

    if (!roomId) return res.status(400).json({ success: false, error: 'RoomId mancante' });
    
    let state = await redis.get(`challenge:${roomId}`);
    if (!state) return res.status(404).json({ success: false, error: 'Sfida scaduta o inesistente' });
    if (typeof state === 'string') state = JSON.parse(state);

    if (action === 'join') {
      if (state.status !== 'waiting' && state.p2 !== username && state.p1 !== username) {
        return res.status(400).json({ success: false, error: 'La stanza è già piena' });
      }
      if (!state.p2 && state.p1 !== username) {
        state.p2 = username;
        state.status = 'playing';
        await redis.set(`challenge:${roomId}`, state, { ex: 3600 });
      }
      return res.status(200).json({ success: true, state });
    }

    if (action === 'status') {
      return res.status(200).json({ success: true, state });
    }

    if (action === 'submit') {
      if (username === state.p1) state.p1_score = score;
      if (username === state.p2) state.p2_score = score;
      
      if (state.p1_score !== null && state.p2_score !== null) {
        state.status = 'finished';
      }
      await redis.set(`challenge:${roomId}`, state, { ex: 3600 });
      return res.status(200).json({ success: true, state });
    }

    if (action === 'rematch') {
      if (username === state.p1) state.p1_rematch = true;
      if (username === state.p2) state.p2_rematch = true;

      if (state.p1_rematch && state.p2_rematch) {
        state.p1_score = null;
        state.p2_score = null;
        state.p1_rematch = false;
        state.p2_rematch = false;
        state.status = 'playing';
      }
      await redis.set(`challenge:${roomId}`, state, { ex: 3600 });
      return res.status(200).json({ success: true, state });
    }

    if (action === 'quit') {
      state.status = 'closed';
      await redis.set(`challenge:${roomId}`, state, { ex: 3600 });
      return res.status(200).json({ success: true, state });
    }

    return res.status(400).json({ success: false, error: 'Azione non valida' });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}