// José (24 sep 2026): reparto "a partes iguales" que CUADRA al céntimo.
// Antes: 100 € entre 3 → 33,33 × 3 = 99,99. En "Personalizado" eso hacía que
// el reparto inicial no cuadrara con el total (y bloqueaba Guardar con
// "Falta 0,01"), y en "A partes iguales" la lista mostraba importes que no
// sumaban el total. Los céntimos sobrantes van a los primeros de la lista.
// En monedas sin decimales (JPY, KRW...) se reparte en unidades enteras.
export function splitEvenly(total, n, zeroDecimal = false) {
  const amount = Number(total);
  if (!n || n < 1 || !Number.isFinite(amount) || amount <= 0) return [];
  const unit = zeroDecimal ? 1 : 100;
  const units = Math.round(amount * unit);
  const base = Math.floor(units / n);
  let rest = units - base * n;
  return Array.from({ length: n }, () => {
    const u = base + (rest > 0 ? 1 : 0);
    if (rest > 0) rest--;
    return u / unit;
  });
}

export function formatShare(value, zeroDecimal = false, lang = 'es') {
  if (value == null || !Number.isFinite(value)) return '';
  return value.toLocaleString(lang === 'en' ? 'en' : 'es', {
    minimumFractionDigits: zeroDecimal ? 0 : 2,
    maximumFractionDigits: zeroDecimal ? 0 : 2,
  });
}
