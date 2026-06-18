// Motor de la máquina de etapas — lógica PURA (sin Express ni Prisma): decide la
// siguiente etapa a la que un proceso puede auto-avanzar dados sus datos/documentos.
// Testeable con objetos planos. La persistencia (autoavanzarEtapas) vive en el service.
import { type EtapaDef, condicionPendiente, evaluarCondicion } from "./esquema";

const vacio = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

function requisitosListos(reglas: EtapaDef["reglas"], datos: Record<string, unknown>, docs: string[]): boolean {
  const camposReq = [
    ...(reglas?.camposRequeridos ?? []),
    ...(reglas?.requeridosSi ?? []).filter((r) => evaluarCondicion(r.si, datos)).flatMap((r) => r.camposRequeridos ?? []),
  ];
  if ([...new Set(camposReq)].some((k) => vacio(datos[k]))) return false;
  const docsReq = [
    ...(reglas?.documentosRequeridos ?? []),
    ...(reglas?.requeridosSi ?? []).filter((r) => evaluarCondicion(r.si, datos)).flatMap((r) => r.documentosRequeridos ?? []),
  ];
  const presentes = new Set(docs.map((d) => d.trim().toLowerCase()));
  return ![...new Set(docsReq)].some((n) => !presentes.has(n.trim().toLowerCase()));
}

/**
 * Siguiente etapa a la que el proceso puede AVANZAR SOLO con los datos/documentos
 * actuales: la inmediata por orden, sin ambigüedad de ramas, que no sea terminal
 * ni con acción de derivar, y con todos sus requisitos listos. null si no debe auto-avanzar.
 */
export function siguienteEtapaAuto(
  etapas: EtapaDef[],
  etapaActualKey: string,
  datos: Record<string, unknown>,
  docs: string[],
): EtapaDef | null {
  const ordenActual = etapas.find((e) => e.key === etapaActualKey)?.orden ?? -1;
  const ordenes = [...new Set(etapas.filter((e) => e.orden > ordenActual).map((e) => e.orden))].sort((a, b) => a - b);
  for (const orden of ordenes) {
    const nivel = etapas.filter((e) => e.orden === orden);
    const disponibles = nivel.filter((e) => !e.disponibleSi || evaluarCondicion(e.disponibleSi, datos));
    if (disponibles.length === 0) {
      if (nivel.some((e) => e.disponibleSi && condicionPendiente(e.disponibleSi, datos))) return null; // pendiente → esperar
      continue; // N/A definitivo → saltar nivel
    }
    if (disponibles.length > 1) return null; // varias ramas → no auto-avanzar
    const next = disponibles[0];
    if (next.accion?.tipo === "crearDerivado") return null; // requiere "Crear" manual
    if (!requisitosListos(next.reglas, datos, docs)) return null;
    return next;
  }
  return null;
}

/**
 * Salto a TERMINAL decidido (respaldo del avance conservador): salta directo a una
 * etapa terminal cuyo `disponibleSi` ya se cumple (única, por delante), aunque falte
 * el papeleo de etapas intermedias (retiro art. 67, conciliación…). Ambiguo → no salta.
 */
export function terminalDecidido(
  etapas: EtapaDef[],
  etapaActualKey: string,
  datos: Record<string, unknown>,
  docs: string[],
): EtapaDef | null {
  const ordenActual = etapas.find((e) => e.key === etapaActualKey)?.orden ?? -1;
  const cand = etapas.filter((e) => e.terminal && e.orden > ordenActual && e.disponibleSi && evaluarCondicion(e.disponibleSi, datos));
  if (cand.length !== 1) return null;
  return requisitosListos(cand[0].reglas, datos, docs) ? cand[0] : null;
}
