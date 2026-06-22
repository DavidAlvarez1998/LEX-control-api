// Detección de HITOS procesales a partir del texto (libre) de las actuaciones de la
// Rama Judicial → SUGIERE un avance de etapa + una fecha para pre-llenar. NO avanza
// solo (el motor exige el documento del juez); el abogado confirma. El texto de la
// Rama no es un enum → matching difuso por keywords normalizadas. Pensado para el
// ejecutivo de mínima cuantía, pero solo sugiere si la etapa/campo existen en el tipo.
// Ver openspec/changes/rama-judicial-actuaciones (flujo §3a, validación B3).

type ActuacionLite = { actuacion: string; fechaActuacion: string | Date | null };
type EtapaLite = { key: string; nombre: string };
type CampoLite = { key: string };

export type SugerenciaHito = {
  etapaKey: string;
  etapaNombre: string;
  campoFecha: string | null; // campo de fecha a pre-llenar (si aplica)
  fechaSugerida: string | null; // YYYY-MM-DD de la actuación que disparó el hito
  actuacion: string; // título de la actuación detectada
};

// keyword (normalizada, sin tildes, MAYÚS) → etapa destino + campo fecha a pre-llenar.
// El orden importa: la primera coincidencia gana por actuación.
const REGLAS: Array<{ kw: string[]; etapaKey: string; campoFecha: string | null }> = [
  { kw: ["INADMIT"], etapaKey: "calificacion", campoFecha: "fechaAdmision" },
  { kw: ["ADMIT", "ADMISOR"], etapaKey: "calificacion", campoFecha: "fechaAdmision" },
  { kw: ["MANDAMIENTO"], etapaKey: "mandamientoPago", campoFecha: "fechaMandamiento" },
  { kw: ["NOTIFIC"], etapaKey: "mandamientoPago", campoFecha: "fechaNotificacion" },
  { kw: ["EXCEPCION"], etapaKey: "mandamientoPago", campoFecha: null },
  { kw: ["SENTENCIA"], etapaKey: "mandamientoPago", campoFecha: null },
  { kw: ["LIQUIDAC", "AVALUO", "REMATE"], etapaKey: "impulsos", campoFecha: null },
  { kw: ["TERMINA", "ARCHIVO"], etapaKey: "terminacion", campoFecha: "fechaTerminacion" },
];

const normaliza = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

const aISO = (f: string | Date | null): string | null => {
  if (!f) return null;
  const d = f instanceof Date ? f : new Date(f);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const vacio = (v: unknown): boolean => v === undefined || v === null || v === "";

/**
 * Devuelve sugerencias de avance (máx. una por etapa) a partir de las actuaciones.
 * Solo sugiere si: (a) la etapa existe en el tipo, (b) si hay campoFecha, el campo
 * existe en el esquema Y está vacío en `datos` (no re-sugiere lo ya diligenciado).
 */
export function detectarHitos(
  actuaciones: ActuacionLite[],
  etapas: EtapaLite[],
  esquema: CampoLite[],
  datos: Record<string, unknown>,
): SugerenciaHito[] {
  const etapaPorKey = new Map(etapas.map((e) => [e.key, e]));
  const campos = new Set(esquema.map((c) => c.key));
  const porEtapa = new Map<string, SugerenciaHito>();

  for (const a of actuaciones) {
    const texto = normaliza(a.actuacion ?? "");
    if (!texto) continue;
    const regla = REGLAS.find((r) => r.kw.some((k) => texto.includes(k)));
    if (!regla) continue;

    const etapa = etapaPorKey.get(regla.etapaKey);
    if (!etapa) continue; // el tipo no tiene esa etapa → no aplica
    if (porEtapa.has(regla.etapaKey)) continue; // ya hay sugerencia (la más reciente gana)

    // Si propone pre-llenar una fecha, exigir que el campo exista y esté vacío.
    const campoFecha = regla.campoFecha && campos.has(regla.campoFecha) && vacio(datos[regla.campoFecha])
      ? regla.campoFecha
      : null;

    porEtapa.set(regla.etapaKey, {
      etapaKey: regla.etapaKey,
      etapaNombre: etapa.nombre,
      campoFecha,
      fechaSugerida: campoFecha ? aISO(a.fechaActuacion) : null,
      actuacion: a.actuacion,
    });
  }

  return [...porEtapa.values()];
}
