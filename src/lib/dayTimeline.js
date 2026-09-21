// José (21 sep 2026) — paso 2 (docs/ARQUITECTURA.md §5): el orden de un día
// (documentos + notas + spots mezclados) y la regla "no se puede invertir el
// orden de dos cosas con hora fija" estaban copiados a mano en DayCard.jsx
// (Home) y en Cities.jsx (Ruta). Cuando uno se arreglaba, el otro seguía mal.
// Ahora es una sola implementación, con pruebas.
//
// Reglas del orden de un día:
//  · Lo que ya tiene una posición manual (arrastrado → day_order / order) forma
//    la columna vertebral, en ese orden.
//  · Lo que no se ha arrastrado se intercala por hora si la tiene, o va al
//    final si no.
//  · En cuanto se arrastra algo, esa posición manda sobre la hora.
//
// timeOf(item) → "HH:MM" | null      orderOf(item) → número | null
export function orderDayItems(items, timeOf, orderOf) {
  const pinned = items.filter(i => orderOf(i) != null).sort((a, b) => orderOf(a) - orderOf(b));
  const unpinnedTimed = items.filter(i => orderOf(i) == null && timeOf(i)).sort((a, b) => timeOf(a).localeCompare(timeOf(b)));
  const unpinnedUntimed = items.filter(i => orderOf(i) == null && !timeOf(i));

  const merged = [];
  let ui = 0;
  for (const item of pinned) {
    if (timeOf(item)) {
      while (ui < unpinnedTimed.length && timeOf(unpinnedTimed[ui]) <= timeOf(item)) {
        merged.push(unpinnedTimed[ui]);
        ui++;
      }
    }
    merged.push(item);
  }
  while (ui < unpinnedTimed.length) { merged.push(unpinnedTimed[ui]); ui++; }

  return [...merged, ...unpinnedUntimed];
}

// Se puede recolocar cualquier cosa donde quieras, EXCEPTO invertir el orden
// entre dos items que ya tienen hora fija (un spot a las 14:00 no puede acabar
// antes que uno a las 11:00). Solo se mira el item que se acaba de mover contra
// el vecino con hora justo antes y justo después — no toda la lista, para que
// una inversión antigua en otra parte del día no bloquee cualquier arrastre.
// Devuelve [a, b] con el par en conflicto, o null.
export function findTimeClash(orderedItems, movedId, timeOf) {
  const idx = orderedItems.findIndex(i => (i.id || '') === movedId);
  if (idx === -1) return null;
  const moved = orderedItems[idx];
  if (!timeOf(moved)) return null;
  let prev = null;
  for (let k = idx - 1; k >= 0; k--) { if (timeOf(orderedItems[k])) { prev = orderedItems[k]; break; } }
  let next = null;
  for (let k = idx + 1; k < orderedItems.length; k++) { if (timeOf(orderedItems[k])) { next = orderedItems[k]; break; } }
  if (prev && timeOf(prev) > timeOf(moved)) return [prev, moved];
  if (next && timeOf(next) < timeOf(moved)) return [moved, next];
  return null;
}
