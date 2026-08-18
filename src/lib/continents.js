// continents.js — Mapa continente para agrupar spots publicos en el
// explorador jerarquico del Perfil (continente -> pais -> ciudad).
// countryConfig.js no guarda continente por pais, asi que se resuelve aqui a
// partir del ISO-3166 alpha-2 que ya calcula getCountryIso() para el nombre
// canonico en espanol de cada pais (el mismo que se guarda en Spot.country).
import { getCountryIso } from '@/lib/countryConfig';

export const CONTINENT_ORDER = ['europe', 'asia', 'africa', 'north_america', 'south_america', 'oceania', 'other'];

export const CONTINENT_EMOJI = {
  europe: '🏰',
  asia: '🏯',
  africa: '🌍',
  north_america: '🗽',
  south_america: '🌎',
  oceania: '🏝️',
  other: '🌐',
};

const ISO2_CONTINENT = {
  // Europa
  AD:'europe', AL:'europe', AT:'europe', AX:'europe', BA:'europe', BE:'europe', BG:'europe', BY:'europe',
  CH:'europe', CY:'europe', CZ:'europe', DE:'europe', DK:'europe', EE:'europe', ES:'europe', FI:'europe',
  FO:'europe', FR:'europe', GB:'europe', GG:'europe', GI:'europe', GR:'europe', HR:'europe', HU:'europe',
  IE:'europe', IM:'europe', IS:'europe', IT:'europe', JE:'europe', LI:'europe', LT:'europe', LU:'europe',
  LV:'europe', MC:'europe', MD:'europe', ME:'europe', MK:'europe', MT:'europe', NL:'europe', NO:'europe',
  PL:'europe', PT:'europe', RO:'europe', RS:'europe', RU:'europe', SE:'europe', SI:'europe', SJ:'europe',
  SK:'europe', SM:'europe', UA:'europe', VA:'europe', XK:'europe',
  // Asia (incluye Caucaso: AM/AZ/GE se tratan como Asia aqui)
  AE:'asia', AF:'asia', AM:'asia', AZ:'asia', BD:'asia', BH:'asia', BN:'asia', BT:'asia', CN:'asia',
  GE:'asia', HK:'asia', ID:'asia', IL:'asia', IN:'asia', IQ:'asia', IR:'asia', JO:'asia', JP:'asia',
  KG:'asia', KH:'asia', KP:'asia', KR:'asia', KW:'asia', KZ:'asia', LA:'asia', LB:'asia', LK:'asia',
  MM:'asia', MN:'asia', MO:'asia', MV:'asia', MY:'asia', NP:'asia', OM:'asia', PH:'asia', PK:'asia',
  PS:'asia', QA:'asia', SA:'asia', SG:'asia', SY:'asia', TH:'asia', TJ:'asia', TL:'asia', TM:'asia',
  TW:'asia', UZ:'asia', VN:'asia', YE:'asia',
  // Africa
  AO:'africa', BF:'africa', BI:'africa', BJ:'africa', BW:'africa', CD:'africa', CF:'africa', CG:'africa',
  CI:'africa', CM:'africa', CV:'africa', DJ:'africa', DZ:'africa', EG:'africa', EH:'africa', ER:'africa',
  ET:'africa', GA:'africa', GH:'africa', GM:'africa', GN:'africa', GQ:'africa', GW:'africa', KE:'africa',
  KM:'africa', LR:'africa', LS:'africa', LY:'africa', MA:'africa', MG:'africa', ML:'africa', MR:'africa',
  MU:'africa', MW:'africa', MZ:'africa', NA:'africa', NE:'africa', NG:'africa', RW:'africa', SC:'africa',
  SD:'africa', SL:'africa', SN:'africa', SO:'africa', SS:'africa', ST:'africa', SZ:'africa', TD:'africa',
  TG:'africa', TN:'africa', TZ:'africa', UG:'africa', ZA:'africa', ZM:'africa', ZW:'africa',
  // America del Norte, Centroamerica y Caribe
  AG:'north_america', AI:'north_america', AW:'north_america', BB:'north_america', BM:'north_america',
  BS:'north_america', BZ:'north_america', CA:'north_america', CR:'north_america', CU:'north_america',
  CW:'north_america', DM:'north_america', DO:'north_america', GD:'north_america', GL:'north_america',
  GP:'north_america', GT:'north_america', HN:'north_america', HT:'north_america', JM:'north_america',
  KN:'north_america', KY:'north_america', LC:'north_america', MF:'north_america', MQ:'north_america',
  MS:'north_america', MX:'north_america', NI:'north_america', PA:'north_america', PR:'north_america',
  SV:'north_america', SX:'north_america', TC:'north_america', TT:'north_america', US:'north_america',
  VC:'north_america', VG:'north_america', VI:'north_america',
  // America del Sur
  AR:'south_america', BO:'south_america', BR:'south_america', CL:'south_america', CO:'south_america',
  EC:'south_america', FK:'south_america', GF:'south_america', GY:'south_america', PE:'south_america',
  PY:'south_america', SR:'south_america', UY:'south_america', VE:'south_america',
  // Oceania
  AS:'oceania', AU:'oceania', CK:'oceania', FJ:'oceania', FM:'oceania', GU:'oceania', KI:'oceania',
  MH:'oceania', MP:'oceania', NC:'oceania', NR:'oceania', NU:'oceania', NZ:'oceania', PF:'oceania',
  PG:'oceania', PW:'oceania', SB:'oceania', TO:'oceania', TV:'oceania', VU:'oceania', WF:'oceania',
  WS:'oceania',
};

// countryEs: nombre canonico en espanol tal como se guarda en Spot.country
// (normalizeCountry ya se encarga de eso antes de llegar aqui). Devuelve un
// codigo de continente estable (para usar como clave i18n continents.<code>),
// nunca el nombre traducido — eso se resuelve en el punto de render con t().
export function getContinent(countryEs) {
  if (!countryEs) return 'other';
  const iso = getCountryIso(countryEs);
  return (iso && ISO2_CONTINENT[iso]) || 'other';
}
