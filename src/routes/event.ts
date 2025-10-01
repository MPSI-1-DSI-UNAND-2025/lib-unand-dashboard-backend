import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { EventService } from '../services/eventService.js';
import { simpleAuth } from '../middleware/simpleAuth.js';
import { uploadThumbnail } from '../middleware/uploadThumbnail.js';

// Simple admin check: username === 'admin'
function ensureAdmin(req: any, reply: any) {
  const user = req.user;
  if (!user || user.username !== 'admin') {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export default fp(async function eventRoutes(fastify: FastifyInstance) {
  const DEBUG = process.env.EVENT_DEBUG === '1';

  fastify.post('/api/events', { preHandler: [simpleAuth, uploadThumbnail] }, async (req: any, reply: any) => {
    if (!ensureAdmin(req, reply)) return;
    const fields = (req as any).eventFields || req.body || {};
    const thumbnailPath = (req as any).thumbnailPath || null;
    const { title, location, date, time } = fields;
    if (!title || !location || !date || !time) {
      return reply.code(400).send({ error: 'title, location, date, time wajib diisi' });
    }
    try {
      const created = await EventService.create({
        title: String(title),
        location: String(location),
        date: String(date),
        time: String(time),
        thumbnail_path: thumbnailPath
      });
      if (DEBUG) req.server.log.info({ thumb: thumbnailPath }, '[event] created event');
      reply.code(201).send({ data: enrichCountdown(created) });
    } catch (e:any) {
      if (DEBUG) req.server.log.error({ err: e }, '[event] create failed');
      reply.code(500).send({ error: 'Gagal membuat event' });
    }
  });
  // list events
  fastify.get('/api/events', async (_req, reply) => {
    const list = await EventService.list(false);
    reply.send({ data: list.map(enrichCountdown) });
  });

  // detail
  fastify.get('/api/events/:id', async (req: any, reply) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'ID tidak valid' });
    const event = await EventService.get(id);
    if (!event) return reply.code(404).send({ error: 'Event tidak ditemukan' });
    reply.send({ data: enrichCountdown(event) });
  });

  // update event (parsial) + ganti thumbnail jika ada
  fastify.put('/api/events/:id', { preHandler: [simpleAuth, uploadThumbnail] }, async (req: any, reply: any) => {
    if (!ensureAdmin(req, reply)) return;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'ID tidak valid' });
    const fields = (req as any).eventFields || req.body || {};
    const thumb = (req as any).thumbnailPath; // undefined jika tidak diupload; null kalau base64 gagal
    const patch: any = {};
    if (fields.title !== undefined) patch.title = String(fields.title);
    if (fields.location !== undefined) patch.location = String(fields.location);
    if (fields.date !== undefined) patch.date = String(fields.date);
    if (fields.time !== undefined) patch.time = String(fields.time);
    if (thumb !== undefined) patch.thumbnail_path = thumb; // boleh null / string
    try {
      const updated = await EventService.update(id, patch);
      if (!updated) return reply.code(404).send({ error: 'Event tidak ditemukan' });
      reply.send({ data: enrichCountdown(updated) });
    } catch (e:any) {
      if (DEBUG) req.server.log.error({ err: e }, '[event] update failed');
      reply.code(400).send({ error: e.message || 'Gagal update event' });
    }
  });
});

function enrichCountdown(event: any) {
  const starts = new Date(event.starts_at);
  const now = new Date();
  const diffMs = starts.getTime() - now.getTime();
  let countdown = null;
  if (diffMs > 0) {
    const totalSeconds = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    countdown = { days, hours, minutes, seconds };
  }
  return { ...event, countdown };
}
