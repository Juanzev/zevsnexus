// Leitor de zip mínimo para XLSX e ODS (só leitura, só o necessário), com teto de descompressão:
// o tamanho declarado é conferido antes e o zlib corta a saída no teto (zip bomb não passa).
// Sem zip64, sem criptografia, só "stored" (0) e "deflate" (8) — o que Excel e LibreOffice gravam.
import { inflateRawSync } from 'node:zlib';
import { LIMITS, tooLarge, unreadable } from './limits.js';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function findEndOfCentralDirectory(buffer) {
  const stop = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= stop; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD) return offset;
  }
  throw unreadable();
}

/** Índice do zip: nome → { method, compressedSize, size, offset, encrypted }. */
export function openZip(buffer) {
  if (buffer.length < 22) throw unreadable();
  const eocd = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (directoryOffset === 0xffffffff || count === 0xffff) throw unreadable(); // zip64
  const entries = new Map();
  let offset = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL) throw unreadable();
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.set(name, {
      encrypted: (buffer.readUInt16LE(offset + 8) & 1) === 1,
      method: buffer.readUInt16LE(offset + 10),
      compressedSize: buffer.readUInt32LE(offset + 20),
      size: buffer.readUInt32LE(offset + 24),
      offset: buffer.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  let totalRead = 0;
  return {
    has: (name) => entries.has(name),
    names: () => [...entries.keys()],
    /** Conteúdo descompactado da parte, ou null se não existir. */
    read(name) {
      const entry = entries.get(name);
      if (!entry) return null;
      if (entry.encrypted || (entry.method !== 0 && entry.method !== 8)) throw unreadable();
      if (entry.size > LIMITS.maxEntryBytes || totalRead + entry.size > LIMITS.maxTotalBytes) throw tooLarge();
      const local = entry.offset;
      if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== LOCAL) throw unreadable();
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const end = start + entry.compressedSize;
      if (end > buffer.length) throw unreadable();
      const data = buffer.subarray(start, end);
      let content;
      if (entry.method === 0) {
        content = data;
      } else {
        try {
          // maxOutputLength: o tamanho declarado pode mentir; o zlib para no teto.
          content = inflateRawSync(data, { maxOutputLength: LIMITS.maxEntryBytes });
        } catch (err) {
          if (err.code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError) throw tooLarge();
          throw unreadable();
        }
      }
      totalRead += content.length;
      if (totalRead > LIMITS.maxTotalBytes) throw tooLarge();
      return content;
    },
  };
}
