// Detección de HITOS procesales a partir del texto (libre) de las actuaciones de la
// Rama Judicial. Dos usos: (1) SUGERIR avances al abogado (panel de la ficha) y
// (2) DERIVAR el autollenado + el posicionamiento de etapa que el sync aplica.
// El mapeo es DATA-DRIVEN por tipo (`TipoProceso.mapeoActuaciones`): cada regla
// asocia keywords de `actuacion`/`anotacion` a una etapa y, opcionalmente, a un
// campo de fecha y/o un campo de decisión a pre-llenar. Soporta negación (`excluir`)
// para evitar falsos positivos ("NIEGA terminación" no es una terminación).
// Si el tipo no declara `mapeoActuaciones`, se usa el fallback legacy del ejecutivo.
// El texto de la Rama no es un enum → matching difuso por subcadena normalizada.
// Ver openspec/changes/rama-autollenado-y-timeline.

type ActuacionLite = { actuacion: string; anotacion?: string | null; fechaActuacion: string | Date | null };
type EtapaLite = { key: string; nombre: string; orden?: number; disponibleSi?: unknown };
type CampoLite = { key: string };

/** Regla declarada por el tipo (DB) o por el fallback legacy. */
export type MapeoRegla = {
  etapaKey: string;
  actuacion?: string[]; // keywords contra el TÍTULO de la actuación (OR)
  anotacion?: string[]; // keywords contra la ANOTACIÓN/texto libre (OR)
  excluir?: string[]; // si alguna aparece en título+anotación → la regla NO aplica (negación)
  fechaCampo?: string | null; // campo `fecha` a pre-llenar con la fecha de la actuación
  valorCampo?: string; // campo (p. ej. un select) a pre-llenar
  valor?: string; // valor para `valorCampo` (p. ej. "Admite" / "Inadmite")
};

export type SugerenciaHito = {
  etapaKey: string;
  etapaNombre: string;
  campoFecha: string | null; // campo de fecha a pre-llenar (si aplica y está vacío)
  fechaSugerida: string | null; // YYYY-MM-DD de la actuación que disparó el hito
  campoValor: string | null; // campo (no-fecha) a pre-llenar (si aplica y está vacío)
  valorSugerido: string | null; // valor para `campoValor`
  actuacion: string; // título de la actuación detectada
};

// Fallback LEGACY (solo si el tipo no declara `mapeoActuaciones`). Actualizado a las
// etapas reales del ejecutivo de mínima cuantía y con negaciones. El orden importa:
// la primera coincidencia gana por actuación (INADMIT antes que ADMIT, subcadena de él).
const REGLAS_LEGACY: MapeoRegla[] = [
  { etapaKey: "calificacion", actuacion: ["INADMIT"], fechaCampo: "fechaAdmision", valorCampo: "decisionCalificacion", valor: "Inadmite" },
  { etapaKey: "calificacion", actuacion: ["ADMIT", "ADMISOR"], excluir: ["INADMIT"], fechaCampo: "fechaAdmision", valorCampo: "decisionCalificacion", valor: "Admite" },
  { etapaKey: "mandamientoPago", actuacion: ["MANDAMIENTO"], fechaCampo: "fechaMandamiento" },
  { etapaKey: "mandamientoPago", actuacion: ["NOTIFICAC"], excluir: ["ESTADO", "SENTENCIA", "EDICTO", "EMPLAZA"], fechaCampo: "fechaNotificacion" },
  { etapaKey: "notifCautelares", actuacion: ["CAUTELAR", "EMBARGO", "SECUESTRO"], fechaCampo: "fechaCautelares" },
  { etapaKey: "audiencia", actuacion: ["SEGUIR ADELANTE", "SENTENCIA"], excluir: ["NIEGA"], fechaCampo: "fechaSentencia" },
  { etapaKey: "liquidacionCredito", actuacion: ["LIQUIDAC"], anotacion: ["LIQUIDAC"], fechaCampo: "fechaLiquidacion" },
  { etapaKey: "avaluoRemate", actuacion: ["AVALUO", "REMATE"] },
  { etapaKey: "terminacion", actuacion: ["TERMINA", "ARCHIVO"], anotacion: ["TERMINA", "ARCHIVO"], excluir: ["NIEGA", "TRASLADO", "SOLICITUD", "CORRECCION"], fechaCampo: "fechaTerminacion" },
];

const normaliza = (s: string): string =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

