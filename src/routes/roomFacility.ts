import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { simpleAuth } from '../middleware/simpleAuth.js';
import { uploadThumbnail } from '../middleware/uploadThumbnail.js';
import { RoomFacilityService } from '../services/roomFacilityService.js';

function ensureAdmin(req: any, reply: any) {
  const user = req.user;
  if (!user || user.username !== 'admin') {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export default fp(async function roomFacilityRoutes(fastify: FastifyInstance) {
  const DEBUG = process.env.ROOM_DEBUG === '1';

  // Create
  fastify.post('/api/rooms', { preHandler: [simpleAuth, uploadThumbnail] }, async (req: any, reply: any) => {
    if (!ensureAdmin(req, reply)) return;
    const fields = (req as any).eventFields || req.body || {}; // reuse container from middleware
    const photoPath = (req as any).thumbnailPath || null; // thumbnailPath reused as generic photo
    const { name, description } = fields;
    if (!name) return reply.code(400).send({ error: 'name wajib diisi' });
    try {
      const created = await RoomFacilityService.create({
        name: String(name),
        description: description ? String(description) : null,
        photo_path: photoPath
      });
      if (DEBUG) req.server.log.info({ photoPath }, '[room] created');
      reply.code(201).send({ data: created });
    } catch (e:any) {
      if (DEBUG) req.server.log.error({ err: e }, '[room] create failed');
      reply.code(500).send({ error: 'Gagal membuat ruangan/fasilitas' });
    }
  });

  // List
  fastify.get('/api/rooms', async (_req, reply) => {
    const list = await RoomFacilityService.list();
    reply.send({ data: list });
  });

  // Detail
  fastify.get('/api/rooms/:id', async (req: any, reply) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'ID tidak valid' });
    const row = await RoomFacilityService.get(id);
    if (!row) return reply.code(404).send({ error: 'Tidak ditemukan' });
    reply.send({ data: row });
  });

  // Update (optional photo upload again)
  fastify.put('/api/rooms/:id', { preHandler: [simpleAuth, uploadThumbnail] }, async (req: any, reply: any) => {
    if (!ensureAdmin(req, reply)) return;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'ID tidak valid' });
    const fields = (req as any).eventFields || req.body || {};
    const photoPath = (req as any).thumbnailPath; // if not provided won't override unless explicitly present
    const patch: any = {};
    if (fields.name !== undefined) patch.name = String(fields.name);
    if (fields.description !== undefined) patch.description = String(fields.description);
    if (photoPath !== undefined) patch.photo_path = photoPath; // may be null or string
    try {
      const updated = await RoomFacilityService.update(id, patch);
      if (!updated) return reply.code(404).send({ error: 'Tidak ditemukan' });
      reply.send({ data: updated });
    } catch (e:any) {
      if (DEBUG) req.server.log.error({ err: e }, '[room] update failed');
      reply.code(500).send({ error: 'Gagal update ruangan/fasilitas' });
    }
  });

  // Delete
  fastify.delete('/api/rooms/:id', { preHandler: [simpleAuth] }, async (req: any, reply: any) => {
    if (!ensureAdmin(req, reply)) return;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'ID tidak valid' });
    const ok = await RoomFacilityService.remove(id);
    if (!ok) return reply.code(404).send({ error: 'Tidak ditemukan' });
    reply.send({ success: true });
  });
});
