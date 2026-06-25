// Actuaciones de la Rama Judicial (CPNU) para un Proceso. Casos de uso:
//  - validarRadicado: ¿existe el radicado en la Rama? (feedback al pegarlo).
//  - sincronizarActuaciones: descarga e inserta SOLO las nuevas (idempotente), cachea
//    idProcesoRama y autollena datos.ultimaActuacion (la usa la plantilla memorial).
//  - listarActuaciones: las guardadas, más reciente primero.
// Tenant-scoped: el proceso debe ser de la empresa del solicitante. Ver
// openspec/changes/rama-judicial-actuaciones.
import { createHash } from "crypto";
import { Prisma, RolParte, TipoPersona } from "@prisma/client";
import { env } from "../../config/env";
import { HttpError } from "../../middleware/error";
import { logger } from "../../shared/logger";
import { prisma } from "../../shared/prisma";
import { empresaIdOrThrow, type TenantContext } from "../../shared/tenant";
import { carpetaModulo, subirDocumento } from "../documentos/documentos.client";
import { enviarNovedadActuaciones } from "../notificaciones";
import { consultarRadicado, descargarDocumento, obtenerActuaciones, obtenerDetalle, obtenerDocumentos, obtenerSujetos, type ActuacionRama } from "../rama-judicial";
import { detectarHitos } from "./hitos-actuaciones";
import { categoriaDoc } from "./procesos.service";

// En tests no esperamos (evita esperas reales del batching/anti-bloqueo).
const dormir = (ms: number) =>
  process.env.NODE_ENV === "test" ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

const vacio = (v: unknown): boolean => v === undefined || v === null || v === "";

/** Lo que el core de sincronización necesita del Proceso (sin tenant). */
type ProcesoSync = {
  id: string;
  radicado: string | null;
  idProcesoRama: string | null;
  datos: unknown;
  despachoJuzgado?: string | null;
  titulo?: string;
  responsable?: { email: string; nombre: string } | null;
  actuacionesVistasAt?: Date | null; // para recalcular el contador de "nuevas" (P1)
  // Keys del formulario del tipo: para autollenar SOLO campos que existen (sin
  // introducir claves desconocidas en `datos`).
  esquema?: Array<{ key: string }>;
};
type ResultadoSync = { encontrado: boolean; reservado: boolean; nuevas: number; total: number };

/** Resultado por proceso de una sincronización on-demand, para mostrar al usuario un
 *  resumen accionable (no solo un contador). Separa lo que NO es error (no publicado /
 *  reservado) de las dos causas de error reales: dato (radicado) vs fuente (Rama). */
export type ResultadoSyncProceso =
  | "ACTUALIZADO"          // se insertaron actuaciones nuevas
  | "SIN_NOVEDAD"          // consultado OK, sin novedades
  | "NO_PUBLICADO"         // el radicado no existe / no está publicado en la Rama (NO es error)
  | "RESERVADO"            // proceso privado en la Rama (NO es error)
  | "RADICADO_INVALIDO"    // dato: el radicado guardado no tiene 23 dígitos → lo arregla el usuario
  | "FUENTE_NO_DISPONIBLE"; // transitorio: la Rama no respondió / bloqueó / 5xx → reintentar
type ItemResultadoSync = { procesoId: string; titulo: string | null; radicado: string | null; resultado: ResultadoSyncProceso };

/** Mapea el retorno OK de sincronizarProceso a una categoría de usuario. */
export function categorizarOk(r: ResultadoSync): ResultadoSyncProceso {
  if (r.reservado) return "RESERVADO";
  if (!r.encontrado) return "NO_PUBLICADO";
  return r.nuevas > 0 ? "ACTUALIZADO" : "SIN_NOVEDAD";
}

/** Distingue las dos causas de error por el status del HttpError: 400 = radicado
 *  inválido (dato del usuario); cualquier otra cosa = fuente caída (reintentable). */
export function categorizarError(err: unknown): ResultadoSyncProceso {
  const status = err instanceof HttpError ? err.status : 0;
  return status === 400 ? "RADICADO_INVALIDO" : "FUENTE_NO_DISPONIBLE";
}