const aISO = (f: string | Date | null): string | null => {
  if (!f) return null;
  const d = f instanceof Date ? f : new Date(f);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const vacio = (v: unknown): boolean => v === undefined || v === null || v === "";

/** ¿Coincide la regla con esta actuación? (título OR anotación) AND sin `excluir`. */
function coincide(regla: MapeoRegla, titulo: string, anot: string): boolean {
  const texto = `${titulo} ${anot}`;
  if (regla.excluir?.some((k) => texto.includes(normaliza(k)))) return false;
  const tHit = regla.actuacion?.some((k) => titulo.includes(normaliza(k))) ?? false;
  const aHit = regla.anotacion?.some((k) => anot.includes(normaliza(k))) ?? false;
  return tHit || aHit;
}

/** Normaliza un `mapeoActuaciones` venido de la DB (JSON) a reglas tipadas; si está
 *  vacío/ausente, cae al fallback legacy. */
export function reglasDeTipo(mapeo: unknown): MapeoRegla[] {
  if (Array.isArray(mapeo) && mapeo.length) return mapeo as MapeoRegla[];
  return REGLAS_LEGACY;
}

/**
 * Sugerencias de avance (máx. una por etapa) a partir de las actuaciones. Solo sugiere
 * si: (a) la etapa existe en el tipo, (b) si hay campoFecha/campoValor, el campo existe
 * en el esquema Y está vacío en `datos` (no re-sugiere lo ya diligenciado). La primera
 * actuación (en el orden recibido — normalmente más reciente primero) gana por etapa.
 */
export function detectarHitos(
  actuaciones: ActuacionLite[],
  etapas: EtapaLite[],
  esquema: CampoLite[],
  datos: Record<string, unknown>,
  mapeo?: unknown,
): SugerenciaHito[] {
  const reglas = reglasDeTipo(mapeo);
  const etapaPorKey = new Map(etapas.map((e) => [e.key, e]));
  const campos = new Set(esquema.map((c) => c.key));
  const porEtapa = new Map<string, SugerenciaHito>();

  for (const a of actuaciones) {
    const titulo = normaliza(a.actuacion ?? "");
    const anot = normaliza(a.anotacion ?? "");
    if (!titulo && !anot) continue;
    const regla = reglas.find((r) => coincide(r, titulo, anot));
    if (!regla) continue;

    const etapa = etapaPorKey.get(regla.etapaKey);
    if (!etapa) continue; // el tipo no tiene esa etapa → no aplica
    if (porEtapa.has(regla.etapaKey)) continue; // ya hay sugerencia (la primera gana)

    const campoFecha = regla.fechaCampo && campos.has(regla.fechaCampo) && vacio(datos[regla.fechaCampo])
      ? regla.fechaCampo
      : null;
    const campoValor = regla.valorCampo && regla.valor && campos.has(regla.valorCampo) && vacio(datos[regla.valorCampo])
      ? regla.valorCampo
      : null;

    porEtapa.set(regla.etapaKey, {
      etapaKey: regla.etapaKey,
      etapaNombre: etapa.nombre,
      campoFecha,
      fechaSugerida: campoFecha ? aISO(a.fechaActuacion) : null,
      campoValor,
      valorSugerido: campoValor ? regla.valor! : null,
      actuacion: a.actuacion,
    });
  }

  return [...porEtapa.values()];
}

export type DerivacionRama = {
  /** Campos a fijar en `datos` (fechas y decisiones), solo de los hitos detectados. */
  campos: Record<string, string>;
  /** Hitos detectados (para el panel/timeline y el cálculo de etapa destino). */
  hitos: SugerenciaHito[];
};

/**
 * Deriva, a partir de las actuaciones, TODOS los campos a autollenar y los hitos
 * detectados. El sync los aplica con su propia semántica "solo si vacío" (no pisa al
 * abogado). El posicionamiento de etapa se calcula aparte con `etapaMasAvanzada`,
 * porque depende de los datos YA autollenados.
 */
export function derivarDesdeActuaciones(
  actuaciones: ActuacionLite[],
  etapas: EtapaLite[],
  esquema: CampoLite[],
  datos: Record<string, unknown>,
  mapeo?: unknown,
): DerivacionRama {
  const hitos = detectarHitos(actuaciones, etapas, esquema, datos, mapeo);
  const campos: Record<string, string> = {};
  for (const h of hitos) {
    if (h.campoFecha && h.fechaSugerida) campos[h.campoFecha] = h.fechaSugerida;
    if (h.campoValor && h.valorSugerido) campos[h.campoValor] = h.valorSugerido;
  }
  return { campos, hitos };
}

/**
 * Dada la lista de hitos detectados, devuelve la `etapaKey` de MAYOR orden que:
 * está por delante de la etapa actual y cuyo `disponibleSi` se cumple con `datos`
 * (que ya debe incluir el autollenado). Devuelve null si no hay avance.
 * `evalDisponible` se inyecta para no acoplar este módulo puro al motor de condiciones.
 */
export function etapaMasAvanzada(
  hitos: SugerenciaHito[],
  etapas: EtapaLite[],
  etapaActual: string,
  evalDisponible: (etapa: EtapaLite) => boolean,
): string | null {
  const ordenDe = (key: string) => etapas.find((e) => e.key === key)?.orden ?? 0;
  const ordenActual = ordenDe(etapaActual);
  let mejor: { key: string; orden: number } | null = null;
  for (const h of hitos) {
    const etapa = etapas.find((e) => e.key === h.etapaKey);
    if (!etapa) continue;
    const orden = etapa.orden ?? 0;
    if (orden <= ordenActual) continue; // nunca retrocede automáticamente
    if (!evalDisponible(etapa)) continue;
    if (!mejor || orden > mejor.orden) mejor = { key: etapa.key, orden };
  }
  return mejor?.key ?? null;
}
