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

const CHUNK_SIZE = 3000;  // nonces probados entre cada cesión del hilo principal
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

  while (Date.now() < deadline) {
    for (let i = 0; i < CHUNK_SIZE; i++) {
      const hex = sha256Hex(challenge + ':' + nonce);
      if (hex && hasLeadingZeroBits(hex, difficulty)) {
        return `${challenge}.${nonce}`;
      }
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
