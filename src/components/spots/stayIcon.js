// Pin de alojamiento — el MISMO en todos los mapas (Hoy, Mañana, Ruta y el mapa de
// Spots). Antes cada mapa dibujaba el suyo: un pin gris con una casa en el mapa
// del día y un círculo naranja con un edificio en el mapa de la ruta.
export function stayGoogleIcon(google) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="34" viewBox="0 0 30 34"><path d="M15 1C7.8 1 2 6.8 2 14c0 9.5 13 19 13 19s13-9.5 13-19C28 6.8 22.2 1 15 1z" fill="#6b6460" stroke="#fff" stroke-width="2.5"/><path d="M9 15l6-4.5 6 4.5v6.5a1.2 1.2 0 0 1-1.2 1.2H10.2A1.2 1.2 0 0 1 9 21.5z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><path d="M12.5 22.7V17h5v5.7" fill="none" stroke="#fff" stroke-width="1.8"/></svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(30, 34),
    anchor: new google.maps.Point(15, 32),
  };
}

export function stayLeafletIcon(L) {
  return L.divIcon({
    html: '<div style="width:26px;height:26px;background:#6b6460;border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" style="transform:rotate(45deg)"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg></div>',
    iconSize: [26, 26], iconAnchor: [13, 26], className: '',
  });
}
