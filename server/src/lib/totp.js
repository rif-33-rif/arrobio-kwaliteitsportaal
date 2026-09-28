import crypto from 'node:crypto';

// Minimale, afhankelijkheidsvrije implementatie van TOTP (RFC 6238) bovenop
// HOTP (RFC 4226), gebruikt voor optionele MFA (sectie 27 van de bouwopdracht).
// Geen externe library nodig: alles bouwt op Node's ingebouwde crypto-module.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateSecret(byteLength = 20) {
  return base32Encode(crypto.randomBytes(byteLength));
}

export function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder > 0) {
    const lastChunk = bits.slice(bits.length - remainder).padEnd(5, '0');
    output += BASE32_ALPHABET[parseInt(lastChunk, 2)];
  }
  return output;
}

function base32Decode(input) {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secretBase32, counter, digits = 6) {
  const key = base32Decode(secretBase32);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binCode % 10 ** digits).padStart(digits, '0');
}

export function generateTOTP(secretBase32, { step = 30, digits = 6, forTime = Date.now() } = {}) {
  const counter = Math.floor(forTime / 1000 / step);
  return hotp(secretBase32, counter, digits);
}

// Controleert de code tegen het huidige en aangrenzende tijdvak (klokdrift).
export function verifyTOTP(secretBase32, token, { step = 30, digits = 6, window = 1 } = {}) {
  if (!/^\d+$/.test(String(token))) return false;
  const now = Date.now();
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const candidate = generateTOTP(secretBase32, { step, digits, forTime: now + errorWindow * step * 1000 });
    if (candidate === String(token)) return true;
  }
  return false;
}

export function buildOtpauthUrl({ secret, accountName, issuer = 'Arrobio Kwaliteitsportaal' }) {
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?${params.toString()}`;
}
