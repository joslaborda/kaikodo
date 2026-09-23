/**
 * countryConfig.js — Sistema global multi-país
 * Fuente de verdad para moneda, idioma, bandera, ciudades top y emergencias.
 * Soporta búsqueda por label (español) y por código ISO-3166.
 */

import { base44 } from '@/api/base44Client';

// ─── STATIC KNOWN METADATA ───────────────────────────────────────────────────
const KNOWN_META = {
  // ── Europa occidental ──────────────────────────────────────────────────────
  'España':             { currency: 'EUR', symbol: '€',    languageCode: 'es-ES', languageLabel: 'Español',      flag: '🇪🇸', iso: 'ES', plug: 'C/F' },
  'Italia':             { currency: 'EUR', symbol: '€',    languageCode: 'it-IT', languageLabel: 'Italiano',     flag: '🇮🇹', iso: 'IT', plug: 'C/F' },
  'Francia':            { currency: 'EUR', symbol: '€',    languageCode: 'fr-FR', languageLabel: 'Français',     flag: '🇫🇷', iso: 'FR', plug: 'C/F' },
  'Portugal':           { currency: 'EUR', symbol: '€',    languageCode: 'pt-PT', languageLabel: 'Português',    flag: '🇵🇹', iso: 'PT', plug: 'C/F' },
  'Alemania':           { currency: 'EUR', symbol: '€',    languageCode: 'de-DE', languageLabel: 'Deutsch',      flag: '🇩🇪', iso: 'DE', plug: 'C/F' },
  'Grecia':             { currency: 'EUR', symbol: '€',    languageCode: 'el-GR', languageLabel: 'Ελληνικά',     flag: '🇬🇷', iso: 'GR', plug: 'C/F' },
  'Países Bajos':       { currency: 'EUR', symbol: '€',    languageCode: 'nl-NL', languageLabel: 'Nederlands',   flag: '🇳🇱', iso: 'NL', plug: 'C/F' },
  'Bélgica':            { currency: 'EUR', symbol: '€',    languageCode: 'fr-BE', languageLabel: 'Français',     flag: '🇧🇪', iso: 'BE', plug: 'C/F' },
  'Austria':            { currency: 'EUR', symbol: '€',    languageCode: 'de-AT', languageLabel: 'Deutsch',      flag: '🇦🇹', iso: 'AT', plug: 'C/F' },
  'Irlanda':            { currency: 'EUR', symbol: '€',    languageCode: 'en-IE', languageLabel: 'English',      flag: '🇮🇪', iso: 'IE', plug: 'G' },
  'Finlandia':          { currency: 'EUR', symbol: '€',    languageCode: 'fi-FI', languageLabel: 'Suomi',        flag: '🇫🇮', iso: 'FI', plug: 'C/F' },
  'Croacia':            { currency: 'EUR', symbol: '€',    languageCode: 'hr-HR', languageLabel: 'Hrvatski',     flag: '🇭🇷', iso: 'HR', plug: 'C/F' },
  'Eslovenia':          { currency: 'EUR', symbol: '€',    languageCode: 'sl-SI', languageLabel: 'Slovenščina',  flag: '🇸🇮', iso: 'SI', plug: 'C/F' },
  'Eslovaquia':         { currency: 'EUR', symbol: '€',    languageCode: 'sk-SK', languageLabel: 'Slovenčina',   flag: '🇸🇰', iso: 'SK', plug: 'C/F' },
  'Luxemburgo':         { currency: 'EUR', symbol: '€',    languageCode: 'fr-LU', languageLabel: 'Français',     flag: '🇱🇺', iso: 'LU', plug: 'C/F' },
  'Malta':              { currency: 'EUR', symbol: '€',    languageCode: 'mt-MT', languageLabel: 'Malti',        flag: '🇲🇹', iso: 'MT', plug: 'G' },
  'Chipre':             { currency: 'EUR', symbol: '€',    languageCode: 'el-CY', languageLabel: 'Ελληνικά',     flag: '🇨🇾', iso: 'CY', plug: 'G' },
  'Reino Unido':        { currency: 'GBP', symbol: '£',    languageCode: 'en-GB', languageLabel: 'English',      flag: '🇬🇧', iso: 'GB', plug: 'G' },
  'Suiza':              { currency: 'CHF', symbol: 'Fr',   languageCode: 'de-CH', languageLabel: 'Deutsch',      flag: '🇨🇭', iso: 'CH', plug: 'C/F' },
  'Mónaco':             { currency: 'EUR', symbol: '€',    languageCode: 'fr-MC', languageLabel: 'Français',     flag: '🇲🇨', iso: 'MC' },
  'Andorra':            { currency: 'EUR', symbol: '€',    languageCode: 'ca-AD', languageLabel: 'Català',       flag: '🇦🇩', iso: 'AD', plug: 'C/F' },

  // ── Europa nórdica ─────────────────────────────────────────────────────────
  'Noruega':            { currency: 'NOK', symbol: 'kr',   languageCode: 'nb-NO', languageLabel: 'Norsk',        flag: '🇳🇴', iso: 'NO', plug: 'C/F' },
  'Suecia':             { currency: 'SEK', symbol: 'kr',   languageCode: 'sv-SE', languageLabel: 'Svenska',      flag: '🇸🇪', iso: 'SE', plug: 'C/F' },
  'Dinamarca':          { currency: 'DKK', symbol: 'kr',   languageCode: 'da-DK', languageLabel: 'Dansk',        flag: '🇩🇰', iso: 'DK', plug: 'C/F' },
  'Islandia':           { currency: 'ISK', symbol: 'kr',   languageCode: 'is-IS', languageLabel: 'Íslenska',     flag: '🇮🇸', iso: 'IS', plug: 'C/F' },

  // ── Europa del Este ────────────────────────────────────────────────────────
  'Polonia':            { currency: 'PLN', symbol: 'zł',   languageCode: 'pl-PL', languageLabel: 'Polski',       flag: '🇵🇱', iso: 'PL', plug: 'C/F' },
  'República Checa':    { currency: 'CZK', symbol: 'Kč',   languageCode: 'cs-CZ', languageLabel: 'Čeština',      flag: '🇨🇿', iso: 'CZ', plug: 'C/F' },
  'Hungría':            { currency: 'HUF', symbol: 'Ft',   languageCode: 'hu-HU', languageLabel: 'Magyar',       flag: '🇭🇺', iso: 'HU', plug: 'C/F' },
  'Rumanía':            { currency: 'RON', symbol: 'lei',  languageCode: 'ro-RO', languageLabel: 'Română',       flag: '🇷🇴', iso: 'RO', plug: 'C/F' },
  'Bulgaria':           { currency: 'BGN', symbol: 'лв',   languageCode: 'bg-BG', languageLabel: 'Български',    flag: '🇧🇬', iso: 'BG', plug: 'C/F' },
  'Serbia':             { currency: 'RSD', symbol: 'din',  languageCode: 'sr-RS', languageLabel: 'Srpski',       flag: '🇷🇸', iso: 'RS', plug: 'C/F' },
  'Albania':            { currency: 'ALL', symbol: 'L',    languageCode: 'sq-AL', languageLabel: 'Shqip',        flag: '🇦🇱', iso: 'AL', plug: 'C/F' },
  'Macedonia del Norte':{ currency: 'MKD', symbol: 'ден', languageCode: 'mk-MK', languageLabel: 'Македонски',   flag: '🇲🇰', iso: 'MK', plug: 'C/F' },
  'Bosnia':             { currency: 'BAM', symbol: 'KM',   languageCode: 'bs-BA', languageLabel: 'Bosanski',     flag: '🇧🇦', iso: 'BA', plug: 'C/F' },
  'Montenegro':         { currency: 'EUR', symbol: '€',    languageCode: 'sr-ME', languageLabel: 'Crnogorski',   flag: '🇲🇪', iso: 'ME', plug: 'C/F' },
  'Estonia':            { currency: 'EUR', symbol: '€',    languageCode: 'et-EE', languageLabel: 'Eesti',        flag: '🇪🇪', iso: 'EE', plug: 'C/F' },
  'Letonia':            { currency: 'EUR', symbol: '€',    languageCode: 'lv-LV', languageLabel: 'Latviešu',     flag: '🇱🇻', iso: 'LV', plug: 'C/F' },
  'Lituania':           { currency: 'EUR', symbol: '€',    languageCode: 'lt-LT', languageLabel: 'Lietuvių',     flag: '🇱🇹', iso: 'LT', plug: 'C/F' },
  'Ucrania':            { currency: 'UAH', symbol: '₴',    languageCode: 'uk-UA', languageLabel: 'Українська',   flag: '🇺🇦', iso: 'UA', plug: 'C/F' },
  'Rusia':              { currency: 'RUB', symbol: '₽',    languageCode: 'ru-RU', languageLabel: 'Русский',      flag: '🇷🇺', iso: 'RU', plug: 'C/F' },
  'Georgia':            { currency: 'GEL', symbol: '₾',    languageCode: 'ka-GE', languageLabel: 'ქართული',      flag: '🇬🇪', iso: 'GE', plug: 'C/F' },
  'Armenia':            { currency: 'AMD', symbol: '֏',    languageCode: 'hy-AM', languageLabel: 'Հայերեն',      flag: '🇦🇲', iso: 'AM', plug: 'C/F' },
  'Azerbaiyán':         { currency: 'AZN', symbol: '₼',    languageCode: 'az-AZ', languageLabel: 'Azərbaycan',   flag: '🇦🇿', iso: 'AZ', plug: 'C/F' },
  'Kosovo':             { currency: 'EUR', symbol: '€',    languageCode: 'sq-XK', languageLabel: 'Shqip',        flag: '🇽🇰', iso: 'XK' },
  'Moldova':            { currency: 'MDL', symbol: 'L',    languageCode: 'ro-MD', languageLabel: 'Română',       flag: '🇲🇩', iso: 'MD', plug: 'C/F' },
  'Bielorrusia':        { currency: 'BYN', symbol: 'Br',   languageCode: 'be-BY', languageLabel: 'Беларуская',   flag: '🇧🇾', iso: 'BY', plug: 'C/F' },

  // ── Norteamérica ───────────────────────────────────────────────────────────
  'Estados Unidos':     { currency: 'USD', symbol: '$',    languageCode: 'en-US', languageLabel: 'English',      flag: '🇺🇸', iso: 'US', plug: 'A/B' },
  'Canadá':             { currency: 'CAD', symbol: '$',    languageCode: 'en-CA', languageLabel: 'English',      flag: '🇨🇦', iso: 'CA', plug: 'A/B' },
  'México':             { currency: 'MXN', symbol: '$',    languageCode: 'es-MX', languageLabel: 'Español',      flag: '🇲🇽', iso: 'MX', plug: 'A/B' },
  'Cuba':               { currency: 'CUP', symbol: '$',    languageCode: 'es-CU', languageLabel: 'Español',      flag: '🇨🇺', iso: 'CU', plug: 'C/F' },
  'Costa Rica':         { currency: 'CRC', symbol: '₡',    languageCode: 'es-CR', languageLabel: 'Español',      flag: '🇨🇷', iso: 'CR', plug: 'C/F' },
  'Panamá':             { currency: 'PAB', symbol: 'B/.',  languageCode: 'es-PA', languageLabel: 'Español',      flag: '🇵🇦', iso: 'PA', plug: 'C/F' },
  'Guatemala':          { currency: 'GTQ', symbol: 'Q',    languageCode: 'es-GT', languageLabel: 'Español',      flag: '🇬🇹', iso: 'GT', plug: 'C/F' },
  'Honduras':           { currency: 'HNL', symbol: 'L',    languageCode: 'es-HN', languageLabel: 'Español',      flag: '🇭🇳', iso: 'HN', plug: 'C/F' },
  'El Salvador':        { currency: 'USD', symbol: '$',    languageCode: 'es-SV', languageLabel: 'Español',      flag: '🇸🇻', iso: 'SV', plug: 'C/F' },
  'Nicaragua':          { currency: 'NIO', symbol: 'C$',   languageCode: 'es-NI', languageLabel: 'Español',      flag: '🇳🇮', iso: 'NI', plug: 'C/F' },
  'República Dominicana':{ currency: 'DOP', symbol: 'RD$', languageCode: 'es-DO', languageLabel: 'Español',     flag: '🇩🇴', iso: 'DO', plug: 'C/F' },
  'Jamaica':            { currency: 'JMD', symbol: '$',    languageCode: 'en-JM', languageLabel: 'English',      flag: '🇯🇲', iso: 'JM', plug: 'C/F' },
  'Trinidad y Tobago':  { currency: 'TTD', symbol: '$',    languageCode: 'en-TT', languageLabel: 'English',      flag: '🇹🇹', iso: 'TT', plug: 'C/F' },
  'Barbados':           { currency: 'BBD', symbol: '$',    languageCode: 'en-BB', languageLabel: 'English',      flag: '🇧🇧', iso: 'BB', plug: 'C/F' },
  'Bahamas':            { currency: 'BSD', symbol: '$',    languageCode: 'en-BS', languageLabel: 'English',      flag: '🇧🇸', iso: 'BS', plug: 'C/F' },
  'Haití':              { currency: 'HTG', symbol: 'G',    languageCode: 'fr-HT', languageLabel: 'Français',     flag: '🇭🇹', iso: 'HT', plug: 'C/F' },
  'Saint-Martin':       { currency: 'EUR', symbol: '€',    languageCode: 'fr-MF', languageLabel: 'Français',     flag: '🇲🇫', iso: 'MF' },
  'Saint Martin':       { currency: 'EUR', symbol: '€',    languageCode: 'fr-MF', languageLabel: 'Français',     flag: '🇲🇫', iso: 'MF' },
  'Sint Maarten':       { currency: 'ANG', symbol: 'ƒ',    languageCode: 'nl-SX', languageLabel: 'Nederlands',   flag: '🇸🇽', iso: 'SX' },
  'Martinica':          { currency: 'EUR', symbol: '€',    languageCode: 'fr-MQ', languageLabel: 'Français',     flag: '🇲🇶', iso: 'MQ' },
  'Guadalupe':          { currency: 'EUR', symbol: '€',    languageCode: 'fr-GP', languageLabel: 'Français',     flag: '🇬🇵', iso: 'GP' },
  'Puerto Rico':        { currency: 'USD', symbol: '$',    languageCode: 'es-PR', languageLabel: 'Español',      flag: '🇵🇷', iso: 'PR' },
  'Bermudas':           { currency: 'BMD', symbol: '$',    languageCode: 'en-BM', languageLabel: 'English',      flag: '🇧🇲', iso: 'BM' },
  'Aruba':              { currency: 'AWG', symbol: 'ƒ',    languageCode: 'nl-AW', languageLabel: 'Papiamento',   flag: '🇦🇼', iso: 'AW' },
  'Curazao':            { currency: 'ANG', symbol: 'ƒ',    languageCode: 'nl-CW', languageLabel: 'Papiamento',   flag: '🇨🇼', iso: 'CW' },
  'Antigua y Barbuda':  { currency: 'XCD', symbol: '$',    languageCode: 'en-AG', languageLabel: 'English',      flag: '🇦🇬', iso: 'AG', plug: 'C/F' },
  'Santa Lucía':        { currency: 'XCD', symbol: '$',    languageCode: 'en-LC', languageLabel: 'English',      flag: '🇱🇨', iso: 'LC', plug: 'C/F' },
  'San Vicente':        { currency: 'XCD', symbol: '$',    languageCode: 'en-VC', languageLabel: 'English',      flag: '🇻🇨', iso: 'VC', plug: 'C/F' },
  'Granada':            { currency: 'XCD', symbol: '$',    languageCode: 'en-GD', languageLabel: 'English',      flag: '🇬🇩', iso: 'GD', plug: 'C/F' },
  'Dominica':           { currency: 'XCD', symbol: '$',    languageCode: 'en-DM', languageLabel: 'English',      flag: '🇩🇲', iso: 'DM', plug: 'C/F' },

  // ── Sudamérica ─────────────────────────────────────────────────────────────
  'Argentina':          { currency: 'ARS', symbol: '$',    languageCode: 'es-AR', languageLabel: 'Español',      flag: '🇦🇷', iso: 'AR', plug: 'C/F' },
  'Brasil':             { currency: 'BRL', symbol: 'R$',   languageCode: 'pt-BR', languageLabel: 'Português',    flag: '🇧🇷', iso: 'BR', plug: 'C/F' },
  'Chile':              { currency: 'CLP', symbol: '$',    languageCode: 'es-CL', languageLabel: 'Español',      flag: '🇨🇱', iso: 'CL', plug: 'C/F' },
  'Colombia':           { currency: 'COP', symbol: '$',    languageCode: 'es-CO', languageLabel: 'Español',      flag: '🇨🇴', iso: 'CO', plug: 'C/F' },
  'Perú':               { currency: 'PEN', symbol: 'S/',   languageCode: 'es-PE', languageLabel: 'Español',      flag: '🇵🇪', iso: 'PE', plug: 'C/F' },
  'Uruguay':            { currency: 'UYU', symbol: '$',    languageCode: 'es-UY', languageLabel: 'Español',      flag: '🇺🇾', iso: 'UY', plug: 'C/F' },
  'Bolivia':            { currency: 'BOB', symbol: 'Bs.',  languageCode: 'es-BO', languageLabel: 'Español',      flag: '🇧🇴', iso: 'BO', plug: 'C/F' },
  'Ecuador':            { currency: 'USD', symbol: '$',    languageCode: 'es-EC', languageLabel: 'Español',      flag: '🇪🇨', iso: 'EC', plug: 'C/F' },
  'Venezuela':          { currency: 'VES', symbol: 'Bs.S', languageCode: 'es-VE', languageLabel: 'Español',      flag: '🇻🇪', iso: 'VE', plug: 'C/F' },
  'Paraguay':           { currency: 'PYG', symbol: '₲',    languageCode: 'es-PY', languageLabel: 'Español',      flag: '🇵🇾', iso: 'PY', plug: 'C/F' },
  'Guyana':             { currency: 'GYD', symbol: '$',    languageCode: 'en-GY', languageLabel: 'English',      flag: '🇬🇾', iso: 'GY', plug: 'C/F' },
  'Surinam':            { currency: 'SRD', symbol: '$',    languageCode: 'nl-SR', languageLabel: 'Nederlands',   flag: '🇸🇷', iso: 'SR', plug: 'C/F' },

  // ── Asia Oriental ──────────────────────────────────────────────────────────
  'Japón':              { currency: 'JPY', symbol: '¥',    languageCode: 'ja-JP', languageLabel: 'Japanese',     flag: '🇯🇵', iso: 'JP', plug: 'A/B' },
  'Japan':              { currency: 'JPY', symbol: '¥',    languageCode: 'ja-JP', languageLabel: 'Japanese',     flag: '🇯🇵', iso: 'JP' },
  'China':              { currency: 'CNY', symbol: '¥',    languageCode: 'zh-CN', languageLabel: 'Chinese',      flag: '🇨🇳', iso: 'CN', plug: 'C/F' },
  'Corea del Sur':      { currency: 'KRW', symbol: '₩',    languageCode: 'ko-KR', languageLabel: 'Korean',       flag: '🇰🇷', iso: 'KR', plug: 'C/F' },
  'Taiwan':             { currency: 'TWD', symbol: 'NT$',  languageCode: 'zh-TW', languageLabel: 'Chinese',      flag: '🇹🇼', iso: 'TW' },
  'Mongolia':           { currency: 'MNT', symbol: '₮',    languageCode: 'mn-MN', languageLabel: 'Mongolian',    flag: '🇲🇳', iso: 'MN', plug: 'C/F' },

  // ── Asia Sudoriental ───────────────────────────────────────────────────────
  'Tailandia':          { currency: 'THB', symbol: '฿',    languageCode: 'th-TH', languageLabel: 'Thai',         flag: '🇹🇭', iso: 'TH', plug: 'C/F' },
  'Vietnam':            { currency: 'VND', symbol: '₫',    languageCode: 'vi-VN', languageLabel: 'Vietnamese',   flag: '🇻🇳', iso: 'VN', plug: 'C/F' },
  'Camboya':            { currency: 'KHR', symbol: '៛',    languageCode: 'km-KH', languageLabel: 'Khmer',        flag: '🇰🇭', iso: 'KH', plug: 'C/F' },
  'Laos':               { currency: 'LAK', symbol: '₭',    languageCode: 'lo-LA', languageLabel: 'Lao',          flag: '🇱🇦', iso: 'LA', plug: 'C/F' },
  'Myanmar':            { currency: 'MMK', symbol: 'K',    languageCode: 'my-MM', languageLabel: 'Burmese',      flag: '🇲🇲', iso: 'MM' },
  'Indonesia':          { currency: 'IDR', symbol: 'Rp',   languageCode: 'id-ID', languageLabel: 'Indonesian',   flag: '🇮🇩', iso: 'ID', plug: 'C/F' },
  'Singapur':           { currency: 'SGD', symbol: '$',    languageCode: 'en-SG', languageLabel: 'English',      flag: '🇸🇬', iso: 'SG', plug: 'G' },
  'Malasia':            { currency: 'MYR', symbol: 'RM',   languageCode: 'ms-MY', languageLabel: 'Malay',        flag: '🇲🇾', iso: 'MY', plug: 'C/F' },
  'Filipinas':          { currency: 'PHP', symbol: '₱',    languageCode: 'fil-PH', languageLabel: 'Filipino',    flag: '🇵🇭', iso: 'PH', plug: 'C/F' },
  'Brunéi':             { currency: 'BND', symbol: '$',    languageCode: 'ms-BN', languageLabel: 'Malay',        flag: '🇧🇳', iso: 'BN', plug: 'C/F' },
  'Timor Oriental':     { currency: 'USD', symbol: '$',    languageCode: 'pt-TL', languageLabel: 'Português',    flag: '🇹🇱', iso: 'TL', plug: 'C/F' },

  // ── Asia del Sur ───────────────────────────────────────────────────────────
  'India':              { currency: 'INR', symbol: '₹',    languageCode: 'hi-IN', languageLabel: 'Hindi',        flag: '🇮🇳', iso: 'IN', plug: 'C/F' },
  'Nepal':              { currency: 'NPR', symbol: '₨',    languageCode: 'ne-NP', languageLabel: 'Nepali',       flag: '🇳🇵', iso: 'NP', plug: 'C/F' },
  'Sri Lanka':          { currency: 'LKR', symbol: '₨',    languageCode: 'si-LK', languageLabel: 'Sinhala',      flag: '🇱🇰', iso: 'LK', plug: 'C/F' },
  'Maldivas':           { currency: 'MVR', symbol: 'Rf',   languageCode: 'dv-MV', languageLabel: 'Dhivehi',      flag: '🇲🇻', iso: 'MV', plug: 'C/F' },
  'Bután':              { currency: 'BTN', symbol: 'Nu',   languageCode: 'dz-BT', languageLabel: 'Dzongkha',     flag: '🇧🇹', iso: 'BT', plug: 'C/F' },
  'Pakistán':           { currency: 'PKR', symbol: '₨',    languageCode: 'ur-PK', languageLabel: 'Urdu',         flag: '🇵🇰', iso: 'PK', plug: 'C/F' },
  'Bangladés':          { currency: 'BDT', symbol: '৳',    languageCode: 'bn-BD', languageLabel: 'Bengali',      flag: '🇧🇩', iso: 'BD' },

  // ── Asia Central ───────────────────────────────────────────────────────────
  'Uzbekistán':         { currency: 'UZS', symbol: 'soʻm', languageCode: 'uz-UZ', languageLabel: 'Uzbek',        flag: '🇺🇿', iso: 'UZ', plug: 'C/F' },
  'Kazajistán':         { currency: 'KZT', symbol: '₸',    languageCode: 'kk-KZ', languageLabel: 'Kazakh',       flag: '🇰🇿', iso: 'KZ', plug: 'C/F' },
  'Kirguistán':         { currency: 'KGS', symbol: 'som',  languageCode: 'ky-KG', languageLabel: 'Kyrgyz',       flag: '🇰🇬', iso: 'KG', plug: 'C/F' },

  // ── Oriente Medio ──────────────────────────────────────────────────────────
  'Turquía':            { currency: 'TRY', symbol: '₺',    languageCode: 'tr-TR', languageLabel: 'Türkçe',       flag: '🇹🇷', iso: 'TR', plug: 'C/F' },
  'Emiratos Árabes':    { currency: 'AED', symbol: 'د.إ',  languageCode: 'ar-AE', languageLabel: 'Arabic',       flag: '🇦🇪', iso: 'AE', plug: 'C/F' },
  'Arabia Saudí':       { currency: 'SAR', symbol: '﷼',    languageCode: 'ar-SA', languageLabel: 'Arabic',       flag: '🇸🇦', iso: 'SA' },
  'Israel':             { currency: 'ILS', symbol: '₪',    languageCode: 'he-IL', languageLabel: 'Hebrew',       flag: '🇮🇱', iso: 'IL', plug: 'C/F' },
  'Jordania':           { currency: 'JOD', symbol: 'JD',   languageCode: 'ar-JO', languageLabel: 'Arabic',       flag: '🇯🇴', iso: 'JO', plug: 'C/F' },
  'Líbano':             { currency: 'LBP', symbol: 'ل.ل',  languageCode: 'ar-LB', languageLabel: 'Arabic',       flag: '🇱🇧', iso: 'LB', plug: 'C/F' },
  'Omán':               { currency: 'OMR', symbol: '﷼',    languageCode: 'ar-OM', languageLabel: 'Arabic',       flag: '🇴🇲', iso: 'OM', plug: 'C/F' },
  'Qatar':              { currency: 'QAR', symbol: '﷼',    languageCode: 'ar-QA', languageLabel: 'Arabic',       flag: '🇶🇦', iso: 'QA' },
  'Kuwait':             { currency: 'KWD', symbol: 'KD',   languageCode: 'ar-KW', languageLabel: 'Arabic',       flag: '🇰🇼', iso: 'KW', plug: 'C/F' },
  'Bahréin':            { currency: 'BHD', symbol: 'BD',   languageCode: 'ar-BH', languageLabel: 'Arabic',       flag: '🇧🇭', iso: 'BH' },
  'Irán':               { currency: 'IRR', symbol: '﷼',    languageCode: 'fa-IR', languageLabel: 'Farsi',        flag: '🇮🇷', iso: 'IR', plug: 'C/F' },

  // ── África del Norte ───────────────────────────────────────────────────────
  'Marruecos':          { currency: 'MAD', symbol: 'DH',   languageCode: 'ar-MA', languageLabel: 'Arabic',       flag: '🇲🇦', iso: 'MA', plug: 'C/F' },
  'Egipto':             { currency: 'EGP', symbol: '£',    languageCode: 'ar-EG', languageLabel: 'Arabic',       flag: '🇪🇬', iso: 'EG', plug: 'C/F' },
  'Túnez':              { currency: 'TND', symbol: 'DT',   languageCode: 'ar-TN', languageLabel: 'Arabic',       flag: '🇹🇳', iso: 'TN', plug: 'C/F' },
  'Argelia':            { currency: 'DZD', symbol: 'دج',   languageCode: 'ar-DZ', languageLabel: 'Arabic',       flag: '🇩🇿', iso: 'DZ', plug: 'C/F' },
  'Libia':              { currency: 'LYD', symbol: 'LD',   languageCode: 'ar-LY', languageLabel: 'Arabic',       flag: '🇱🇾', iso: 'LY', plug: 'C/F' },
  'Sudán':              { currency: 'SDG', symbol: '£',    languageCode: 'ar-SD', languageLabel: 'Arabic',       flag: '🇸🇩', iso: 'SD', plug: 'C/F' },

  // ── África Subsahariana ────────────────────────────────────────────────────
  'Sudáfrica':          { currency: 'ZAR', symbol: 'R',    languageCode: 'en-ZA', languageLabel: 'English',      flag: '🇿🇦', iso: 'ZA', plug: 'C/F' },
  'Kenia':              { currency: 'KES', symbol: 'KSh',  languageCode: 'sw-KE', languageLabel: 'Swahili',      flag: '🇰🇪', iso: 'KE', plug: 'C/F' },
  'Tanzania':           { currency: 'TZS', symbol: 'TSh',  languageCode: 'sw-TZ', languageLabel: 'Swahili',      flag: '🇹🇿', iso: 'TZ', plug: 'C/F' },
  'Uganda':             { currency: 'UGX', symbol: 'USh',  languageCode: 'sw-UG', languageLabel: 'Swahili',      flag: '🇺🇬', iso: 'UG', plug: 'C/F' },
  'Ruanda':             { currency: 'RWF', symbol: 'RF',   languageCode: 'rw-RW', languageLabel: 'Kinyarwanda',  flag: '🇷🇼', iso: 'RW', plug: 'C/F' },
  'Rwanda':             { currency: 'RWF', symbol: 'RF',   languageCode: 'rw-RW', languageLabel: 'Kinyarwanda',  flag: '🇷🇼', iso: 'RW' },
  'Etiopía':            { currency: 'ETB', symbol: 'Br',   languageCode: 'am-ET', languageLabel: 'Amharic',      flag: '🇪🇹', iso: 'ET', plug: 'C/F' },
  'Ghana':              { currency: 'GHS', symbol: '₵',    languageCode: 'en-GH', languageLabel: 'English',      flag: '🇬🇭', iso: 'GH', plug: 'C/F' },
  'Nigeria':            { currency: 'NGN', symbol: '₦',    languageCode: 'en-NG', languageLabel: 'English',      flag: '🇳🇬', iso: 'NG', plug: 'C/F' },
  'Senegal':            { currency: 'XOF', symbol: 'CFA',  languageCode: 'fr-SN', languageLabel: 'Français',     flag: '🇸🇳', iso: 'SN', plug: 'C/F' },
  'Camerún':            { currency: 'XAF', symbol: 'CFA',  languageCode: 'fr-CM', languageLabel: 'Français',     flag: '🇨🇲', iso: 'CM', plug: 'C/F' },
  'Angola':             { currency: 'AOA', symbol: 'Kz',   languageCode: 'pt-AO', languageLabel: 'Português',    flag: '🇦🇴', iso: 'AO', plug: 'C/F' },
  'Mozambique':         { currency: 'MZN', symbol: 'MT',   languageCode: 'pt-MZ', languageLabel: 'Português',    flag: '🇲🇿', iso: 'MZ', plug: 'C/F' },
  'Zambia':             { currency: 'ZMW', symbol: 'ZK',   languageCode: 'en-ZM', languageLabel: 'English',      flag: '🇿🇲', iso: 'ZM', plug: 'C/F' },
  'Zimbabue':           { currency: 'ZWL', symbol: '$',    languageCode: 'en-ZW', languageLabel: 'English',      flag: '🇿🇼', iso: 'ZW', plug: 'C/F' },
  'Botsuana':           { currency: 'BWP', symbol: 'P',    languageCode: 'en-BW', languageLabel: 'English',      flag: '🇧🇼', iso: 'BW', plug: 'C/F' },
  'Namibia':            { currency: 'NAD', symbol: '$',    languageCode: 'en-NA', languageLabel: 'English',      flag: '🇳🇦', iso: 'NA', plug: 'C/F' },
  'Madagascar':         { currency: 'MGA', symbol: 'Ar',   languageCode: 'mg-MG', languageLabel: 'Malagasy',     flag: '🇲🇬', iso: 'MG', plug: 'C/F' },

  // ── Oceanía ────────────────────────────────────────────────────────────────
  'Australia':          { currency: 'AUD', symbol: '$',    languageCode: 'en-AU', languageLabel: 'English',      flag: '🇦🇺', iso: 'AU', plug: 'C/F' },
  'Nueva Zelanda':      { currency: 'NZD', symbol: '$',    languageCode: 'en-NZ', languageLabel: 'English',      flag: '🇳🇿', iso: 'NZ', plug: 'C/F' },
  'Fiyi':               { currency: 'FJD', symbol: '$',    languageCode: 'en-FJ', languageLabel: 'English',      flag: '🇫🇯', iso: 'FJ', plug: 'C/F' },

  // ── Caribe completo ────────────────────────────────────────────────────────
  'San Cristóbal y Nieves':    { currency: 'XCD', symbol: '$',   languageCode: 'en-KN', languageLabel: 'English',    flag: '🇰🇳', iso: 'KN', plug: 'C/F' },
  'Saint Kitts':               { currency: 'XCD', symbol: '$',   languageCode: 'en-KN', languageLabel: 'English',    flag: '🇰🇳', iso: 'KN' },
  'Montserrat':                { currency: 'XCD', symbol: '$',   languageCode: 'en-MS', languageLabel: 'English',    flag: '🇲🇸', iso: 'MS' },
  'Anguila':                   { currency: 'XCD', symbol: '$',   languageCode: 'en-AI', languageLabel: 'English',    flag: '🇦🇮', iso: 'AI' },
  'Islas Vírgenes Británicas': { currency: 'USD', symbol: '$',   languageCode: 'en-VG', languageLabel: 'English',    flag: '🇻🇬', iso: 'VG' },
  'Islas Vírgenes EEUU':       { currency: 'USD', symbol: '$',   languageCode: 'en-VI', languageLabel: 'English',    flag: '🇻🇮', iso: 'VI' },
  'Islas Turcos y Caicos':     { currency: 'USD', symbol: '$',   languageCode: 'en-TC', languageLabel: 'English',    flag: '🇹🇨', iso: 'TC' },
  'Islas Caimán':              { currency: 'KYD', symbol: '$',   languageCode: 'en-KY', languageLabel: 'English',    flag: '🇰🇾', iso: 'KY' },
  'Martinica':                 { currency: 'EUR', symbol: '€',   languageCode: 'fr-MQ', languageLabel: 'Français',   flag: '🇲🇶', iso: 'MQ' },
  'Guadalupe':                 { currency: 'EUR', symbol: '€',   languageCode: 'fr-GP', languageLabel: 'Français',   flag: '🇬🇵', iso: 'GP' },
  'San Bartolomé':             { currency: 'EUR', symbol: '€',   languageCode: 'fr-BL', languageLabel: 'Français',   flag: '🇧🇱', iso: 'BL' },
  'Saint Martin':              { currency: 'EUR', symbol: '€',   languageCode: 'fr-MF', languageLabel: 'Français',   flag: '🇲🇫', iso: 'MF' },
  'Bonaire':                   { currency: 'USD', symbol: '$',   languageCode: 'nl-BQ', languageLabel: 'Papiamento', flag: '🇧🇶', iso: 'BQ' },
  'Saba':                      { currency: 'USD', symbol: '$',   languageCode: 'en-BQ', languageLabel: 'English',    flag: '🇧🇶', iso: 'BQ' },
  'Sint Eustatius':            { currency: 'USD', symbol: '$',   languageCode: 'nl-BQ', languageLabel: 'Nederlands', flag: '🇧🇶', iso: 'BQ' },
  'Bermudas':                  { currency: 'BMD', symbol: '$',   languageCode: 'en-BM', languageLabel: 'English',    flag: '🇧🇲', iso: 'BM' },
  'Haití':                     { currency: 'HTG', symbol: 'G',   languageCode: 'fr-HT', languageLabel: 'Français',   flag: '🇭🇹', iso: 'HT', plug: 'C/F' },
  'Guyana Francesa':           { currency: 'EUR', symbol: '€',   languageCode: 'fr-GF', languageLabel: 'Français',   flag: '🇬🇫', iso: 'GF' },
  'Surinam':                   { currency: 'SRD', symbol: '$',   languageCode: 'nl-SR', languageLabel: 'Nederlands', flag: '🇸🇷', iso: 'SR', plug: 'C/F' },
  'Guyana':                    { currency: 'GYD', symbol: '$',   languageCode: 'en-GY', languageLabel: 'English',    flag: '🇬🇾', iso: 'GY', plug: 'C/F' },

  // ── Oceanía completa ───────────────────────────────────────────────────────
  'Papúa Nueva Guinea':        { currency: 'PGK', symbol: 'K',   languageCode: 'en-PG', languageLabel: 'English',    flag: '🇵🇬', iso: 'PG', plug: 'C/F' },
  'Islas Salomón':             { currency: 'SBD', symbol: '$',   languageCode: 'en-SB', languageLabel: 'English',    flag: '🇸🇧', iso: 'SB', plug: 'C/F' },
  'Vanuatu':                   { currency: 'VUV', symbol: 'Vt',  languageCode: 'bi-VU', languageLabel: 'Bislama',    flag: '🇻🇺', iso: 'VU', plug: 'C/F' },
  'Samoa':                     { currency: 'WST', symbol: 'T',   languageCode: 'sm-WS', languageLabel: 'Samoan',     flag: '🇼🇸', iso: 'WS', plug: 'C/F' },
  'Samoa Americana':           { currency: 'USD', symbol: '$',   languageCode: 'sm-AS', languageLabel: 'Samoan',     flag: '🇦🇸', iso: 'AS' },
  'Tonga':                     { currency: 'TOP', symbol: 'T$',  languageCode: 'to-TO', languageLabel: 'Tongan',     flag: '🇹🇴', iso: 'TO', plug: 'C/F' },
  'Kiribati':                  { currency: 'AUD', symbol: '$',   languageCode: 'en-KI', languageLabel: 'English',    flag: '🇰🇮', iso: 'KI', plug: 'C/F' },
  'Tuvalu':                    { currency: 'AUD', symbol: '$',   languageCode: 'en-TV', languageLabel: 'English',    flag: '🇹🇻', iso: 'TV', plug: 'C/F' },
  'Nauru':                     { currency: 'AUD', symbol: '$',   languageCode: 'en-NR', languageLabel: 'English',    flag: '🇳🇷', iso: 'NR', plug: 'C/F' },
  'Palaos':                    { currency: 'USD', symbol: '$',   languageCode: 'en-PW', languageLabel: 'English',    flag: '🇵🇼', iso: 'PW', plug: 'C/F' },
  'Micronesia':                { currency: 'USD', symbol: '$',   languageCode: 'en-FM', languageLabel: 'English',    flag: '🇫🇲', iso: 'FM', plug: 'C/F' },
  'Islas Marshall':            { currency: 'USD', symbol: '$',   languageCode: 'en-MH', languageLabel: 'English',    flag: '🇲🇭', iso: 'MH', plug: 'C/F' },
  'Islas Marianas del Norte':  { currency: 'USD', symbol: '$',   languageCode: 'en-MP', languageLabel: 'English',    flag: '🇲🇵', iso: 'MP' },
  'Guam':                      { currency: 'USD', symbol: '$',   languageCode: 'en-GU', languageLabel: 'English',    flag: '🇬🇺', iso: 'GU' },
  'Polinesia Francesa':        { currency: 'XPF', symbol: 'F',   languageCode: 'fr-PF', languageLabel: 'Français',   flag: '🇵🇫', iso: 'PF' },
  'Tahití':                    { currency: 'XPF', symbol: 'F',   languageCode: 'fr-PF', languageLabel: 'Français',   flag: '🇵🇫', iso: 'PF' },
  'Nueva Caledonia':           { currency: 'XPF', symbol: 'F',   languageCode: 'fr-NC', languageLabel: 'Français',   flag: '🇳🇨', iso: 'NC' },
  'Wallis y Futuna':           { currency: 'XPF', symbol: 'F',   languageCode: 'fr-WF', languageLabel: 'Français',   flag: '🇼🇫', iso: 'WF' },
  'Islas Cook':                { currency: 'NZD', symbol: '$',   languageCode: 'en-CK', languageLabel: 'English',    flag: '🇨🇰', iso: 'CK' },
  'Niue':                      { currency: 'NZD', symbol: '$',   languageCode: 'en-NU', languageLabel: 'English',    flag: '🇳🇺', iso: 'NU' },
  'Tokelau':                   { currency: 'NZD', symbol: '$',   languageCode: 'en-TK', languageLabel: 'English',    flag: '🇹🇰', iso: 'TK' },
  'Isla de Navidad':           { currency: 'AUD', symbol: '$',   languageCode: 'en-CX', languageLabel: 'English',    flag: '🇨🇽', iso: 'CX' },
  'Islas Cocos':               { currency: 'AUD', symbol: '$',   languageCode: 'en-CC', languageLabel: 'English',    flag: '🇨🇨', iso: 'CC' },
  'Islas Norfolk':             { currency: 'AUD', symbol: '$',   languageCode: 'en-NF', languageLabel: 'English',    flag: '🇳🇫', iso: 'NF' },
  'Islas Pitcairn':            { currency: 'NZD', symbol: '$',   languageCode: 'en-PN', languageLabel: 'English',    flag: '🇵🇳', iso: 'PN' },
  'Hawái':                     { currency: 'USD', symbol: '$',   languageCode: 'en-US', languageLabel: 'English',    flag: '🇺🇸', iso: 'US' },

  // ── África completa ────────────────────────────────────────────────────────
  'Cabo Verde':                { currency: 'CVE', symbol: '$',   languageCode: 'pt-CV', languageLabel: 'Português',  flag: '🇨🇻', iso: 'CV', plug: 'C/F' },
  'Santo Tomé y Príncipe':     { currency: 'STN', symbol: 'Db',  languageCode: 'pt-ST', languageLabel: 'Português',  flag: '🇸🇹', iso: 'ST', plug: 'C/F' },
  'Guinea-Bisáu':              { currency: 'XOF', symbol: 'CFA', languageCode: 'pt-GW', languageLabel: 'Português',  flag: '🇬🇼', iso: 'GW', plug: 'C/F' },
  'Guinea':                    { currency: 'GNF', symbol: 'Fr',  languageCode: 'fr-GN', languageLabel: 'Français',   flag: '🇬🇳', iso: 'GN', plug: 'C/F' },
  'Guinea Ecuatorial':         { currency: 'XAF', symbol: 'CFA', languageCode: 'es-GQ', languageLabel: 'Español',    flag: '🇬🇶', iso: 'GQ', plug: 'C/F' },
  'Gambia':                    { currency: 'GMD', symbol: 'D',   languageCode: 'en-GM', languageLabel: 'English',    flag: '🇬🇲', iso: 'GM', plug: 'C/F' },
  'Sierra Leona':              { currency: 'SLL', symbol: 'Le',  languageCode: 'en-SL', languageLabel: 'English',    flag: '🇸🇱', iso: 'SL', plug: 'C/F' },
  'Liberia':                   { currency: 'LRD', symbol: '$',   languageCode: 'en-LR', languageLabel: 'English',    flag: '🇱🇷', iso: 'LR', plug: 'C/F' },
  'Costa de Marfil':           { currency: 'XOF', symbol: 'CFA', languageCode: 'fr-CI', languageLabel: 'Français',   flag: '🇨🇮', iso: 'CI' },
  'Burkina Faso':              { currency: 'XOF', symbol: 'CFA', languageCode: 'fr-BF', languageLabel: 'Français',   flag: '🇧🇫', iso: 'BF', plug: 'C/F' },
  'Malí':                      { currency: 'XOF', symbol: 'CFA', languageCode: 'fr-ML', languageLabel: 'Français',   flag: '🇲🇱', iso: 'ML' },
  'Mauritania':                { currency: 'MRU', symbol: 'UM',  languageCode: 'ar-MR', languageLabel: 'Arabic',     flag: '🇲🇷', iso: 'MR', plug: 'C/F' },
  'Níger':                     { currency: 'XOF', symbol: 'CFA', languageCode: 'fr-NE', languageLabel: 'Français',   flag: '🇳🇪', iso: 'NE', plug: 'C/F' },
  'Chad':                      { currency: 'XAF', symbol: 'CFA', languageCode: 'fr-TD', languageLabel: 'Français',   flag: '🇹🇩', iso: 'TD', plug: 'C/F' },
  'República Centroafricana':  { currency: 'XAF', symbol: 'CFA', languageCode: 'fr-CF', languageLabel: 'Français',   flag: '🇨🇫', iso: 'CF' },
  'República del Congo':       { currency: 'XAF', symbol: 'CFA', languageCode: 'fr-CG', languageLabel: 'Français',   flag: '🇨🇬', iso: 'CG' },
  'República Democrática del Congo': { currency: 'CDF', symbol: 'FC', languageCode: 'fr-CD', languageLabel: 'Français', flag: '🇨🇩', iso: 'CD' },
  'Congo':                     { currency: 'XAF', symbol: 'CFA', languageCode: 'fr-CG', languageLabel: 'Français',   flag: '🇨🇬', iso: 'CG', plug: 'C/F' },
  'Gabón':                     { currency: 'XAF', symbol: 'CFA', languageCode: 'fr-GA', languageLabel: 'Français',   flag: '🇬🇦', iso: 'GA', plug: 'C/F' },
  'Togo':                      { currency: 'XOF', symbol: 'CFA', languageCode: 'fr-TG', languageLabel: 'Français',   flag: '🇹🇬', iso: 'TG', plug: 'C/F' },
  'Benín':                     { currency: 'XOF', symbol: 'CFA', languageCode: 'fr-BJ', languageLabel: 'Français',   flag: '🇧🇯', iso: 'BJ', plug: 'C/F' },
  'Eritrea':                   { currency: 'ERN', symbol: 'Nfk', languageCode: 'ti-ER', languageLabel: 'Tigrinya',   flag: '🇪🇷', iso: 'ER', plug: 'C/F' },
  'Yibuti':                    { currency: 'DJF', symbol: 'Fdj', languageCode: 'fr-DJ', languageLabel: 'Français',   flag: '🇩🇯', iso: 'DJ', plug: 'C/F' },
  'Somalia':                   { currency: 'SOS', symbol: 'Sh',  languageCode: 'so-SO', languageLabel: 'Somali',     flag: '🇸🇴', iso: 'SO', plug: 'C/F' },
  'Sudán del Sur':             { currency: 'SSP', symbol: '£',   languageCode: 'en-SS', languageLabel: 'English',    flag: '🇸🇸', iso: 'SS', plug: 'C/F' },
  'Burundi':                   { currency: 'BIF', symbol: 'Fr',  languageCode: 'fr-BI', languageLabel: 'Français',   flag: '🇧🇮', iso: 'BI', plug: 'C/F' },
  'Malaui':                    { currency: 'MWK', symbol: 'MK',  languageCode: 'en-MW', languageLabel: 'English',    flag: '🇲🇼', iso: 'MW', plug: 'C/F' },
  'Lesoto':                    { currency: 'LSL', symbol: 'L',   languageCode: 'st-LS', languageLabel: 'Sesotho',    flag: '🇱🇸', iso: 'LS', plug: 'C/F' },
  'Suazilandia':               { currency: 'SZL', symbol: 'L',   languageCode: 'ss-SZ', languageLabel: 'Swati',      flag: '🇸🇿', iso: 'SZ' },
  'Esuatini':                  { currency: 'SZL', symbol: 'L',   languageCode: 'ss-SZ', languageLabel: 'Swati',      flag: '🇸🇿', iso: 'SZ', plug: 'C/F' },
  'Comoras':                   { currency: 'KMF', symbol: 'Fr',  languageCode: 'ar-KM', languageLabel: 'Arabic',     flag: '🇰🇲', iso: 'KM', plug: 'C/F' },
  'Seychelles':                { currency: 'SCR', symbol: '₨',   languageCode: 'fr-SC', languageLabel: 'Français',   flag: '🇸🇨', iso: 'SC', plug: 'C/F' },
  'Mauricio':                  { currency: 'MUR', symbol: '₨',   languageCode: 'en-MU', languageLabel: 'English',    flag: '🇲🇺', iso: 'MU', plug: 'C/F' },
  'Reunión':                   { currency: 'EUR', symbol: '€',   languageCode: 'fr-RE', languageLabel: 'Français',   flag: '🇷🇪', iso: 'RE' },
  'Mayotte':                   { currency: 'EUR', symbol: '€',   languageCode: 'fr-YT', languageLabel: 'Français',   flag: '🇾🇹', iso: 'YT' },
  'Isla de Santa Elena':       { currency: 'SHP', symbol: '£',   languageCode: 'en-SH', languageLabel: 'English',    flag: '🇸🇭', iso: 'SH' },
  'Sahara Occidental':         { currency: 'MAD', symbol: 'DH',  languageCode: 'ar-EH', languageLabel: 'Arabic',     flag: '🇪🇭', iso: 'EH' },

  // ── Asia completa + territorios ────────────────────────────────────────────
  'Hong Kong':                 { currency: 'HKD', symbol: '$',   languageCode: 'zh-HK', languageLabel: 'Cantonese',  flag: '🇭🇰', iso: 'HK' },
  'Macao':                     { currency: 'MOP', symbol: 'P',   languageCode: 'zh-MO', languageLabel: 'Cantonese',  flag: '🇲🇴', iso: 'MO' },
  'Corea del Norte':           { currency: 'KPW', symbol: '₩',   languageCode: 'ko-KP', languageLabel: 'Korean',     flag: '🇰🇵', iso: 'KP', plug: 'C/F' },
  'Afganistán':                { currency: 'AFN', symbol: '؋',   languageCode: 'ps-AF', languageLabel: 'Pashto',     flag: '🇦🇫', iso: 'AF', plug: 'C/F' },
  'Tayikistán':                { currency: 'TJS', symbol: 'SM',  languageCode: 'tg-TJ', languageLabel: 'Tajik',      flag: '🇹🇯', iso: 'TJ', plug: 'C/F' },
  'Turkmenistán':              { currency: 'TMT', symbol: 'T',   languageCode: 'tk-TM', languageLabel: 'Turkmen',    flag: '🇹🇲', iso: 'TM', plug: 'C/F' },
  'Yemén':                     { currency: 'YER', symbol: '﷼',   languageCode: 'ar-YE', languageLabel: 'Arabic',     flag: '🇾🇪', iso: 'YE' },
  'Siria':                     { currency: 'SYP', symbol: '£',   languageCode: 'ar-SY', languageLabel: 'Arabic',     flag: '🇸🇾', iso: 'SY', plug: 'C/F' },
  'Irak':                      { currency: 'IQD', symbol: 'ع.د', languageCode: 'ar-IQ', languageLabel: 'Arabic',     flag: '🇮🇶', iso: 'IQ', plug: 'C/F' },
  'Palestina':                 { currency: 'ILS', symbol: '₪',   languageCode: 'ar-PS', languageLabel: 'Arabic',     flag: '🇵🇸', iso: 'PS' },
  'Chipre del Norte':          { currency: 'TRY', symbol: '₺',   languageCode: 'tr-CY', languageLabel: 'Türkçe',     flag: '🇨🇾', iso: 'CY' },
  'Isla de Man':               { currency: 'GBP', symbol: '£',   languageCode: 'en-IM', languageLabel: 'English',    flag: '🇮🇲', iso: 'IM' },
  'Islas del Canal':           { currency: 'GBP', symbol: '£',   languageCode: 'en-GG', languageLabel: 'English',    flag: '🇬🇬', iso: 'GG' },
  'Guernsey':                  { currency: 'GBP', symbol: '£',   languageCode: 'en-GG', languageLabel: 'English',    flag: '🇬🇬', iso: 'GG' },
  'Jersey':                    { currency: 'GBP', symbol: '£',   languageCode: 'en-JE', languageLabel: 'English',    flag: '🇯🇪', iso: 'JE' },
  'Gibraltar':                 { currency: 'GIP', symbol: '£',   languageCode: 'es-GI', languageLabel: 'Español',    flag: '🇬🇮', iso: 'GI' },
  'Liechtenstein':             { currency: 'CHF', symbol: 'Fr',  languageCode: 'de-LI', languageLabel: 'Deutsch',    flag: '🇱🇮', iso: 'LI', plug: 'C/F' },
  'San Marino':                { currency: 'EUR', symbol: '€',   languageCode: 'it-SM', languageLabel: 'Italiano',   flag: '🇸🇲', iso: 'SM', plug: 'C/F' },
  'Ciudad del Vaticano':       { currency: 'EUR', symbol: '€',   languageCode: 'it-VA', languageLabel: 'Italiano',   flag: '🇻🇦', iso: 'VA' },
  'Escocia':                   { currency: 'GBP', symbol: '£',   languageCode: 'en-GB', languageLabel: 'English',    flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', iso: 'GB' },
  'Gales':                     { currency: 'GBP', symbol: '£',   languageCode: 'cy-GB', languageLabel: 'Welsh',      flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', iso: 'GB' },
  'Irlanda del Norte':         { currency: 'GBP', symbol: '£',   languageCode: 'en-GB', languageLabel: 'English',    flag: '🇬🇧', iso: 'GB' },
  'Islas Feroe':               { currency: 'DKK', symbol: 'kr',  languageCode: 'fo-FO', languageLabel: 'Faroese',    flag: '🇫🇴', iso: 'FO' },
  'Groenlandia':               { currency: 'DKK', symbol: 'kr',  languageCode: 'kl-GL', languageLabel: 'Kalaallisut',flag: '🇬🇱', iso: 'GL' },
  'Svalbard':                  { currency: 'NOK', symbol: 'kr',  languageCode: 'nb-NO', languageLabel: 'Norsk',      flag: '🇸🇯', iso: 'SJ' },
  'Åland':                     { currency: 'EUR', symbol: '€',   languageCode: 'sv-AX', languageLabel: 'Svenska',    flag: '🇦🇽', iso: 'AX' },
  'Macedonia':                 { currency: 'MKD', symbol: 'ден', languageCode: 'mk-MK', languageLabel: 'Macedonski', flag: '🇲🇰', iso: 'MK' },

  // ── Américas completo ──────────────────────────────────────────────────────
  'Belice':                    { currency: 'BZD', symbol: '$',   languageCode: 'en-BZ', languageLabel: 'English',    flag: '🇧🇿', iso: 'BZ', plug: 'C/F' },
  'Islas Malvinas':            { currency: 'FKP', symbol: '£',   languageCode: 'en-FK', languageLabel: 'English',    flag: '🇫🇰', iso: 'FK' },
  'Islas Georgias del Sur':    { currency: 'SHP', symbol: '£',   languageCode: 'en-GS', languageLabel: 'English',    flag: '🇬🇸', iso: 'GS' },
  'Territorios Antárticos':    { currency: 'GBP', symbol: '£',   languageCode: 'en-AQ', languageLabel: 'English',    flag: '🇦🇶', iso: 'AQ' },
  'Alaska':                    { currency: 'USD', symbol: '$',   languageCode: 'en-US', languageLabel: 'English',    flag: '🇺🇸', iso: 'US' },
  'Islas Vírgenes de EE.UU':  { currency: 'USD', symbol: '$',   languageCode: 'en-VI', languageLabel: 'English',    flag: '🇻🇮', iso: 'VI' },
  'Isla Reunión':              { currency: 'EUR', symbol: '€',   languageCode: 'fr-RE', languageLabel: 'Français',   flag: '🇷🇪', iso: 'RE' },

  // ── Oriente Medio completo ─────────────────────────────────────────────────
  'Uzbekistán':                { currency: 'UZS', symbol: 'soʻm',languageCode: 'uz-UZ', languageLabel: 'Uzbek',      flag: '🇺🇿', iso: 'UZ', plug: 'C/F' },
  'Kazajistán':                { currency: 'KZT', symbol: '₸',   languageCode: 'kk-KZ', languageLabel: 'Kazakh',     flag: '🇰🇿', iso: 'KZ', plug: 'C/F' },
  'Kirguistán':                { currency: 'KGS', symbol: 'som', languageCode: 'ky-KG', languageLabel: 'Kyrgyz',     flag: '🇰🇬', iso: 'KG', plug: 'C/F' },

  // ── Pacífico EEUU ──────────────────────────────────────────────────────────
  'Islas Marianas':            { currency: 'USD', symbol: '$',   languageCode: 'en-MP', languageLabel: 'English',    flag: '🇲🇵', iso: 'MP' },
  'Islas Wake':                { currency: 'USD', symbol: '$',   languageCode: 'en-UM', languageLabel: 'English',    flag: '🇺🇲', iso: 'UM' },
};

// Build reverse lookup: ISO code → meta
const ISO_TO_META = {};
for (const [label, meta] of Object.entries(KNOWN_META)) {
  if (meta.iso && !ISO_TO_META[meta.iso]) {
    ISO_TO_META[meta.iso] = { ...meta, label };
  }
}

const DEFAULT_META = { currency: 'USD', symbol: '$', languageCode: 'en-US', languageLabel: 'English', flag: '🌍', iso: null, plug: null };

// ─── COUNTRY LIST ─────────────────────────────────────────────────────────────
export function getCountries(locale = 'es-ES') {
  try {
    const regions = Intl.supportedValuesOf('region');
    const dn = new Intl.DisplayNames([locale], { type: 'region' });
    return regions
      .map((code) => ({ code, label: dn.of(code) }))
      .filter((c) => c.label && c.label !== c.code)
      .sort((a, b) => a.label.localeCompare(b.label, locale));
  } catch {
    return Object.keys(KNOWN_META).map((label) => ({ code: label, label }));
  }
}

export function normalizeText(str = '') {
  return str.toString().trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ─── COUNTRY META — supports both label (e.g. "Japón") and ISO code (e.g. "JP")
export function getCountryMeta(countryLabelOrCode) {
  if (!countryLabelOrCode) return { ...DEFAULT_META };

  // Try ISO code first (2-char uppercase)
  if (countryLabelOrCode.length === 2) {
    const byIso = ISO_TO_META[countryLabelOrCode.toUpperCase()];
    if (byIso) return { ...byIso };
  }

  // Exact label match (Spanish)
  const exact = KNOWN_META[countryLabelOrCode];
  if (exact) return { ...exact };

  // Try English → Spanish translation first (OSM returns English names)
  const esName = EN_TO_ES[countryLabelOrCode];
  if (esName && KNOWN_META[esName]) return { ...KNOWN_META[esName] };
  // Case-insensitive English match
  const lcInput = countryLabelOrCode.toLowerCase();
  const engKey = Object.keys(EN_TO_ES).find(k => k.toLowerCase() === lcInput);
  if (engKey && KNOWN_META[EN_TO_ES[engKey]]) return { ...KNOWN_META[EN_TO_ES[engKey]] };

  // Case-insensitive Spanish match
  const n = normalizeText(countryLabelOrCode);
  const ci = Object.keys(KNOWN_META).find((k) => normalizeText(k) === n);
  if (ci) return { ...KNOWN_META[ci] };

  // Partial
  const partial = Object.keys(KNOWN_META).find(
    (k) => normalizeText(k).includes(n) || n.includes(normalizeText(k))
  );
  if (partial) return { ...KNOWN_META[partial] };

  return { ...DEFAULT_META };
}

// Exhaustive English → Spanish map (OSM returns English country names)
const EN_TO_ES = {
  // Europe
  'Spain':'España','France':'Francia','Germany':'Alemania','Italy':'Italia',
  'Portugal':'Portugal','United Kingdom':'Reino Unido','Great Britain':'Reino Unido',
  'England':'Reino Unido','Scotland':'Reino Unido','Wales':'Reino Unido',
  'Netherlands':'Países Bajos','Holland':'Países Bajos','Belgium':'Bélgica',
  'Switzerland':'Suiza','Austria':'Austria','Sweden':'Suecia','Norway':'Noruega',
  'Denmark':'Dinamarca','Finland':'Finlandia','Greece':'Grecia','Croatia':'Croacia',
  'Czech Republic':'República Checa','Czechia':'República Checa','Poland':'Polonia',
  'Hungary':'Hungría','Romania':'Rumanía','Bulgaria':'Bulgaria','Slovakia':'Eslovaquia',
  'Slovenia':'Eslovenia','Serbia':'Serbia','Montenegro':'Montenegro',
  'Bosnia and Herzegovina':'Bosnia','Bosnia & Herzegovina':'Bosnia',
  'Albania':'Albania','North Macedonia':'Macedonia','Kosovo':'Kosovo',
  'Estonia':'Estonia','Latvia':'Letonia','Lithuania':'Lituania','Iceland':'Islandia',
  'Ireland':'Irlanda','Luxembourg':'Luxemburgo','Malta':'Malta','Cyprus':'Chipre',
  'Turkey':'Turquía','Russia':'Rusia','Ukraine':'Ucrania','Belarus':'Bielorrusia',
  'Moldova':'Moldova','Georgia':'Georgia','Armenia':'Armenia','Azerbaijan':'Azerbaiyán',
  'Kazakhstan':'Kazajistán','Uzbekistan':'Uzbekistán','Kyrgyzstan':'Kirguistán',
  'Tajikistan':'Tayikistán','Turkmenistan':'Turkmenistán',
  'Monaco':'Mónaco','Andorra':'Andorra','San Marino':'San Marino',
  'Liechtenstein':'Liechtenstein',
  // Americas
  'United States':'Estados Unidos','United States of America':'Estados Unidos',
  'USA':'Estados Unidos','US':'Estados Unidos',
  'Canada':'Canadá','Mexico':'México','Brazil':'Brasil','Argentina':'Argentina',
  'Colombia':'Colombia','Chile':'Chile','Peru':'Perú','Venezuela':'Venezuela',
  'Ecuador':'Ecuador','Bolivia':'Bolivia','Paraguay':'Paraguay','Uruguay':'Uruguay',
  'Cuba':'Cuba','Dominican Republic':'República Dominicana',
  'Costa Rica':'Costa Rica','Panama':'Panamá','Guatemala':'Guatemala',
  'Honduras':'Honduras','El Salvador':'El Salvador','Nicaragua':'Nicaragua',
  'Belize':'Belice','Jamaica':'Jamaica','Haiti':'Haití',
  'Trinidad and Tobago':'Trinidad y Tobago','Barbados':'Barbados',
  'Bahamas':'Bahamas','Puerto Rico':'Puerto Rico','Guyana':'Guyana',
  'Suriname':'Surinam',
  // Asia
  'Japan':'Japón','China':'China','South Korea':'Corea del Sur','Korea':'Corea del Sur',
  'North Korea':'Corea del Norte','Thailand':'Tailandia','Vietnam':'Vietnam',
  'Indonesia':'Indonesia','Philippines':'Filipinas','Malaysia':'Malasia',
  'Singapore':'Singapur','Myanmar':'Myanmar','Burma':'Myanmar','Cambodia':'Camboya',
  'Laos':'Laos','India':'India','Nepal':'Nepal','Pakistan':'Pakistán',
  'Bangladesh':'Bangladés','Sri Lanka':'Sri Lanka','Maldives':'Maldivas',
  'Afghanistan':'Afganistán','Iran':'Irán','Irak':'Irak','Iraq':'Irak',
  'Saudi Arabia':'Arabia Saudí','Saudi':'Arabia Saudí',
  'United Arab Emirates':'Emiratos Árabes','UAE':'Emiratos Árabes',
  'Qatar':'Qatar','Kuwait':'Kuwait','Bahrain':'Baréin','Oman':'Omán',
  'Yemen':'Yemen','Jordan':'Jordania','Lebanon':'Líbano','Syria':'Siria',
  'Israel':'Israel','Palestine':'Palestina','Taiwan':'Taiwán',
  'Hong Kong':'Hong Kong','Macau':'Macao','Mongolia':'Mongolia','Bhutan':'Bután',
  'Brunei':'Brunéi','Timor-Leste':'Timor Oriental',
  // Africa
  'Morocco':'Marruecos','Egypt':'Egipto','Tunisia':'Túnez','Algeria':'Argelia',
  'Libya':'Libia','South Africa':'Sudáfrica','Kenya':'Kenia','Tanzania':'Tanzania',
  'Ethiopia':'Etiopía','Nigeria':'Nigeria','Ghana':'Ghana','Senegal':'Senegal',
  "Ivory Coast":"Costa de Marfil","Côte d'Ivoire":"Costa de Marfil",
  'Cameroon':'Camerún','Rwanda':'Ruanda','Uganda':'Uganda',
  'Mozambique':'Mozambique','Zimbabwe':'Zimbabue','Zambia':'Zambia',
  'Botswana':'Botsuana','Namibia':'Namibia','Madagascar':'Madagascar',
  'Mauritius':'Mauricio','Seychelles':'Seychelles','Cape Verde':'Cabo Verde',
  'Sudan':'Sudán','South Sudan':'Sudán del Sur','Somalia':'Somalia',
  'Mali':'Malí','Niger':'Níger','Chad':'Chad',
  'Democratic Republic of the Congo':'República Democrática del Congo',
  'Republic of the Congo':'República del Congo','Congo':'Congo',
  'Angola':'Angola','Gabon':'Gabón','Equatorial Guinea':'Guinea Ecuatorial',
  'Gambia':'Gambia','The Gambia':'Gambia','Eswatini':'Suazilandia',
  'Swaziland':'Suazilandia',
  // Oceania
  'Australia':'Australia','New Zealand':'Nueva Zelanda','Fiji':'Fiyi',
  'Papua New Guinea':'Papúa Nueva Guinea','Samoa':'Samoa','Tonga':'Tonga',
  'Vanuatu':'Vanuatu',
};

// Nombres alternativos en español que NO son claves de KNOWN_META pero que
// pudieron guardarse desde listas anteriores de la app. Sin esto, un usuario con
// "Yemen" guardado no encontraría su país en el selector (que ahora ofrece
// "Yemén") y podría acabar sobreescribiéndolo por otro.
const ES_ALIASES = {
  'Bosnia y Herzegovina':   'Bosnia',
  'Botswana':               'Botsuana',
  'Emiratos Árabes Unidos': 'Emiratos Árabes',
  'Moldavia':               'Moldova',
  'República del Congo':    'Congo',
  'Saint-Martin':           'Saint Martin',
  'Yemen':                  'Yemén',
  'Suazilandia':            'Esuatini',
  'Macedonia':              'Macedonia del Norte',
  'Japan':                  'Japón',
  'Rwanda':                 'Ruanda',
  // Incoherencias del propio mapa: EN_TO_ES traduce 'Taiwan'→'Taiwán', pero la
  // clave real de KNOWN_META es 'Taiwan' sin tilde. Y las listas antiguas usaban
  // 'Malawi' mientras KNOWN_META tiene 'Malaui'.
  'Taiwán':                 'Taiwan',
  'Malawi':                 'Malaui',
};

export function normalizeCountry(input) {
  if (!input) return '';
  const trimmed = input.trim();
  // 0. Alias en español de listas antiguas ("Yemen" → "Yemén")
  if (ES_ALIASES[trimmed]) return ES_ALIASES[trimmed];
  const lcTrim = trimmed.toLowerCase();
  const aliasKey = Object.keys(ES_ALIASES).find(k => k.toLowerCase() === lcTrim);
  if (aliasKey) return ES_ALIASES[aliasKey];
  let out = trimmed;
  // 1. Direct English match
  if (EN_TO_ES[trimmed]) out = EN_TO_ES[trimmed];
  else {
    // 2. Case-insensitive English match
    const lc = trimmed.toLowerCase();
    const engMatch = Object.keys(EN_TO_ES).find(k => k.toLowerCase() === lc);
    if (engMatch) out = EN_TO_ES[engMatch];
    else {
      // 3. Direct Spanish match (already correct)
      const n = normalizeText(trimmed);
      const found = Object.keys(KNOWN_META).find((k) => normalizeText(k) === n);
      if (found) out = found;
    }
  }
  // 4. El resultado también pasa por los alias: EN_TO_ES puede devolver un
  //    nombre que no es clave de KNOWN_META (p. ej. 'Taiwan' → 'Taiwán').
  return ES_ALIASES[out] || out;
}

// ─── TOP CITIES ───────────────────────────────────────────────────────────────
const LS_CITIES_PREFIX = 'topCities_v2_';

export async function getTopCities(countryLabel) {
  if (!countryLabel) return [];
  const lsKey = LS_CITIES_PREFIX + normalizeText(countryLabel);

  try {
    const ls = localStorage.getItem(lsKey);
    if (ls) {
      const parsed = JSON.parse(ls);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}

  try {
    const rows = await base44.entities.CountryInfo.filter({ country_label: countryLabel });
    if (rows.length > 0 && rows[0].top_cities?.length > 0) {
      const cities = rows[0].top_cities;
      localStorage.setItem(lsKey, JSON.stringify(cities));
      return cities;
    }
  } catch {}

  return [];
}

// ─── EMERGENCY INFO ────────────────────────────────────────────────────────────
const LS_EMERGENCY_PREFIX = 'emergency_v2_';

export async function getEmergencyInfo(countryLabel, homeCountry = 'España') {
  if (!countryLabel) return null;
  const lsKey = LS_EMERGENCY_PREFIX + normalizeText(countryLabel) + '_' + normalizeText(homeCountry);

  try {
    const ls = localStorage.getItem(lsKey);
    if (ls) return JSON.parse(ls);
  } catch {}

  try {
    const rows = await base44.entities.CountryInfo.filter({ country_label: countryLabel });
    if (rows.length > 0 && rows[0].emergency_info) {
      localStorage.setItem(lsKey, JSON.stringify(rows[0].emergency_info));
      return rows[0].emergency_info;
    }
  } catch {}

  return null;
}

// ─── EXCHANGE RATE (simple, for display converters) ────────────────────────────
const LS_RATE_PREFIX = 'rate_EUR_';

export async function getExchangeRate(toCurrency) {
  if (!toCurrency || toCurrency === 'EUR') return 1;
  const lsKey = LS_RATE_PREFIX + toCurrency;
  try {
    const ls = sessionStorage.getItem(lsKey);
    if (ls) return parseFloat(ls);
  } catch {}

  // Try Frankfurter first
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=EUR&to=${toCurrency}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      const rate = data?.rates?.[toCurrency];
      if (rate) {
        sessionStorage.setItem(lsKey, String(rate));
        return rate;
      }
    }
  } catch {}

  return 1;
}

// ─── AVAILABLE CURRENCIES for a trip ─────────────────────────────────────────
export function computeAvailableCurrencies(cities = [], baseCurrency = 'EUR') {
  const set = new Set([baseCurrency]);
  for (const city of cities) {
    const key = city.country_code || city.country || '';
    if (key) {
      const meta = getCountryMeta(key);
      if (meta.currency) set.add(meta.currency);
    }
  }
  return Array.from(set);
}

// ─── I18N DE PAÍSES ───────────────────────────────────────────────────────────
// El nombre en español es el ID canónico: es la clave de KNOWN_META y lo que se
// guarda en la BD (trip.country, city.country, profile.home_country). Estas
// funciones NO cambian ese canónico: solo traducen lo que se MUESTRA y amplían
// lo que se puede BUSCAR. Así un usuario en EN ve "Spain" y encuentra el país
// escribiendo "Spain", "España" o "ES", pero se sigue guardando "España".

// Subdivisiones y territorios que comparten ISO con su país padre. Intl los
// traduciría al nombre del padre ("Escocia" → "United Kingdom"), que es
// incorrecto: aquí son destinos por derecho propio y llevan nombre explícito.
const LABEL_EN_OVERRIDE = {
  'Escocia': 'Scotland',
  'Gales': 'Wales',
  'Irlanda del Norte': 'Northern Ireland',
  'Alaska': 'Alaska',
  'Hawái': 'Hawaii',
  'Tahití': 'Tahiti',
  'Chipre del Norte': 'Northern Cyprus',
  'Bonaire': 'Bonaire',
  'Saba': 'Saba',
  'Sint Eustatius': 'Sint Eustatius',
  'Islas del Canal': 'Channel Islands',
  'Guernsey': 'Guernsey',
};

// Variantes ortográficas o nombres antiguos que duplican a otro canónico. Se
// siguen resolviendo (por si ya están guardados en la BD) pero no se ofrecen en
// los selectores, para no mostrar la misma opción dos veces.
const REDUNDANT_ALIASES = new Set([
  'Japan',                    // → Japón
  'Rwanda',                   // → Ruanda
  'Suazilandia',              // → Esuatini (nombre oficial desde 2018)
  'Macedonia',                // → Macedonia del Norte
  'Saint Kitts',              // → San Cristóbal y Nieves
  'Saint-Martin',             // → Saint Martin
  'República del Congo',      // → Congo
  'Isla Reunión',             // → Reunión
  'Islas Marianas',           // → Islas Marianas del Norte
  'Islas Vírgenes de EE.UU',  // → Islas Vírgenes EEUU
]);

// ES normalizado → ISO. Se deriva de KNOWN_META y se completa con Intl, así no
// hay que mantener una tabla a mano.
let _esToIso = null;
function esToIso() {
  if (_esToIso) return _esToIso;
  const map = {};
  try {
    const dn = new Intl.DisplayNames(['es'], { type: 'region' });
    for (const code of Intl.supportedValuesOf('region')) {
      const label = dn.of(code);
      if (label && label !== code) map[normalizeText(label)] = code;
    }
  } catch { /* navegador sin Intl.DisplayNames: se usa solo KNOWN_META */ }
  // KNOWN_META manda: sus ISO están curados a mano.
  for (const [label, meta] of Object.entries(KNOWN_META)) {
    if (meta.iso) map[normalizeText(label)] = meta.iso;
  }
  _esToIso = map;
  return map;
}

/** ISO-3166 alpha-2 de un país canónico en español. null si no se conoce. */
// José (23 sep 2026): nombre canónico (nuestro, en español) de un país a
// partir de su código ISO -- para no guardar el texto de país de Google.
export function countryNameFromIso(iso) {
  if (!iso || iso.length !== 2) return '';
  const up = iso.toUpperCase();
  return Object.keys(KNOWN_META).find(k => KNOWN_META[k]?.iso === up) || '';
}

export function getCountryIso(canonicalEs) {
  if (!canonicalEs) return null;
  return KNOWN_META[canonicalEs]?.iso || esToIso()[normalizeText(canonicalEs)] || null;
}

const _labelCache = {};
/** Nombre del país en el idioma pedido. Cae al canónico español si no se puede. */
export function getCountryLabel(canonicalEs, lang = 'es') {
  if (!canonicalEs) return '';
  const base = (lang || 'es').split('-')[0];
  if (base === 'es') return canonicalEs;
  const ck = base + '|' + canonicalEs;
  if (_labelCache[ck]) return _labelCache[ck];
  // Subdivisión con nombre propio: no derivar del ISO del país padre.
  if (base === 'en' && LABEL_EN_OVERRIDE[canonicalEs]) {
    _labelCache[ck] = LABEL_EN_OVERRIDE[canonicalEs];
    return _labelCache[ck];
  }
  if (LABEL_EN_OVERRIDE[canonicalEs]) return canonicalEs;
  const iso = getCountryIso(canonicalEs);
  if (!iso) return canonicalEs;
  try {
    const label = new Intl.DisplayNames([base], { type: 'region' }).of(iso);
    const out = (label && label !== iso) ? label : canonicalEs;
    _labelCache[ck] = out;
    return out;
  } catch {
    return canonicalEs;
  }
}

// ES canónico → lista de alias buscables (español, inglés, idioma activo, ISO).
let _aliasIndex = null;
function aliasIndex() {
  if (_aliasIndex) return _aliasIndex;
  const idx = {};
  const push = (es, alias) => {
    if (!alias) return;
    const n = normalizeText(alias);
    if (!n) return;
    (idx[es] = idx[es] || new Set()).add(n);
  };
  for (const es of Object.keys(KNOWN_META)) push(es, es);
  // Inglés: EN_TO_ES ya cubre variantes ("Great Britain", "Holland"...)
  for (const [en, es] of Object.entries(EN_TO_ES)) push(es, en);
  // Nombres antiguos en español ("Yemen" → Yemén) para que sigan encontrándose
  for (const [alias, es] of Object.entries(ES_ALIASES)) push(es, alias);
  // ISO
  for (const es of Object.keys(idx)) {
    const iso = getCountryIso(es);
    if (iso) push(es, iso);
  }
  _aliasIndex = idx;
  return idx;
}

/**
 * Busca países. Devuelve [{ value, label }] donde value es SIEMPRE el canónico
 * español (lo que se guarda) y label el nombre en el idioma activo (lo que se ve).
 * Encuentra escribiendo en español, en inglés, en el idioma activo o por ISO.
 */
export function searchCountries(query, lang = 'es', limit = 8) {
  const list = getCountryOptions(lang);
  const q = normalizeText(query || '');
  if (!q) return list.slice(0, limit);
  const idx = aliasIndex();
  const exact = [];
  const exactSub = [];   // subdivisiones: comparten ISO con su país padre
  const starts = [];
  const contains = [];
  for (const opt of list) {
    const aliases = new Set(idx[opt.value] || []);
    aliases.add(normalizeText(opt.label));
    let hit = 0;
    for (const a of aliases) {
      if (a === q) { hit = 3; break; }        // exacto (incluye ISO: "ES" → España)
      if (a.startsWith(q)) { hit = Math.max(hit, 2); }
      else if (a.includes(q)) { hit = Math.max(hit, 1); }
    }
    if (hit === 3) (LABEL_EN_OVERRIDE[opt.value] ? exactSub : exact).push(opt);
    else if (hit === 2) starts.push(opt);
    else if (hit === 1) contains.push(opt);
  }
  return [...exact, ...exactSub, ...starts, ...contains].slice(0, limit);
}

let _optionsCache = {};
/**
 * Lista completa de países como [{ value, label }], ordenada alfabéticamente en
 * el idioma pedido. value = canónico español; label = nombre traducido.
 * Excluye variantes redundantes (siguen resolviendo, pero no se ofrecen).
 * Úsala para DESTINOS: incluye subdivisiones como Escocia o Tahití, que son
 * destinos de viaje legítimos.
 */
export function getCountryOptions(lang = 'es') {
  const base = (lang || 'es').split('-')[0];
  if (_optionsCache[base]) return _optionsCache[base];
  const out = Object.keys(KNOWN_META)
    .filter(es => !REDUNDANT_ALIASES.has(es))
    .map(es => ({ value: es, label: getCountryLabel(es, base) }))
    .sort((a, b) => a.label.localeCompare(b.label, base));
  _optionsCache[base] = out;
  return out;
}

let _originCache = {};
/**
 * Lista de países para PAÍS DE ORIGEN / NACIONALIDAD. Igual que
 * getCountryOptions() pero sin subdivisiones (Escocia, Alaska, Hawái...).
 *
 * Motivo: home_country alimenta los textos y la búsqueda de embajada
 * ("Embajada de {origen} en {destino}"), y la BD de embajadas resuelve por
 * nombre de país soberano. Con "Alaska" saldría "Embajada de Alaska en Japón",
 * que no existe. Como destino sí tienen sentido, por eso solo se filtran aquí.
 */
export function getOriginCountryOptions(lang = 'es') {
  const base = (lang || 'es').split('-')[0];
  if (_originCache[base]) return _originCache[base];
  const out = getCountryOptions(base).filter(o => !LABEL_EN_OVERRIDE[o.value]);
  _originCache[base] = out;
  return out;
}

/** Nombre de idioma (languageLabel de KNOWN_META) traducido al idioma activo. */
export function getLanguageLabel(languageCode, lang = 'es') {
  if (!languageCode) return '';
  const base = (lang || 'es').split('-')[0];
  const code = languageCode.split('-')[0];
  try {
    const label = new Intl.DisplayNames([base], { type: 'language' }).of(code);
    if (label && label !== code) return label.charAt(0).toUpperCase() + label.slice(1);
  } catch { /* sin Intl: se devuelve el código */ }
  return languageCode;
}