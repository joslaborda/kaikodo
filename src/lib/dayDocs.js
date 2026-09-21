// Qué documentos van en la fila de UN día de UNA parada de Ruta.
//
// Un documento se enlaza a su parada por city_id (y a su destino por arrival_city_id).
// Si después se BORRA esa parada, o se acorta y ya no cubre el día del documento, el
// filtro de "misma ciudad" lo dejaba en ninguna fila — el billete desaparecía de
// Ruta (seguía en Documentos). Ahora un documento "sin casa" (sin ciudad, con una
// ciudad que ya no existe o que ya no cubre ese día) cae en la primera parada que SÍ
// cubre ese día — una sola, para no repetirlo en los dos lados de un día de tránsito.
export function docsForDay({ allDocs = [], cities = [], dateStr, cityId }) {
  const list = [...cities].sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));
  const covers = (c) => !!c && !!c.start_date && !!c.end_date && dateStr >= c.start_date && dateStr <= c.end_date;
  const firstCovering = list.find(covers);
  return allDocs.filter(d => {
    const dd = d.date || d.valid_from || d.start_date;
    if (dd !== dateStr) return false;
    const own = list.find(c => c.id === d.city_id);
    const arr = list.find(c => c.id === d.arrival_city_id);
    if (!covers(own) && !covers(arr)) return firstCovering ? firstCovering.id === cityId : true;
    return d.city_id === cityId || d.arrival_city_id === cityId;
  });
}

// Lo mismo para los spots asignados a un día: un spot cuya parada se borró (o se
// acortó) no debe desaparecer de Ruta con su día asignado. El alojamiento nunca
// va en un día (ver cityStay.js), así que se excluye.
export function spotsForDay({ allSpots = [], cities = [], dateStr, cityId }) {
  const list = [...cities].sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));
  const covers = (c) => !!c && !!c.start_date && !!c.end_date && dateStr >= c.start_date && dateStr <= c.end_date;
  const firstCovering = list.find(covers);
  return allSpots
    .filter(s => {
      if (s.type === 'hotel' || s.assigned_date !== dateStr) return false;
      const own = list.find(c => c.id === s.city_id);
      if (!covers(own)) return firstCovering ? firstCovering.id === cityId : true;
      return s.city_id === cityId;
    })
    .sort((a, b) => (a.day_order ?? 999) - (b.day_order ?? 999));
}
