import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZipBuffer(files) {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (Math.floor(now.getSeconds() / 2))) & 0xFFFF;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

  const localHeaders = [];
  const centralHeaders = [];
  let currentOffset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name.replace(/\\/g, '/').replace(/^\/+/, ''));
    const dataBytes = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    // Local header (30 bytes)
    const local = new Uint8Array(30 + nameBytes.length + size);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8
    lv.setUint16(8, 0, true); // Stored
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(dataBytes, 30 + nameBytes.length);
    localHeaders.push(local);

    // Central header (46 bytes)
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, currentOffset, true);
    central.set(nameBytes, 46);
    centralHeaders.push(central);

    currentOffset += local.length;
  }

  const centralOffset = currentOffset;
  let centralSize = 0;
  for (const c of centralHeaders) centralSize += c.length;

  // End of central directory (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);
  ev.setUint16(20, 0, true);

  const totalLen = currentOffset + centralSize + 22;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const l of localHeaders) {
    out.set(l, pos);
    pos += l.length;
  }
  for (const c of centralHeaders) {
    out.set(c, pos);
    pos += c.length;
  }
  out.set(eocd, pos);

  return out;
}

const testFiles = [
  { name: 'ai-pentest/requirements.txt', content: 'nmap>=0.7.0\npyyaml>=6.0\n' },
  { name: 'ai-pentest/config/settings.yaml', content: 'scanner:\n  default_timeout: 30\n' },
  { name: 'ai-pentest/core/engine.py', content: '#!/usr/bin/env python3\nprint("Engine online")\n' },
  { name: 'README.md', content: '# Pentest System\nAll rights reserved.\n' },
];

const zipBuf = createZipBuffer(testFiles);
const tmpZip = path.join('/tmp', `test-zip-${Date.now()}.zip`);
const tmpExtract = path.join('/tmp', `test-extract-${Date.now()}`);

fs.writeFileSync(tmpZip, zipBuf);
fs.mkdirSync(tmpExtract, { recursive: true });

try {
  execSync(`unzip -o "${tmpZip}" -d "${tmpExtract}"`, { stdio: 'pipe' });
  for (const file of testFiles) {
    const extractedPath = path.join(tmpExtract, file.name);
    if (!fs.existsSync(extractedPath)) {
      throw new Error(`Missing extracted file: ${file.name}`);
    }
    const read = fs.readFileSync(extractedPath, 'utf8');
    if (read !== file.content) {
      throw new Error(`Content mismatch in ${file.name}`);
    }
  }
  console.log('✔ Pure TypeScript/JS ZIP Generator verified! All 4 files extracted identically.');
} finally {
  fs.rmSync(tmpZip, { force: true });
  fs.rmSync(tmpExtract, { recursive: true, force: true });
}
