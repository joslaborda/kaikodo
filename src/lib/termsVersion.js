// José (22 sep 2026): fuente única de la versión de Términos/Privacidad.
// Antes vivía solo dentro de CreateProfileModal.jsx (TERMS_VERSION local) y
// se escribía en profile.terms_version al aceptar por primera vez, pero
// nada volvía a leer ese campo nunca — así que aunque el comentario del
// propio archivo decía que sería para "detectar consentimiento viejo y
// pedir re-aceptación", ese mecanismo no existía. Ahora la comparación vive
// en App.jsx (TermsReacceptGate) usando esta misma constante, para que
// CreateProfileModal (alta nueva) y el gate (usuarios ya existentes) nunca
// puedan desincronizarse.
//
// Subir este valor (a la fecha del cambio, o cualquier string que cambie)
// es lo único que hace falta para que todo usuario con profile.terms_version
// distinto vea la pantalla de re-aceptación la próxima vez que abra la app.
export const TERMS_VERSION = '2026-07-22';
