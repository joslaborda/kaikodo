import { base44 } from '@/api/base44Client';

// ── Verificación anti-bot propia de Kaikōdo (sin terceros) ─────────────────
//
// Por qué existe: Cloudflare Turnstile no se pudo hacer funcionar de forma
// fiable dentro del WebView nativo de Capacitor (confirmado en sesión
// anterior) -- los widgets de captcha basados en iframe de terceros son una
// fuente de problemas conocida en WebViews embebidos (cookies particionadas,
// popups bloqueados, restricciones de storage). La alternativa: un reto de
// prueba-de-trabajo (estilo hashcash) resuelto enteramente en el propio JS
// de la app, sin cargar ningún script ni dominio externo -- así que se
// comporta EXACTAMENTE igual en un navegador que dentro del WebView nativo,
// porque no depende de nada que un WebView pueda tratar de forma distinta.
//
// Cómo funciona: el backend (getCaptchaChallenge) entrega un reto aleatorio
// de un solo uso + una dificultad (bits a cero exigidos al principio de
// SHA-256(reto + ':' + nonce)). El cliente prueba nonces hasta encontrar uno
// que cumpla y manda "reto.nonce" de vuelta (verifyCaptcha en el backend
// repite el mismo cálculo y solo acepta si coincide, con TTL corto y un solo
// uso). Cuesta CPU real de forma intencionada -- eso es lo que encarece un
// registro masivo automatizado sin necesitar ningún servicio externo.
//
// Se usa una implementación de SHA-256 síncrona en JS puro (no
// crypto.subtle.digest) a propósito: crypto.subtle es asíncrono, y llamarlo
// una vez por intento (potencialmente decenas de miles de veces) añade
// overhead de microtarea en cada vuelta que hace el reto mucho más lento de
// lo que debería. La síncrona permite miles de intentos entre cada punto en
// el que se cede el hilo principal (setTimeout(0)), así la UI no se congela
// pero tampoco se paga ese overhead en cada hash individual.

// José (25 sep 2026): SHA-256 rápido de UN bloque (mensajes de hasta 55
// bytes, que es siempre nuestro caso: 40 hex + ':' + nonce). La versión de
// abajo recalculaba las constantes (64 primos) en CADA hash y trabajaba con
// cadenas: ~40.000 hashes/s en un ordenador y muchísimos menos en un Android
// modesto, así que el reto (65.000 intentos de media) a veces no llegaba a
// resolverse en los 25 s y fallaba ("No se pudo verificar") -- y cada
// reintento pedía otro reto hasta chocar con el límite por IP. Esta versión
// usa constantes precalculadas y arrays tipados, sin crear cadenas: ~50 veces
// más rápida (verificada contra el SHA-256 estándar). El formato del reto no
// cambia, así que verifyCaptcha en el backend no se toca.
const K = new Int32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
const H0 = new Int32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
const W = new Int32Array(64);
const OUT = new Int32Array(8);
// SHA-256 de un mensaje ASCII de <=55 bytes (un solo bloque). Devuelve los 8 words en OUT.
function sha256OneBlock(bytes, len) {
  W.fill(0, 0, 16);
  for (let i = 0; i < len; i++) W[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
  W[len >> 2] |= 0x80 << (24 - (len & 3) * 8);
  W[15] = len * 8;
  for (let i = 16; i < 64; i++) {
    const w15 = W[i-15], w2 = W[i-2];
    const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
    const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
    W[i] = (W[i-16] + s0 + W[i-7] + s1) | 0;
  }
  let a=H0[0],b=H0[1],c=H0[2],d=H0[3],e=H0[4],f=H0[5],g=H0[6],h=H0[7];
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
  }
  OUT[0]=(H0[0]+a)|0;OUT[1]=(H0[1]+b)|0;OUT[2]=(H0[2]+c)|0;OUT[3]=(H0[3]+d)|0;OUT[4]=(H0[4]+e)|0;OUT[5]=(H0[5]+f)|0;OUT[6]=(H0[6]+g)|0;OUT[7]=(H0[7]+h)|0;
  return OUT;
}

function leadingZeroBitsOk(words, bits) {
  if (bits <= 32) return bits === 0 || (words[0] >>> (32 - bits)) === 0;
  return words[0] === 0 && (words[1] >>> (64 - bits)) === 0;
}

