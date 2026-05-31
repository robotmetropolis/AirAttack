// Mapeo de nombres de países (formato OpenSky) a códigos ISO-3166 alpha-2.
// Los emojis de bandera de Unicode se forman tomando el ISO-2 y mapeando cada
// letra al "Regional Indicator Symbol" correspondiente (codepoint 0x1F1E6 + offset).

const COUNTRY_TO_ISO2 = {
  // ─── América ─────────────────────────────────────────────────────────────
  Argentina: "AR",
  Brazil: "BR",
  Chile: "CL",
  Uruguay: "UY",
  Paraguay: "PY",
  Bolivia: "BO",
  Peru: "PE",
  Ecuador: "EC",
  Colombia: "CO",
  Venezuela: "VE",
  Guyana: "GY",
  Suriname: "SR",
  "French Guiana": "GF",
  Mexico: "MX",
  "United States": "US",
  Canada: "CA",
  Cuba: "CU",
  "Dominican Republic": "DO",
  Haiti: "HT",
  Jamaica: "JM",
  Bahamas: "BS",
  Panama: "PA",
  "Costa Rica": "CR",
  Honduras: "HN",
  Guatemala: "GT",
  "El Salvador": "SV",
  Nicaragua: "NI",
  Belize: "BZ",
  "Trinidad and Tobago": "TT",
  Barbados: "BB",
  "Cayman Islands": "KY",
  "Puerto Rico": "PR",

  // ─── Europa ──────────────────────────────────────────────────────────────
  Germany: "DE",
  France: "FR",
  Spain: "ES",
  Italy: "IT",
  "United Kingdom": "GB",
  Ireland: "IE",
  Portugal: "PT",
  Netherlands: "NL",
  Belgium: "BE",
  Luxembourg: "LU",
  Switzerland: "CH",
  Austria: "AT",
  Greece: "GR",
  Turkey: "TR",
  Cyprus: "CY",
  Malta: "MT",
  Norway: "NO",
  Sweden: "SE",
  Finland: "FI",
  Denmark: "DK",
  Iceland: "IS",
  Poland: "PL",
  "Czech Republic": "CZ",
  Czechia: "CZ",
  Slovakia: "SK",
  Hungary: "HU",
  Romania: "RO",
  Bulgaria: "BG",
  Croatia: "HR",
  Serbia: "RS",
  Slovenia: "SI",
  "Bosnia and Herzegovina": "BA",
  Montenegro: "ME",
  "North Macedonia": "MK",
  Albania: "AL",
  Estonia: "EE",
  Latvia: "LV",
  Lithuania: "LT",
  Ukraine: "UA",
  Belarus: "BY",
  Moldova: "MD",
  Russia: "RU",
  "Russian Federation": "RU",
  Kazakhstan: "KZ",
  Kosovo: "XK",

  // ─── Asia ────────────────────────────────────────────────────────────────
  China: "CN",
  Japan: "JP",
  "South Korea": "KR",
  "Korea (Republic of)": "KR",
  "Korea, Republic of": "KR",
  "North Korea": "KP",
  Taiwan: "TW",
  "Hong Kong": "HK",
  Macao: "MO",
  Mongolia: "MN",
  India: "IN",
  Pakistan: "PK",
  Bangladesh: "BD",
  "Sri Lanka": "LK",
  Nepal: "NP",
  Bhutan: "BT",
  Maldives: "MV",
  Myanmar: "MM",
  Thailand: "TH",
  Vietnam: "VN",
  Cambodia: "KH",
  Laos: "LA",
  Malaysia: "MY",
  Singapore: "SG",
  Indonesia: "ID",
  Philippines: "PH",
  "Brunei Darussalam": "BN",
  "Timor-Leste": "TL",
  Iran: "IR",
  "Iran, Islamic Republic of": "IR",
  Iraq: "IQ",
  "Saudi Arabia": "SA",
  "United Arab Emirates": "AE",
  Qatar: "QA",
  Kuwait: "KW",
  Bahrain: "BH",
  Oman: "OM",
  Yemen: "YE",
  Jordan: "JO",
  Lebanon: "LB",
  Syria: "SY",
  Israel: "IL",
  Palestine: "PS",
  Afghanistan: "AF",
  Uzbekistan: "UZ",
  Turkmenistan: "TM",
  Kyrgyzstan: "KG",
  Tajikistan: "TJ",
  Azerbaijan: "AZ",
  Armenia: "AM",
  Georgia: "GE",

  // ─── África ──────────────────────────────────────────────────────────────
  Morocco: "MA",
  Algeria: "DZ",
  Tunisia: "TN",
  Libya: "LY",
  Egypt: "EG",
  Sudan: "SD",
  "South Sudan": "SS",
  Ethiopia: "ET",
  Eritrea: "ER",
  Somalia: "SO",
  Kenya: "KE",
  Uganda: "UG",
  Rwanda: "RW",
  Burundi: "BI",
  Tanzania: "TZ",
  "United Republic of Tanzania": "TZ",
  Mozambique: "MZ",
  Zambia: "ZM",
  Zimbabwe: "ZW",
  Malawi: "MW",
  Madagascar: "MG",
  Mauritius: "MU",
  "South Africa": "ZA",
  Namibia: "NA",
  Botswana: "BW",
  Angola: "AO",
  "Democratic Republic of the Congo": "CD",
  "Republic of the Congo": "CG",
  Congo: "CG",
  Cameroon: "CM",
  Nigeria: "NG",
  Benin: "BJ",
  Togo: "TG",
  Ghana: "GH",
  "Ivory Coast": "CI",
  "Cote d'Ivoire": "CI",
  Liberia: "LR",
  "Sierra Leone": "SL",
  Guinea: "GN",
  "Guinea-Bissau": "GW",
  Senegal: "SN",
  Gambia: "GM",
  Mauritania: "MR",
  Mali: "ML",
  "Burkina Faso": "BF",
  Niger: "NE",
  Chad: "TD",
  "Central African Republic": "CF",
  Gabon: "GA",
  "Cape Verde": "CV",
  "Equatorial Guinea": "GQ",
  "Sao Tome and Principe": "ST",

  // ─── Oceanía ─────────────────────────────────────────────────────────────
  Australia: "AU",
  "New Zealand": "NZ",
  Fiji: "FJ",
  "Papua New Guinea": "PG",
  "Solomon Islands": "SB",
  Vanuatu: "VU",
  Samoa: "WS",
  Tonga: "TO",
};

/**
 * Convierte un código ISO-2 (ej "AR") al emoji de bandera correspondiente.
 * Los emojis de bandera son una secuencia de 2 "Regional Indicator Symbols".
 */
function iso2ToEmoji(iso2) {
  if (!iso2 || iso2.length !== 2) return "🏳️";
  const codePoints = iso2
    .toUpperCase()
    .split("")
    .map((c) => 0x1f1e6 + c.charCodeAt(0) - 65);
  return String.fromCodePoint(...codePoints);
}

/**
 * Bandera emoji a partir del nombre de país (formato OpenSky).
 * Si el país no está en el mapeo, devuelve 🏳️.
 */
export function flagFor(countryName) {
  if (!countryName) return "🏳️";
  const iso2 = COUNTRY_TO_ISO2[countryName.trim()];
  if (!iso2) return "🏳️";
  return iso2ToEmoji(iso2);
}

/**
 * Devuelve el código ISO-2 o "??" si desconocido.
 */
export function iso2For(countryName) {
  return COUNTRY_TO_ISO2[countryName?.trim() || ""] || "??";
}
