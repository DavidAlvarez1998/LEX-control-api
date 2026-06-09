// Cálculo de días hábiles colombianos para vencimientos legales (p. ej. los
// términos del derecho de petición: 15/10/30 días hábiles, Ley 1755/2015).
// Módulo PURO: los festivos son función únicamente del año, sin estado ni reloj.
// El "hoy" de referencia (alertas) lo aporta el router, no este módulo.
// Ver openspec/changes/derecho-peticion/.

/** Una fecha como "YYYY-MM-DD" en UTC (evita corrimientos por zona horaria). */
function isoUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Construye una fecha UTC a medianoche desde año/mes(1-12)/día. */
function dateUTC(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** Suma `n` días de calendario a una fecha (UTC), sin mutar la original. */
export function sumarDiasCalendario(desde: Date, n: number): Date {
  const d = new Date(desde.getTime());
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/** Mueve una fecha al lunes siguiente; si ya es lunes, la deja igual (Ley Emiliani). */
function aLunesSiguiente(d: Date): Date {
  const dow = d.getUTCDay(); // 0=Dom … 1=Lun … 6=Sáb
  const delta = (8 - dow) % 7; // Lun→0, Mar→6, … Dom→1
  return sumarDiasCalendario(d, delta);
}

/** Domingo de Pascua (algoritmo Gregoriano de Meeus/Jones/Butcher), puro sobre el año. */
function domingoPascua(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31); // 3=marzo, 4=abril
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return dateUTC(year, mes, dia);
}

/**
 * Festivos nacionales de Colombia para un año dado, como set de "YYYY-MM-DD".
 * Tres grupos: fijos; Emiliani (corridos al lunes siguiente, Ley 51/1983); y
 * relativos a la Pascua (Jueves/Viernes Santo en su día; Ascensión, Corpus
 * Christi y Sagrado Corazón corridos al lunes con los offsets +43/+64/+71).
 */
export function festivosColombia(year: number): Set<string> {
  const out = new Set<string>();

  // 1) Fijos (siempre en su fecha).
  const fijos: [number, number][] = [
    [1, 1], // Año Nuevo
    [5, 1], // Día del Trabajo
    [7, 20], // Independencia
    [8, 7], // Batalla de Boyacá
    [12, 8], // Inmaculada Concepción
    [12, 25], // Navidad
  ];
  for (const [m, d] of fijos) out.add(isoUTC(dateUTC(year, m, d)));

  // 2) Emiliani: se trasladan al lunes siguiente.
  const emiliani: [number, number][] = [
    [1, 6], // Reyes Magos
    [3, 19], // San José
    [6, 29], // San Pedro y San Pablo
    [8, 15], // Asunción de la Virgen
    [10, 12], // Día de la Raza
    [11, 1], // Todos los Santos
    [11, 11], // Independencia de Cartagena
  ];
  for (const [m, d] of emiliani) out.add(isoUTC(aLunesSiguiente(dateUTC(year, m, d))));

  // 3) Relativos a la Pascua.
  const pascua = domingoPascua(year);
  out.add(isoUTC(sumarDiasCalendario(pascua, -3))); // Jueves Santo
  out.add(isoUTC(sumarDiasCalendario(pascua, -2))); // Viernes Santo
  out.add(isoUTC(sumarDiasCalendario(pascua, 43))); // Ascensión (lunes)
  out.add(isoUTC(sumarDiasCalendario(pascua, 64))); // Corpus Christi (lunes)
  out.add(isoUTC(sumarDiasCalendario(pascua, 71))); // Sagrado Corazón (lunes)

  return out;
}

/** ¿La fecha es día hábil? No sábado, no domingo, no festivo nacional. */
export function esDiaHabil(d: Date): boolean {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !festivosColombia(d.getUTCFullYear()).has(isoUTC(d));
}

/**
 * Suma `n` días hábiles a `desde` (exclusivo de `desde`): avanza día a día
 * saltando fines de semana y festivos hasta contar `n` hábiles. `n <= 0`
 * devuelve la misma fecha. Festivos se recalculan por año al cruzar el límite.
 */
export function sumarDiasHabiles(desde: Date, n: number): Date {
  let d = new Date(desde.getTime());
  let restantes = Math.max(0, Math.floor(n));
  while (restantes > 0) {
    d = sumarDiasCalendario(d, 1);
    if (esDiaHabil(d)) restantes--;
  }
  return d;
}
