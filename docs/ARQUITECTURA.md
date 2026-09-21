# Kaikōdo — arquitectura y contrato de datos

Documento de referencia. Antes de cambiar cómo se ve o se calcula algo, se
comprueba aquí. Si una regla cambia, se cambia aquí primero.

## 1. Principio

Los datos viven **una sola vez**. Hay dos bibliotecas donde se guarda todo
(**Documentos** y **Spots**). **Ruta** es el plan del viaje y se *calcula* a
partir de ellas. **Home** (Salida · Hoy · Mañana) y los **mapas** son vistas de
ese plan. Ninguna pantalla inventa su propia versión de los datos.

```
Documentos ──┐
             ├──▶ Ruta (tu plan, día a día) ──▶ Home (Salida · Hoy · Mañana)
Spots ───────┘            │
   ▲   ▲                  └──▶ Mapas (un solo componente)
   └───┴── Alojamiento (Spot type:'hotel' ↔ reserva Ticket category:'hotel')
```

## 2. Entidades

| Entidad | Qué es | Campos clave |
|---|---|---|
| `Trip` | El viaje | `members`, `start_date`, `end_date` |
| `City` | Una **estancia** en una ciudad (una ciudad repetida = dos `City`) | `start_date`, `end_date`, `order` |
| `Ticket` | Un documento (billete, reserva, entrada, seguro…) | `category`, `date`, `time`, `city_id`, `used_by`, `visibility`, `shared_with`, `spot_id`, `location_*` |
| `Spot` | Un sitio | `type`, `city_id`, `lat/lng`, `assigned_date`, `assigned_time`, `day_order` |
| `ItineraryDay` | Título y notas de un día | `date`, `city_id`, `content` |

## 3. El contrato (las reglas)

### Documentos
- Se suben una vez. Por su **fecha + ciudad** caen solos en su día de Ruta.
- **Para quién es** (`used_by`, por defecto "Yo"): decide a quién le sale el
  documento en *su* Ruta y *su* Home, y en qué móvil suena el recordatorio.
- **Quién lo ve** (`visibility` / `shared_with`): a quién le aparece en
  Documentos. Por defecto todo el grupo (billetes, eventos, hotel) o solo quien
  lo usa (seguro, otro).
- **Quien usa un documento siempre puede abrirlo**, decida quien decida la
  visibilidad (regla de acceso `used_by` en `Ticket.jsonc` + el propio
  formulario).
- Un documento sin `used_by` (anterior a este campo) cuenta como de quien lo
  subió (`created_by`).

### Spots
- Se guardan en Spots y salen en el mapa de Spots.
- Con día asignado (`assigned_date`) entran además en Ruta y en los mapas de
  Ruta, Hoy y Mañana.

### Alojamiento
- **Uno por estancia (`City`)**. Vive en Spots (`type:'hotel'`) pero **nunca** en
  un día: ni día ni hora, ni parada numerada en un mapa. Sale como pin de
  alojamiento en los mapas y como "Te alojas en X" en Home y Ruta.
- Es el mismo objeto se cree por donde se cree:
  - **Añadir alojamiento** (Spots/Home/Ruta) → se ofrece subir la reserva
    (opcional).
  - **Subir una reserva** (Documento tipo Hotel, con el buscador de hotel) →
    crea o enlaza el alojamiento de la ciudad.
- Se enlazan con `Ticket.spot_id` (`src/lib/hotelStay.js`), no por nombre.
- Si hay varios en una ciudad, manda el último que se añadió
  (`getCityHotel`, `src/lib/cityStay.js`). Se quita desde la ficha
  ("Quitar alojamiento").

### Ruta = tu plan
- Muestra, por día: tus documentos + los de **todo el grupo** + tus spots +
  notas.
- Los documentos de **otros viajeros** de ese día van **plegados** en
  "De otros viajeros (N)". Así siguen accesibles (si otro no tiene móvil o
  batería) sin ensuciar tu día.

### Home
- **Salida / Hoy / Mañana** = ventana del plan para ese día, con las mismas
  reglas que Ruta (solo tus documentos + los del grupo).
- El billete destacado ("Tu próximo tren") es solo uno que **tú** vas a usar.

### Documentos (pantalla)
- Muestra **todo lo que puedes ver**, con "Para ti / Para Carlos / Para todo el
  grupo". Es el archivo completo.

## 4. Quién lee qué

| Pantalla | Archivo | Datos | Filtro |
|---|---|---|---|
| Salida | `home/InicioTab.jsx` + `DayCard.jsx` | Ticket, Spot, ItineraryDay | mis docs + grupo; sin alojamientos en el día |
| Hoy / Mañana | `home/TodayTab.jsx`, `TomorrowTab.jsx` + `DayCard.jsx` | ídem | ídem |
| Ruta | `pages/Cities.jsx` | ídem + City | ídem + "De otros viajeros" |
| Spots | `pages/Restaurants.jsx` | Spot | todos los spots del viaje |
| Documentos | `pages/Documents.jsx` | Ticket | todo lo visible |
| Mapas | `TodayRouteMap`, `SpotsMapView`, `DaySpotsMap` | Spot, Ticket (`location_*`) | alojamiento aparte; encuadre en `lib/mapFit.js` |

Funciones compartidas: `lib/cityStay.js` (alojamiento), `lib/docHolders.js`
(para quién es), `lib/hotelStay.js` (reserva ↔ alojamiento), `lib/mapFit.js`
(encuadre de mapas), `lib/localReminders.js` (`syncTicketRemindersForUser`).

## 5. Deuda conocida (paso 2 del plan)

Estas duplicidades son la causa de que un arreglo en una pantalla no llegue a
otra. El paso 2 las unifica sin cambiar cómo se ve nada:

1. `Ticket` se carga desde 6 sitios con 3 cachés distintas (`allDocs`,
   `documents`, `tickets`) → **una sola consulta compartida**.
2. Hay dos constructores del timeline del día (`DayCard.jsx` y `Cities.jsx`) →
   **uno solo**, que reciben Home y Ruta.
3. Hay tres componentes de mapa con su propia lógica → **uno** con modos.

## 6. Antes de tocar nada

- ¿El dato ya existe en una biblioteca? No se duplica: se lee.
- ¿Afecta a Ruta *y* a Home? Se cambia la regla en la función compartida, no
  en cada pantalla.
- ¿Añade un campo? Se añade en `base44/entities/*.jsonc`, se tolera su ausencia
  en datos antiguos y se documenta aquí.
- ¿Toca "para quién"? Se comprueba: acceso, Ruta/Home de esa persona,
  recordatorio en su móvil.