/** Deja solo dígitos y exige 23 (radicado CPNU). Devuelve null si no cumple. */
export function normalizarRadicado(raw: string | null | undefined): string | null {
  const v = (raw ?? "").replace(/\D/g, "");
  return v.length === 23 ? v : null;
}

/** Hash estable anti-duplicado (la CPNU no da id por actuación). */
function huella(a: ActuacionRama): string {
  return createHash("sha256")
    .update(`${a.fechaActuacion ?? ""}|${a.actuacion ?? ""}|${a.anotacion ?? ""}`)
    .digest("hex");
}

function parseFecha(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Endpoint A: ¿existe el radicado? Para feedback inmediato al pegarlo. */
export async function validarRadicado(radicado: string) {
  const norm = normalizarRadicado(radicado);
  if (!norm) throw new HttpError(400, "El radicado debe tener 23 dígitos");
  return consultarRadicado(norm);
}

async function cargarProcesoScoped(t: TenantContext, procesoId: string) {
  const empresaId = empresaIdOrThrow(t);
  const proceso = await prisma.proceso.findFirst({
    where: { id: procesoId, empresaId },
    select: {
      id: true, radicado: true, idProcesoRama: true, datos: true, despachoJuzgado: true,
      titulo: true, actuacionesVistasAt: true,
      responsable: { select: { email: true, nombre: true } },
      tipoProceso: { select: { esquemaFormulario: true } },
    },
  });
  if (!proceso) throw new HttpError(404, "Proceso no encontrado");
  return proceso;
}

/** Adapta el proceso cargado (con tipoProceso anidado) a ProcesoSync. */
function aProcesoSync(p: { tipoProceso?: { esquemaFormulario: unknown } | null } & Record<string, unknown>): ProcesoSync {
  return { ...(p as unknown as ProcesoSync), esquema: (p.tipoProceso?.esquemaFormulario ?? []) as Array<{ key: string }> };
}

/** CORE de sincronización (SIN tenant): lo comparten el endpoint on-demand y el
 *  cron masivo. Inserta solo las nuevas, cachea idProcesoRama y autollena
 *  datos.ultimaActuacion. Lanza HttpError(502) si la Rama falla (lo maneja el caller). */
export async function sincronizarProceso(
  proceso: ProcesoSync,
  opts: { notificar?: boolean } = {},
): Promise<ResultadoSync> {
  const radicado = normalizarRadicado(proceso.radicado);
  if (!radicado) throw new HttpError(400, "El proceso no tiene un radicado válido de 23 dígitos");

  // idProceso: usar el cacheado o resolverlo vía Endpoint A.
  let idProceso = proceso.idProcesoRama;
  let despacho: string | null = null; // #4: juzgado, solo lo trae el Endpoint A
  let fechaProceso: string | null = null; // fecha de radicación, idem
  if (!idProceso) {
    const info = await consultarRadicado(radicado);
    if (info.esPrivado) {
      await prisma.proceso.update({ where: { id: proceso.id }, data: { ramaEstado: "RESERVADO", actuacionesSyncAt: new Date() } });
      return { encontrado: false, reservado: true, nuevas: 0, total: 0 };
    }
    if (!info.encontrado || info.idProceso == null) {
      await prisma.proceso.update({ where: { id: proceso.id }, data: { ramaEstado: "NO_PUBLICADO", actuacionesSyncAt: new Date() } });
      return { encontrado: false, reservado: false, nuevas: 0, total: 0 };
    }
    idProceso = String(info.idProceso);
    despacho = info.despacho;
    fechaProceso = info.fechaProceso;
  }

  const actuaciones = await obtenerActuaciones(idProceso);
  const items = actuaciones.map((a) => ({ a, h: huella(a) }));

  const existentes = new Set(
    (await prisma.actuacionProceso.findMany({ where: { procesoId: proceso.id }, select: { huella: true } })).map((x) => x.huella),
  );
  const nuevas = items.filter(({ h }) => !existentes.has(h));

  if (nuevas.length) {
    await prisma.actuacionProceso.createMany({
      data: nuevas.map(({ a, h }) => ({
        procesoId: proceso.id,
        fechaActuacion: parseFecha(a.fechaActuacion) ?? new Date(0),
        actuacion: a.actuacion,
        anotacion: a.anotacion ?? null,
        fechaInicial: parseFecha(a.fechaInicial),
        fechaFinal: parseFecha(a.fechaFinal),
        fechaRegistro: parseFecha(a.fechaRegistro),
        huella: h,
      })),
      skipDuplicates: true,
    });
  }

  // Cachear idProcesoRama + autollenar campos de `datos` SOLO si existen en el esquema
  // del tipo y están vacíos (no pisa lo del abogado ni mete claves desconocidas).
  const masReciente = [...actuaciones].sort(
    (x, y) => (parseFecha(y.fechaActuacion)?.getTime() ?? 0) - (parseFecha(x.fechaActuacion)?.getTime() ?? 0),
  )[0];
  const datos = (proceso.datos ?? {}) as Record<string, unknown>;
  const campos = new Set((proceso.esquema ?? []).map((c) => c.key));
  const datosPatch: Record<string, unknown> = { ...datos };
  let datosCambio = false;
  const camposRama: string[] = []; // P8: campos que llenó la Rama (para el chip "de la Rama")
  const fijar = (key: string, valor: string | null | undefined) => {
    if (valor && campos.has(key) && vacio(datos[key])) { datosPatch[key] = valor; datosCambio = true; camposRama.push(key); }
  };
  if (masReciente && campos.has("ultimaActuacion")) { datosPatch.ultimaActuacion = masReciente.actuacion; datosCambio = true; }
  fijar("juzgado", despacho?.trim()); // #4: juzgado asignado
  fijar("fechaRadicacion", fechaProceso?.slice(0, 10)); // fecha de radicación (de fechaProceso)
  if (despacho && vacio(proceso.despachoJuzgado)) camposRama.push("despachoJuzgado");

  // P1: contador denormalizado de no-leídas (createdAt > actuacionesVistasAt). Si nunca
  // se marcó "vistas", 0 (no inunda en la primera carga; igual que listarActuaciones).
  const vistasAt = proceso.actuacionesVistasAt ?? null;
  const actuacionesNuevas = vistasAt
    ? await prisma.actuacionProceso.count({ where: { procesoId: proceso.id, createdAt: { gt: vistasAt } } })
    : 0;

  await prisma.proceso.update({
    where: { id: proceso.id },
    data: {
      idProcesoRama: idProceso,
      actuacionesSyncAt: new Date(), // frescura (P5): última sincronización con la Rama
      actuacionesNuevas, // P1: novedades para la lista
      ramaEstado: "OK", // P6
      ...(camposRama.length ? { camposRamaCsv: [...new Set(camposRama)].join(",") } : {}), // P8
      ...(datosCambio ? { datos: datosPatch as Prisma.InputJsonValue } : {}),
      // Espejo a la columna canónica del despacho (genérico), SOLO si está vacía.
      ...(despacho && vacio(proceso.despachoJuzgado) ? { despachoJuzgado: despacho } : {}),
    },
  });

  // #2: avisar por correo al abogado responsable cuando el CRON encuentra novedades
  // (en on-demand no se notifica: el abogado ya las ve en pantalla). Best-effort.
  if (opts.notificar && nuevas.length > 0 && proceso.responsable?.email) {
    await enviarNovedadActuaciones({
      to: proceso.responsable.email,
      nombre: proceso.responsable.nombre,
      procesoTitulo: proceso.titulo ?? "tu proceso",
      radicado,
      nuevas: nuevas.length,
      ultima: masReciente?.actuacion ?? null,
    });
  }

  logger.info("actuaciones sincronizadas", { procesoId: proceso.id, nuevas: nuevas.length, total: items.length });
  return { encontrado: true, reservado: false, nuevas: nuevas.length, total: items.length };
}

/** On-demand (tenant-scoped): valida pertenencia y sincroniza un proceso. */
export async function sincronizarActuaciones(t: TenantContext, procesoId: string): Promise<ResultadoSync> {
  const proceso = await cargarProcesoScoped(t, procesoId);
  return sincronizarProceso(aProcesoSync(proceso));
}

/** Sincronización MASIVA (cron): recorre todos los procesos abiertos con radicado en
 *  lotes, espaciando requests/lotes y pausando ante errores seguidos (anti rate-limit
 *  de la Rama, §4 del spec). Un fallo por proceso NO detiene el barrido. */
export async function sincronizarTodas(): Promise<{
  procesos: number;
  conNovedad: number;
  nuevasTotal: number;
  errores: number;
}> {
  const { batchSize, delayRequestMs, delayLoteMs, maxConsecutiveErrors, pauseOnErrorsMs } = env.ramaJudicial;
  const procesos = await prisma.proceso.findMany({
    where: { radicado: { not: null }, estado: { notIn: ["CERRADO", "ARCHIVADO"] } },
    select: {
      id: true, radicado: true, idProcesoRama: true, datos: true, despachoJuzgado: true,
      titulo: true, actuacionesVistasAt: true, responsable: { select: { email: true, nombre: true } },
      tipoProceso: { select: { esquemaFormulario: true } },
    },
  });

  logger.info("sync masivo iniciado", { procesos: procesos.length });
  let conNovedad = 0;
  let nuevasTotal = 0;
  let errores = 0;
  let erroresSeguidos = 0;

  for (let i = 0; i < procesos.length; i++) {
    try {
      const r = await sincronizarProceso(aProcesoSync(procesos[i]), { notificar: true });
      if (r.nuevas > 0) { conNovedad++; nuevasTotal += r.nuevas; }
      erroresSeguidos = 0;
    } catch (err) {
      errores++;
      erroresSeguidos++;
      logger.warn("sync masivo: proceso falló", { procesoId: procesos[i].id, err: String(err) });
      if (erroresSeguidos >= maxConsecutiveErrors) {
        logger.warn("sync masivo: pausa por errores seguidos", { pauseOnErrorsMs });
        await dormir(pauseOnErrorsMs);
        erroresSeguidos = 0;
      }
    }
    const finDeLote = (i + 1) % batchSize === 0;
    if (i < procesos.length - 1) await dormir(finDeLote ? delayLoteMs : delayRequestMs);
  }

  logger.info("sync masivo terminado", { procesos: procesos.length, conNovedad, nuevasTotal, errores });
  return { procesos: procesos.length, conNovedad, nuevasTotal, errores };
}

/** P16: sincroniza on-demand los procesos de la empresa (con radicado, no cerrados) que no
 *  se han sincronizado en las últimas 6 h. Acotado a 40 por llamada para no colgar el request;
 *  el barrido completo lo hace el cron. Sin notificar (el usuario lo disparó).
 *
 *  `procesoIds` (opcional): reintento dirigido — sincroniza SOLO esos (de la empresa),
 *  ignorando la ventana de 6 h. Lo usa el botón "Reintentar" sobre los que fallaron por
 *  fuente no disponible. Devuelve, además de los contadores, `resultados[]` por proceso
 *  para que la UI muestre un resumen accionable (no solo "N con error"). */
export async function sincronizarMisProcesos(t: TenantContext, procesoIds?: string[]) {
  const empresaId = empresaIdOrThrow(t);
  const hace6h = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const reintento = Array.isArray(procesoIds) && procesoIds.length > 0;
  const procesos = await prisma.proceso.findMany({
    where: {
      empresaId, radicado: { not: null }, estado: { notIn: ["CERRADO", "ARCHIVADO"] },
      ...(reintento
        ? { id: { in: procesoIds } } // reintento dirigido: sin filtro de frescura
        : { OR: [{ actuacionesSyncAt: null }, { actuacionesSyncAt: { lt: hace6h } }] }),
    },
    take: 40,
    select: {
      id: true, radicado: true, idProcesoRama: true, datos: true, despachoJuzgado: true, titulo: true,
      actuacionesVistasAt: true, responsable: { select: { email: true, nombre: true } },
      tipoProceso: { select: { esquemaFormulario: true } },
    },
  });
  let conNovedad = 0;
  let nuevasTotal = 0;
  let errores = 0;
  const resultados: ItemResultadoSync[] = [];
  for (const p of procesos) {
    let resultado: ResultadoSyncProceso;
    try {
      const r = await sincronizarProceso(aProcesoSync(p));
      if (r.nuevas > 0) { conNovedad++; nuevasTotal += r.nuevas; }
      resultado = categorizarOk(r);
    } catch (err) {
      errores++;
      resultado = categorizarError(err);
      // Antes era silencioso: capturamos motivo+proceso para poder diagnosticar
      // por qué un proceso cuenta "con error" (radicado inválido vs Rama caída).
      logger.warn("sync on-demand: proceso falló", { procesoId: p.id, radicado: p.radicado, err: String(err) });
    }
    resultados.push({ procesoId: p.id, titulo: p.titulo ?? null, radicado: p.radicado ?? null, resultado });
    await dormir(env.ramaJudicial.delayRequestMs);
  }
  return { procesos: procesos.length, conNovedad, nuevasTotal, errores, resultados };
}

/** Actuaciones guardadas del proceso (más reciente primero). Cada ítem trae `nueva`
 *  (#3): true si se insertó después de `actuacionesVistasAt` (no-leídas persistentes;
 *  si nunca se marcó "vistas", nada es "nueva" para no inundar en la primera carga). */
export async function listarActuaciones(t: TenantContext, procesoId: string) {
  const proceso = await cargarProcesoScoped(t, procesoId);
  const vistasAt = proceso.actuacionesVistasAt?.getTime() ?? null;
  const filas = await prisma.actuacionProceso.findMany({
    where: { procesoId },
    orderBy: { fechaActuacion: "desc" },
    select: {
      id: true, fechaActuacion: true, actuacion: true, anotacion: true, fechaRegistro: true, createdAt: true,
    },
  });
  return filas.map((a) => ({ ...a, nueva: vistasAt != null && a.createdAt.getTime() > vistasAt }));
}

/** #3: marca todas las actuaciones del proceso como vistas (sello = ahora). */
export async function marcarActuacionesVistas(t: TenantContext, procesoId: string) {
  const proceso = await cargarProcesoScoped(t, procesoId);
  await prisma.proceso.update({ where: { id: proceso.id }, data: { actuacionesVistasAt: new Date(), actuacionesNuevas: 0 } });
  return { ok: true };
}

/** #1: sugerencias de avance de etapa a partir de los hitos de las actuaciones. */
export async function sugerenciasDeProceso(t: TenantContext, procesoId: string) {
  const empresaId = empresaIdOrThrow(t);
  const proceso = await prisma.proceso.findFirst({
    where: { id: procesoId, empresaId },
    select: {
      datos: true,
      tipoProceso: { select: { etapas: true, esquemaFormulario: true } },
      actuaciones: { orderBy: { fechaActuacion: "desc" }, select: { actuacion: true, fechaActuacion: true } },
    },
  });
  if (!proceso) throw new HttpError(404, "Proceso no encontrado");
  const etapas = (proceso.tipoProceso?.etapas ?? []) as Array<{ key: string; nombre: string }>;
  const esquema = (proceso.tipoProceso?.esquemaFormulario ?? []) as Array<{ key: string }>;
  const datos = (proceso.datos ?? {}) as Record<string, unknown>;
  return detectarHitos(proceso.actuaciones, etapas, esquema, datos);
}

// ===================== P9 — Documentos del expediente (importar PDFs) =====================

/** idProceso de la Rama (cacheado o resuelto vía Endpoint A). null si no aplica. */
async function resolverIdProceso(radicado: string | null, idCache: string | null): Promise<string | null> {
  if (idCache) return idCache;
  const norm = normalizarRadicado(radicado);
  if (!norm) return null;
  const info = await consultarRadicado(norm);
  return info.encontrado && info.idProceso != null ? String(info.idProceso) : null;
}

async function idRegsImportados(procesoId: string): Promise<Set<string>> {
  const filas = await prisma.documentoProceso.findMany({
    where: { procesoId, origenRamaIdReg: { not: null } },
    select: { origenRamaIdReg: true },
  });
  return new Set(filas.map((d) => String(d.origenRamaIdReg)));
}

// ===================== P10 — Importar partes (Sujetos) =====================

const normNombre = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function rolDeSujeto(tipoSujeto: string | null, esEjecutivo: boolean): RolParte {
  const t = (tipoSujeto ?? "").toLowerCase();
  if (t.includes("demandante") || t.includes("ejecutante") || t.includes("accionante"))
    return esEjecutivo ? RolParte.EJECUTANTE : RolParte.DEMANDANTE;
  if (t.includes("demandado") || t.includes("ejecutado") || t.includes("accionado"))
    return esEjecutivo ? RolParte.EJECUTADO : RolParte.DEMANDADO;
  return RolParte.OTRO;
}

function inferTipoPersona(nombre: string): TipoPersona {
  return /\b(s\.?a\.?s|ltda|e\.?s\.?p|s\.?a\.?|nit|sociedad|empresa|banco|fundaci|corporaci|cooperativa)\b/i.test(nombre)
    ? TipoPersona.JURIDICA
    : TipoPersona.NATURAL;
}

async function cargarParaPartes(t: TenantContext, procesoId: string) {
  const empresaId = empresaIdOrThrow(t);
  const proceso = await prisma.proceso.findFirst({
    where: { id: procesoId, empresaId },
    select: {
      radicado: true, idProcesoRama: true,
      tipoProceso: { select: { nombre: true } },
      partes: { select: { litigante: { select: { nombre: true } } } },
    },
  });
  if (!proceso) throw new HttpError(404, "Proceso no encontrado");
  return { empresaId, proceso };
}

/** P10: partes que reporta la Rama, marcando cuáles ya están en el proceso. */
export async function sugerirPartesRama(t: TenantContext, procesoId: string) {
  const { proceso } = await cargarParaPartes(t, procesoId);
  const idProceso = await resolverIdProceso(proceso.radicado, proceso.idProcesoRama);
  if (!idProceso) return { encontrado: false, sujetos: [] as Array<Record<string, unknown>> };
  const sujetos = await obtenerSujetos(idProceso);
  const existentes = new Set(proceso.partes.map((p) => normNombre(p.litigante?.nombre)));
  const esEjec = /ejecutivo/i.test(proceso.tipoProceso?.nombre ?? "");
  return {
    encontrado: true,
    sujetos: sujetos
      .filter((s) => s.nombreRazonSocial)
      .map((s) => ({ ...s, rol: rolDeSujeto(s.tipoSujeto, esEjec), yaExiste: existentes.has(normNombre(s.nombreRazonSocial)) })),
  };
}

/** P10: crea como partes los sujetos seleccionados (o todos los que faltan). No pisa. */
export async function importarPartesRama(t: TenantContext, procesoId: string, nombres?: string[]) {
  const { empresaId, proceso } = await cargarParaPartes(t, procesoId);
  const idProceso = await resolverIdProceso(proceso.radicado, proceso.idProcesoRama);
  if (!idProceso) return { importadas: 0 };
  const sujetos = await obtenerSujetos(idProceso);
  const existentes = new Set(proceso.partes.map((p) => normNombre(p.litigante?.nombre)));
  const esEjec = /ejecutivo/i.test(proceso.tipoProceso?.nombre ?? "");
  const sel = nombres && nombres.length ? new Set(nombres.map(normNombre)) : null;

  let importadas = 0;
  for (const s of sujetos) {
    const nom = (s.nombreRazonSocial ?? "").trim();
    if (!nom || existentes.has(normNombre(nom)) || (sel && !sel.has(normNombre(nom)))) continue;
    try {
      const lit = await prisma.litigante.create({
        data: { empresaId, nombre: nom, tipoPersona: inferTipoPersona(nom), numeroDocumento: s.identificacion ?? undefined },
      });
      await prisma.parteProceso.create({
        data: { procesoId, litiganteId: lit.id, rol: rolDeSujeto(s.tipoSujeto, esEjec), esNuestroCliente: false },
      });
      existentes.add(normNombre(nom));
      importadas++;
    } catch (err) {
      logger.warn("import parte rama falló", { procesoId, nombre: nom, err: String(err) });
    }
  }
  return { importadas };
}

/** P11: detalle del proceso en el juzgado (tipo/clase/ubicación/última actualización). */
export async function obtenerDetalleRama(t: TenantContext, procesoId: string) {
  const empresaId = empresaIdOrThrow(t);
  const proceso = await prisma.proceso.findFirst({
    where: { id: procesoId, empresaId },
    select: { radicado: true, idProcesoRama: true },
  });
  if (!proceso) throw new HttpError(404, "Proceso no encontrado");
  const idProceso = await resolverIdProceso(proceso.radicado, proceso.idProcesoRama);
  if (!idProceso) return null;
  return obtenerDetalle(idProceso);
}

/** Lista los documentos del expediente en la Rama, marcando los ya importados. */
export async function listarDocumentosRama(t: TenantContext, procesoId: string) {
  const empresaId = empresaIdOrThrow(t);
  const proceso = await prisma.proceso.findFirst({
    where: { id: procesoId, empresaId },
    select: { id: true, radicado: true, idProcesoRama: true },
  });
  if (!proceso) throw new HttpError(404, "Proceso no encontrado");
  const idProceso = await resolverIdProceso(proceso.radicado, proceso.idProcesoRama);
  if (!idProceso) return { encontrado: false, documentos: [] as Array<Record<string, unknown>> };
  const docs = await obtenerDocumentos(idProceso);
  const importados = await idRegsImportados(procesoId);
  return { encontrado: true, documentos: docs.map((d) => ({ ...d, yaImportado: importados.has(String(d.idRegDocumento)) })) };
}

/** Importa (descarga + guarda en el proceso) los documentos del expediente. Idempotente;
 *  espacia las descargas (anti-bloqueo §4). On-demand: NO se llama desde el cron. */
export async function importarDocumentosRama(t: TenantContext, procesoId: string, idRegs?: string[]) {
  const empresaId = empresaIdOrThrow(t);
  const proceso = await prisma.proceso.findFirst({
    where: { id: procesoId, empresaId },
    select: { id: true, radicado: true, idProcesoRama: true, codigoInterno: true, empresa: { select: { id: true, nombre: true } } },
  });
  if (!proceso) throw new HttpError(404, "Proceso no encontrado");
  const idProceso = await resolverIdProceso(proceso.radicado, proceso.idProcesoRama);
  if (!idProceso) return { importados: 0, omitidos: 0, fallidos: 0 };

  const docs = await obtenerDocumentos(idProceso);
  const yaImport = await idRegsImportados(procesoId);
  const filtro = idRegs && idRegs.length ? new Set(idRegs.map(String)) : null;
  const objetivo = docs.filter((d) => (!filtro || filtro.has(String(d.idRegDocumento))) && !yaImport.has(String(d.idRegDocumento)));

  let importados = 0;
  let fallidos = 0;
  for (const d of objetivo) {
    try {
      const bin = await descargarDocumento(d.idRegDocumento);
      if (!bin) { fallidos++; continue; } // no es PDF o excede el tamaño máximo
      const nombre = (d.descripcion ?? `Documento ${d.idRegDocumento}`).trim();
      const subido = await subirDocumento({
        archivo: bin.buffer,
        nombreArchivo: `${nombre}.pdf`,
        documento: proceso.codigoInterno ?? proceso.id,
        carpeta: carpetaModulo(proceso.empresa, "PROCESOS"),
        tipo: "application/pdf",
      });
      await prisma.documentoProceso.create({
        data: {
          procesoId, nombre, url: subido.path, tipo: "application/pdf",
          subidoPorId: t.userId, categoria: categoriaDoc(nombre), origenRamaIdReg: String(d.idRegDocumento),
        },
      });
      importados++;
    } catch (err) {
      fallidos++;
      logger.warn("import doc rama falló", { procesoId, idReg: d.idRegDocumento, err: String(err) });
    }
    await dormir(env.ramaJudicial.delayRequestMs);
  }
  logger.info("documentos rama importados", { procesoId, importados, fallidos });
  return { importados, omitidos: docs.length - objetivo.length, fallidos };
}
