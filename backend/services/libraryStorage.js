'use strict';
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(process.env.LIBRARY_STORAGE_PATH || path.join(__dirname, '..', 'uploads', 'library'));
async function ensureRoot() { await fs.mkdir(ROOT, { recursive: true }); }
function safeName(name) { return path.basename(String(name || '')).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 180); }
function extension(name) { return path.extname(name).toLowerCase(); }
function detectType(buffer, ext) {
  if (buffer.subarray(0, 4).toString() === '%PDF') return 'application/pdf';
  if (buffer.subarray(0, 2).toString('hex') === 'd0cf') return 'application/x-cfb';
  if (buffer.subarray(0, 4).toString('hex') === '504b0304') return 'application/zip';
  if (ext === '.png' && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (['.jpg','.jpeg'].includes(ext) && buffer.subarray(0, 3).toString('hex') === 'ffd8ff') return 'image/jpeg';
  if (ext === '.gif' && buffer.subarray(0, 3).toString() === 'GIF') return 'image/gif';
  return null;
}
async function save(buffer, originalName) { await ensureRoot(); const fileName = `${crypto.randomUUID()}${extension(originalName)}`; await fs.writeFile(path.join(ROOT, fileName), buffer, { flag: 'wx' }); return { fileName, fileUrl: `/api/library/materials/${fileName}/content` }; }
function resolve(fileName) { const candidate = path.resolve(ROOT, fileName); if (!candidate.startsWith(ROOT + path.sep)) throw new Error('Invalid storage path'); return candidate; }
async function remove(fileName) { try { await fs.unlink(resolve(fileName)); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
module.exports = { safeName, extension, detectType, save, resolve, remove };
