// Photo storage. The browser shrinks photos before upload and sends them as base64 data URLs.
// The server checks the file type by its magic bytes, removes hidden metadata from JPEGs
// (camera GPS position, device, owner: spec 12.1), reads the size, and stores the image in MongoDB
// (`files` collection) under a random name. Photos live in the database, not on disk, because
// Render's free disk is wiped on every restart. They are served at /uploads/<name>.
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { badRequest } from './http.js';
import { nowIso } from '../db.js';

const KINDS = [
  { ext: 'jpg', type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', type: 'image/png', test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', type: 'image/webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
];
export const FILE_NAME = /^[0-9a-f-]+\.(jpg|png|webp)$/;
export const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export function decodeImage(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw badRequest('Send the photo as a JPEG, PNG or WebP image.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > config.maxPhotoBytes) throw badRequest('The photo is too large. Use one under ' + Math.round(config.maxPhotoBytes / 1048576) + ' MB.');
  const kind = KINDS.find((k) => k.test(buf));
  if (!kind) throw badRequest('That file is not a valid image.');
  return { buf, ext: kind.ext };
}

/** Remove EXIF/XMP/comment segments (APP1–APP15, COM) from a JPEG. Keeps APP0 (JFIF) and image data. */
export function stripJpegMetadata(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const parts = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return buf; // not a marker: leave the file as it was
    const marker = buf[i + 1];
    if (marker === 0xda) { parts.push(buf.subarray(i)); return Buffer.concat(parts); } // start of scan: rest is image data
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { parts.push(buf.subarray(i, i + 2)); i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return buf;
    const drop = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!drop) parts.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return buf;
}

/** Width and height of a JPEG, PNG or WebP image, or null. */
export function imageSize(buf) {
  try {
    if (buf[0] === 0x89 && buf.slice(1, 4).toString() === 'PNG') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') {
      const t = buf.slice(12, 16).toString();
      if (t === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (t === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
      if (t === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) return null;
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* unreadable header */ }
  return null;
}

/** Save an uploaded image in the database; returns { file, width, height }. */
export async function saveImage(db, dataUrl) {
  let { buf, ext } = decodeImage(dataUrl);
  if (ext === 'jpg') buf = stripJpegMetadata(buf);
  const size = imageSize(buf) || {};
  const file = randomUUID() + '.' + ext;
  await db.files.insertOne({ _id: file, id: file, type: MIME[ext], size: buf.length, data: buf, created_at: nowIso() });
  return { file, width: size.width ?? null, height: size.height ?? null };
}
export const savePhoto = async (db, dataUrl) => (await saveImage(db, dataUrl)).file;

export async function removePhotoFile(db, file) {
  if (!file || !FILE_NAME.test(file)) return;
  await db.files.deleteOne({ _id: file });
}

/** The stored image, or null. */
export async function readPhotoFile(db, file) {
  if (!file || !FILE_NAME.test(file)) return null;
  return db.files.findOne({ _id: file });
}