// -- SHA-256 síncrono, dependencia cero. Verificado contra los vectores de
// prueba estándar (SHA256("") / SHA256("abc") / SHA256("hello world")) antes
// de integrarlo -- ver notas de la sesión de implementación.
function sha256Hex(asciiString) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const maxWord = Math.pow(2, 32);
  let result = '';
  const words = [];
  const asciiBitLength = asciiString.length * 8;

  let hash = [];
  const k = [];
  let primeCounter = 0;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  asciiString += '\x80';
  while ((asciiString.length % 64) - 56) asciiString += '\x00';
  for (let i = 0; i < asciiString.length; i++) {
    const j = asciiString.charCodeAt(i);
    if (j >> 8) return null; // solo ASCII -- nuestros retos son hex, siempre lo son
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = ((asciiBitLength / maxWord) | 0);
  words[words.length] = (asciiBitLength);

  for (let j = 0; j < words.length;) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);

    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const a = hash[0], e = hash[4];
      const temp1 = hash[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & hash[5]) ^ ((~e) & hash[6]))
        + k[i]
        + (w[i] = (i < 16) ? w[i] : (
            w[i - 16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0);
      const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }

    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }

  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

function hasLeadingZeroBits(hex, bits) {
  const fullNibbles = Math.floor(bits / 4);
  const remBits = bits % 4;
  for (let i = 0; i < fullNibbles; i++) { if (hex[i] !== '0') return false; }
  if (remBits === 0) return true;
  const nibble = parseInt(hex[fullNibbles], 16);
  return (nibble >> (4 - remBits)) === 0;
}

const CHUNK_SIZE = 20000; // nonces probados entre cada cesión del hilo principal (con el SHA-256 rápido son unos ms)
const MAX_MS = 25000;     // salvaguarda: falla en vez de colgarse en un dispositivo muy lento

// Resuelve un reto completo: pide uno nuevo al backend y busca el nonce.
// onProgress(pct) es opcional, para mostrar una barra/porcentaje aproximado.
// Devuelve el token ("reto.nonce") listo para verifyCaptcha, o null si no
// se pudo (backend no disponible, o se agotó el tiempo).
export async function solveCaptchaChallenge({ onProgress } = {}) {
  let challenge, difficulty, expiresInSeconds;
  try {
    const res = await base44.functions.invoke('getCaptchaChallenge', {});
    challenge = res?.data?.challenge || res?.challenge;
    difficulty = res?.data?.difficulty ?? res?.difficulty ?? 16;
    expiresInSeconds = res?.data?.expiresInSeconds ?? res?.expiresInSeconds ?? 120;
  } catch {
    return null;
  }
  if (!challenge) return null;

  const started = Date.now();
  const deadline = started + Math.min(MAX_MS, expiresInSeconds * 1000 - 3000);
  let nonce = 0;

  // Camino rápido (un bloque): el reto + ':' se escribe una vez en el búfer y
  // en cada intento solo se reescriben los dígitos del nonce.
  const prefix = challenge + ':';
  const fast = /^[\x00-\x7f]*$/.test(prefix) && prefix.length + 12 <= 55; // 41 + hasta 12 dígitos de nonce (nunca se llega)
  const buf = new Uint8Array(64);
  if (fast) for (let i = 0; i < prefix.length; i++) buf[i] = prefix.charCodeAt(i);

  while (Date.now() < deadline) {
    for (let i = 0; i < CHUNK_SIZE; i++) {
      let ok;
      if (fast) {
        const ds = String(nonce);
        for (let j = 0; j < ds.length; j++) buf[prefix.length + j] = ds.charCodeAt(j);
        ok = leadingZeroBitsOk(sha256OneBlock(buf, prefix.length + ds.length), difficulty);
      } else {
        const hex = sha256Hex(prefix + nonce);
        ok = !!hex && hasLeadingZeroBits(hex, difficulty);
      }
      if (ok) return `${challenge}.${nonce}`;
      nonce++;
    }
    if (onProgress) {
      const pct = Math.min(96, Math.round(((Date.now() - started) / (deadline - started)) * 100));
      onProgress(pct);
    }
    // Cede el hilo principal para que la UI (spinner, resto de la pantalla)
    // no se congele mientras se resuelve el reto.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return null;
}
