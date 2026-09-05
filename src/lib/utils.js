import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
} 


export const isIframe = window.self !== window.top;

// Hallazgo de seguridad (Base44 Security Scanner, XSS basado en DOM): un
// campo de texto libre controlado por el usuario (p. ej. Spot.link, un
// enlace externo opcional que cualquier miembro del viaje puede escribir al
// crear un spot) se renderizaba directo como `href` de un <a>. Un
// `javascript:alert(document.cookie)` guardado ahí se ejecutaba en la
// sesión de quien pinchara el enlace — DOM XSS clásico vía esquema URI.
// Cualquier `href` que venga de un campo escrito por un usuario (no
// construido por la propia app, como sí lo son las URLs de Google Maps)
// debe pasar por aquí antes de usarse. Solo se permiten esquemas http/https
// — un enlace externo legítimo nunca necesita ser otra cosa.
export function isSafeHttpUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    // new URL() con base relativa a location resuelve también rutas tipo
    // "//evil.com" o "\\evil.com" al protocolo real que usaría el
    // navegador, en vez de fiarse de un regex sobre el string crudo.
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// UserProfile.email se guarda siempre en minúsculas (ver migración silenciosa
// en App.jsx), pero trip.members / expense.paid_by / invite.email etc. venían
// tal cual del proveedor de auth o de lo que se tecleara — con mayúsculas
// distintas según el caso. Comparar/buscar perfiles por email sin normalizar
// primero es lo que hacía que el propio creador de un viaje (su email nunca
// pasaba por la migración de UserProfile) apareciera con el email en crudo en
// vez de su nombre en los avatares del viaje. Un solo sitio para esta regla:
// cualquier comparación o lookup de email debe pasar por aquí primero.
export const normalizeEmail = (email) => (email || '').trim().toLowerCase();

// Monedas ISO 4217 sin decimales (0 dígitos tras la coma/punto). Antes cada
// sitio que necesitaba saber esto (Expenses.jsx, ExpenseForm.jsx x2)
// hardcodeaba su propia lista corta ['JPY','KRW','VND','IDR'] — incompleta y
// desalineada con las monedas que la propia app soporta explícitamente (CLP,
// COP están en el enum de Expense.jsonc y en countryConfig.js). Un gasto en
// CLP/COP podía mostrarse con "céntimos" que no existen tras una conversión.
// Lista según ISO 4217 (monedas con "minor unit" 0).
export const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG',
  'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF', 'IDR',
]);
export const isZeroDecimalCurrency = (code) => ZERO_DECIMAL_CURRENCIES.has(code);

// Convierte un importe escrito a mano (que puede venir en formato "1.234,56"
// o "1,234.56" o "1234.56") a un string parseable por parseFloat/Number.
// Antes se hacía con un simple `.replace(',', '.')`, que con "1.234,56"
// (formato español, mil doscientos treinta y cuatro con 56) producía
// "1.234.56" — parseFloat lo lee como 1.234, guardando el gasto ~1000 veces
// más pequeño sin ningún aviso. Regla: si aparecen coma Y punto, el símbolo
// que aparece MÁS TARDE en la cadena es el separador decimal y el otro se
// trata como separador de miles. Si solo aparece coma, se interpreta como
// decimal solo cuando hay 1-2 dígitos después (p.ej. "12,50"); si hay 3+
// dígitos después de la única coma, se asume separador de miles ("1,234").
// Simétricamente para un único punto con 3+ dígitos detrás ("1.234").
export function normalizeAmountInput(raw) {
  if (raw == null) return raw;
  let s = String(raw).replace(/[^0-9.,]/g, '');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
      // La coma es el decimal; los puntos anteriores son miles.
      return s.replace(/\./g, '').replace(',', '.');
    }
    // El punto es el decimal; las comas anteriores son miles.
    return s.replace(/,/g, '');
  }

  if (hasComma) {
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      return s.replace(',', '.'); // "12,50" -> decimal
    }
    return s.replace(/,/g, ''); // "1,234" o "1,234,567" -> miles
  }

  if (hasDot) {
    const parts = s.split('.');
    if (parts.length > 2) {
      // Varios puntos: antes se asumía SIEMPRE que el último grupo era el
      // decimal ("1.234.567" -> "1234.567", en vez de 1234567) — el mismo
      // bug ×1000 que este parseo existe para evitar, pero solo se
      // comprobaba la longitud del último grupo en la rama de un único
      // punto. Aquí aplicamos la misma regla: último grupo de 2 dígitos o
      // menos = decimal ("1.234.567,89" ya se filtra antes por tener coma;
      // esto cubre "1.234.567" sin coma, típico de CLP/COP/VND/IDR), si no,
      // todos los grupos son miles.
      const last = parts.pop();
      if (last.length <= 2) return parts.join('') + '.' + last;
      parts.push(last);
      return parts.join(''); // todos los grupos son separadores de miles
    }
    if (parts.length === 2 && parts[1].length > 2) {
      return parts.join(''); // "1.234" -> miles, sin parte decimal
    }
    return s; // "12.50" -> ya es decimal válido
  }

  return s;
}
