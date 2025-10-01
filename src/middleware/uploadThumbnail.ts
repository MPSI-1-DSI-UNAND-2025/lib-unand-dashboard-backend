import type { FastifyRequest, FastifyReply } from 'fastify';
import path from 'path';
import fs from 'fs';

// Middleware to extract thumbnail (multipart file or base64 field) and basic text fields
export async function uploadThumbnail(req: FastifyRequest, reply: FastifyReply) {
  const DEBUG = process.env.EVENT_DEBUG === '1';
  if (DEBUG) console.log('[uploadThumbnail] START - isMultipart:', req.isMultipart());
  (req as any).eventFields = (req as any).eventFields || {};
  let thumbnailPath: string | null = null;

  if (!req.isMultipart()) {
    // allow non multipart; maybe base64 sent in JSON
    const body: any = (req as any).body || {};
    if (body.thumbnail || body.thumbnail_base64) {
      thumbnailPath = await saveBase64(body.thumbnail || body.thumbnail_base64, DEBUG);
    }
    (req as any).thumbnailPath = thumbnailPath;
    return;
  }

  // Iterate parts manually to capture fields + single file
  try {
    const parts = (req as any).parts();
    if (DEBUG) console.log('[uploadThumbnail] Got parts iterator');
    let fileProcessed = false;
    let partCount = 0;
    for await (const part of parts) {
      partCount++;
      if (DEBUG) console.log(`[uploadThumbnail] Part ${partCount}:`, { 
        fieldname: part.fieldname, 
        type: part.type, 
        filename: part.filename,
        mimetype: part.mimetype 
      });
      if (part.type === 'file') {
        // Ambil file pertama apapun nama fieldnya
        if (fileProcessed) {
          if (DEBUG) console.log('[uploadThumbnail] Sudah ada file -> drain sisa file');
          try { await drainStream(part.file); } catch (e) { if (DEBUG) console.warn('[uploadThumbnail] drain error (extra)', e); }
          continue;
        }
        if (DEBUG) console.log('[uploadThumbnail] Menerima file pertama');
        const uploadDir = path.join(process.cwd(), 'uploads', 'events');
        if (DEBUG) console.log('[uploadThumbnail] Ensuring directory:', uploadDir);
        await fs.promises.mkdir(uploadDir, { recursive: true });
        const ext = extractExt(part.filename) || guessExt(part.mimetype) || '.bin';
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
        const fullPath = path.join(uploadDir, fileName);
        if (DEBUG) console.log('[uploadThumbnail] Will save to:', fullPath);
        let bytes = 0;
        let aborted = false;
        const MAX_SIZE = 5 * 1024 * 1024; // 5MB safeguard
        await new Promise<void>((res, rej) => {
          part.file.on('data', (c: Buffer) => {
            bytes += c.length;
            if (bytes > MAX_SIZE && !aborted) {
              aborted = true;
              if (DEBUG) console.warn('[uploadThumbnail] File too large, aborting at bytes:', bytes);
              part.file.destroy(new Error('FILE_TOO_LARGE'));
            }
          });
          part.file.on('error', (err: any) => rej(err));
          const ws = fs.createWriteStream(fullPath);
            ws.on('error', rej);
            ws.on('finish', res);
          part.file.pipe(ws);
        }).catch(async (e) => {
          // cleanup on error
          try { await fs.promises.unlink(fullPath); } catch {}
          throw e;
        });
        if (DEBUG) console.log('[uploadThumbnail] File write complete, bytes:', bytes);
        if (aborted) return reply.code(413).send({ error: 'File terlalu besar (maks 5MB)' });
        if (bytes === 0) {
          try { await fs.promises.unlink(fullPath); } catch {}
          if (DEBUG) console.log('[uploadThumbnail] File was empty, deleted');
          return reply.code(400).send({ error: 'File kosong / tidak dikirim dengan benar' });
        }
        thumbnailPath = `/uploads/events/${fileName}`;
        fileProcessed = true;
        if (DEBUG) console.log('[uploadThumbnail] SUCCESS - saved file:', { fullPath, bytes, thumbnailPath });
      } else {
        (req as any).eventFields[part.fieldname] = part.value;
        if (DEBUG) console.log('[uploadThumbnail] Text field:', part.fieldname, '=', part.value);
      }
    }
    if (DEBUG) console.log(`[uploadThumbnail] Processed ${partCount} parts total`);
  } catch (err: any) {
    if (DEBUG) console.error('[uploadThumbnail] ERROR parsing parts:', err);
    return reply.code(400).send({ error: 'Gagal memproses upload' });
  }

  // Base64 fallback if no file captured
  if (!thumbnailPath) {
    const base64Str = (req as any).eventFields['thumbnail'] || (req as any).eventFields['thumbnail_base64'];
    if (base64Str) {
      try {
        thumbnailPath = await saveBase64(base64Str, DEBUG);
      } catch (e:any) {
        if (DEBUG) req.server.log.warn({ err: e }, '[uploadThumbnail] base64 fallback failed');
      }
    }
  }

  if (DEBUG) console.log('[uploadThumbnail] FINAL RESULT:', { thumbnailPath, eventFields: (req as any).eventFields });
  (req as any).thumbnailPath = thumbnailPath;
}

async function saveBase64(input: string, DEBUG: boolean): Promise<string | null> {
  const m = /^data:(image\/(png|jpe?g));base64,(.+)$/i.exec(input.trim());
  let mime = 'image/png';
  let raw = input.trim();
  if (m) { mime = m[1] || mime; raw = m[3] || raw; }
  if (raw.length < 100) return null;
  const buf = Buffer.from(raw, 'base64');
  if (!buf.length) return null;
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? '.jpg' : '.png';
  const uploadDir = path.join(process.cwd(), 'uploads', 'events');
  await fs.promises.mkdir(uploadDir, { recursive: true });
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const fullPath = path.join(uploadDir, fileName);
  await fs.promises.writeFile(fullPath, buf);
  if (DEBUG) console.log('[uploadThumbnail] saved base64', fullPath, buf.length);
  return `/uploads/events/${fileName}`;
}

function extractExt(filename?: string): string | null {
  if (!filename) return null;
  const idx = filename.lastIndexOf('.');
  if (idx === -1) return null;
  return filename.slice(idx);
}

function guessExt(mime?: string): string | null {
  if (!mime) return null;
  if (mime.includes('png')) return '.png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  return null;
}

// Drain/consume an unwanted file stream so the multipart parser can continue.
async function drainStream(stream: NodeJS.ReadableStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.on('data', () => {});
    stream.on('end', resolve);
    stream.on('close', resolve);
    stream.on('error', reject);
  });
}

export default uploadThumbnail;