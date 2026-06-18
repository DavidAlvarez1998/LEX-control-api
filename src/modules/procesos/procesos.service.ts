// Servicio del módulo Procesos: casos de uso + orquestación (transacciones, motor
// de etapas, auto-título). El motor decisorio es PURO (maquina-etapas.ts), el acceso
// a datos vive en procesos.repository, la forma de salida en procesos.dto. Sin Express.
import { Prisma, RolEmpresa, RolParte, type EstadoProceso } from "@prisma/client";
import type { z } from "zod";
import { HttpError } from "../../middleware/error";
import { prisma } from "../../shared/prisma";
import { empresaIdOrThrow, type TenantContext } from "../../shared/tenant";
import { fusionarCorreos } from "../../correos";
import { convertirCliente } from "../clientes/clientes.service";
import { construirUrlDocumento, subirDocumento } from "../documentos/documentos.client";
import {
  type CampoEsquema, type EtapaDef, etapaEntrada, evaluarCondicion, validarDatosContraEsquema,
} from "./esquema";
import { derivarFechaLimite } from "./diasHabiles";
import { construirContexto, renderPlantilla } from "./plantilla";
import { siguienteEtapaAuto, terminalDecidido } from "./maquina-etapas";
import { ProcesosRepository } from "./procesos.repository";
import { crearSemaforo, serializeDetalle, toCasoNodo, toProcesoListItem } from "./procesos.dto";
import type {
  addParteSchema, createProcesoSchema, generarDocumentoSchema, moverEtapaSchema,
  updateParteSchema, updateProcesoSchema,
} from "./procesos.schemas";

type In<T extends z.ZodTypeAny> = z.infer<T>;
const repo = (t: TenantContext) => new ProcesosRepository(empresaIdOrThrow(t));

/**
 * Genera un `codigoInterno` secuencial por empresa y año, con prefijo (EXP/COM).
 * El `@@unique([empresaId, codigoInterno])` respalda la carrera. Corre dentro de tx.
 */
export async function generarCodigoInterno(
  tx: Prisma.TransactionClient,
  empresaId: string,
  prefijo: "EXP" | "COM" = "EXP",
): Promise<string> {
  const year = new Date().getFullYear();
  // TODO(api-hardening): derivar del último código (orderBy desc) en vez de count()
  // para reducir la colisión bajo concurrencia. Pendiente junto a la modernización de
  // los mocks de test (comercial.test fija `proceso.count`). El @@unique respalda la carrera.
  const usados = await tx.proceso.count({ where: { empresaId, codigoInterno: { startsWith: `${prefijo}-${year}-` } } });
  return `${prefijo}-${year}-${String(usados + 1).padStart(4, "0")}`;
}

/** Un COMERCIAL (sin JURIDICO ni admin de empresa) solo ve los procesos de SUS clientes. */
function scopeMisClientes(t: TenantContext): Prisma.ProcesoWhereInput | null {
  const roles = t.rolesEmpresa;
  const restringido = !t.esAdminEmpresa && roles.includes(RolEmpresa.COMERCIAL) && !roles.includes(RolEmpresa.JURIDICO);
  if (!restringido) return null;
  return { OR: [{ responsableId: t.userId }, { cliente: { responsableComercialId: t.userId } }] };
}

// ===================== LISTA / VENCIMIENTOS / CÁLCULO =====================
export async function listProcesos(t: TenantContext, query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const where: Prisma.ProcesoWhereInput = {
    ...(query.estado ? { estado: query.estado as EstadoProceso } : {}),
    ...(query.responsableId ? { responsableId: String(query.responsableId) } : {}),
    ...(query.radicado ? { radicado: String(query.radicado) } : {}),
    ...(query.area ? { tipoProceso: { areas: { some: { area: { slug: String(query.area) } } } } } : {}),
    ...(query.litiganteId ? { partes: { some: { litiganteId: String(query.litiganteId) } } } : {}),
    ...(q ? { OR: [{ codigoInterno: { contains: q } }, { titulo: { contains: q } }, { radicado: { contains: q } }, { cliente: { is: { nombre: { contains: q } } } }] } : {}),
  };
  const scope = scopeMisClientes(t);
  if (scope) Object.assign(where, scope);

  const [total, procesos] = await repo(t).countAndList(where, (page - 1) * pageSize, pageSize);
  const semaforo = crearSemaforo();
  return { total, page, pageSize, items: procesos.map((p) => toProcesoListItem(p as never, semaforo)) };
}

export async function vencimientos(t: TenantContext) {
  const items = (await repo(t).listVencimientos(scopeMisClientes(t) ?? {})).map((p) => ({ ...p, semaforo: crearSemaforo()(p.fechaLimite) }));
  return {
    vencido: items.filter((i) => i.semaforo === "vencido"),
    por_vencer: items.filter((i) => i.semaforo === "por_vencer"),
    al_dia: items.filter((i) => i.semaforo === "al_dia"),
  };
}

export async function calcularVencimiento(t: TenantContext, body: { tipoProcesoId?: string; datos?: Record<string, unknown>; desdeCampo?: string }) {
  if (!body.tipoProcesoId) throw new HttpError(400, "Falta tipoProcesoId");
  const empresaId = t.empresaId ?? null;
  const tipo = await new ProcesosRepository(empresaId ?? "").findTipoCalcular(body.tipoProcesoId);
  if (!tipo || (tipo.empresaId !== null && tipo.empresaId !== empresaId)) throw new HttpError(404, "Tipo de proceso no encontrado");
  const etapas = tipo.etapas as unknown as EtapaDef[];
  const conPlazo = body.desdeCampo ? etapas.find((e) => e.reglas?.plazoDesdeCampo === body.desdeCampo) : etapas.find((e) => e.reglas?.plazoDesdeCampo);
  const reglas = conPlazo?.reglas;
  const datos = body.datos ?? {};
  const fechaLimite = reglas ? derivarFechaLimite(reglas, datos) : null;
  let dias: number | null = null;
  if (reglas?.plazoDiasPorValorDe) dias = reglas.plazoDiasPorValorDe.mapa[String(datos[reglas.plazoDiasPorValorDe.campo] ?? "")] ?? null;
  else if (typeof reglas?.plazoDias === "number") dias = reglas.plazoDias;
  return { fechaLimite: fechaLimite ? fechaLimite.toISOString() : null, dias: dias != null && Number.isFinite(dias) ? dias : null, tipoDias: reglas?.plazoTipoDias ?? null, etapaKey: conPlazo?.key ?? null };
}

// ===================== CASO (cadena) =====================
export async function getCaso(t: TenantContext, id: string) {
  const r = repo(t);
  const inicial = await r.findCaso(id);
  if (!inicial) throw new HttpError(404, "Proceso no encontrado");
  let raiz = inicial;
  const vistos = new Set<string>([raiz.id]);
  while (raiz.casoRelacionadoId) {
    const padre = await r.findCaso(raiz.casoRelacionadoId);
    if (!padre || vistos.has(padre.id)) break;
    vistos.add(padre.id);
    raiz = padre;
  }
  const orden = [raiz];
  const enLista = new Set<string>([raiz.id]);
  const cola = [raiz.id];
  while (cola.length) {
    const hijos = await r.findCasoHijos(cola.shift()!);
    for (const h of hijos) {
      if (enLista.has(h.id)) continue;
      enLista.add(h.id);
      orden.push(h);
      cola.push(h.id);
    }
  }
  return orden.map((p) => toCasoNodo(p as never));
}

export async function getDetalle(t: TenantContext, id: string) {
  const proceso = await repo(t).findDetalle(id);
  if (!proceso) throw new HttpError(404, "Proceso no encontrado");
  return serializeDetalle(proceso);
}

// ===================== CREAR =====================
export async function createProceso(t: TenantContext, body: In<typeof createProcesoSchema>) {
  const empresaId = empresaIdOrThrow(t);
  const r = repo(t);
  const tipo = await r.findTipo(body.tipoProcesoId);
  if (!tipo || (tipo.empresaId !== null && tipo.empresaId !== empresaId)) throw new HttpError(404, "Tipo de proceso no encontrado");

  const esquema = tipo.esquemaFormulario as unknown as CampoEsquema[];
  const { ok, faltantes, errores } = validarDatosContraEsquema(esquema, body.datos);
  if (!ok) throw new HttpError(400, "Datos del formulario inválidos", { faltantes, errores });

  const entrada = etapaEntrada(tipo.etapas as unknown as EtapaDef[]);
  if (!entrada) throw new HttpError(400, "El tipo de proceso no define etapas");

  if (body.casoRelacionadoId && !(await r.findProcesoScopedId(body.casoRelacionadoId))) {
    throw new HttpError(400, "El caso relacionado no existe en tu despacho");
  }
  if (body.responsableId && !(await r.findUsuarioScoped(body.responsableId))) {
    throw new HttpError(400, "El responsable no pertenece a tu despacho");
  }
  const responsableId = body.responsableId ?? (t.rolesEmpresa.includes(RolEmpresa.JURIDICO) ? t.userId : undefined);

  const proceso = await prisma.$transaction(async (tx) => {
    const rt = new ProcesosRepository(empresaId, tx);
    let clienteVinculado: { clienteId: string; litiganteId: string } | null = null;
    if (body.cliente) {
      const clienteRow = body.cliente.clienteId
        ? await rt.findClienteScoped(body.cliente.clienteId)
        : await rt.createCliente({ ...body.cliente.nuevo!, ...fusionarCorreos(body.cliente.nuevo!) });
      if (!clienteRow) throw new HttpError(400, "El cliente no pertenece a tu despacho");
      const litiganteId = await convertirCliente(tx, clienteRow);
      clienteVinculado = { clienteId: clienteRow.id, litiganteId };
    }
    const codigoInterno = await generarCodigoInterno(tx, empresaId);
    const datosFinales: Record<string, unknown> = { ...(body.datos as Record<string, unknown>) };
    for (const campo of esquema) {
      if (campo.auto && !datosFinales[campo.key]) datosFinales[campo.key] = codigoInterno.replace(/^[A-Z]+/, "RAD");
    }
    const fechaLimiteEntrada = entrada.reglas?.plazoDesdeCampo ? derivarFechaLimite(entrada.reglas, datosFinales) : null;
    const creado = await rt.createProceso({
      codigoInterno, radicado: body.radicado, empresaId, tipoProcesoId: tipo.id, tipoEsquemaVersion: tipo.esquemaVersion,
      jurisdiccion: tipo.jurisdiccion, instancia: body.instancia, cuantiaTipo: body.cuantiaTipo,
      cuantiaValor: body.cuantiaValor != null ? new Prisma.Decimal(body.cuantiaValor) : null,
      despachoJuzgado: body.despachoJuzgado, casoRelacionadoId: body.casoRelacionadoId,
      clienteId: clienteVinculado?.clienteId, creadoPorId: t.userId, responsableId, titulo: body.titulo,
      datos: datosFinales as Prisma.InputJsonValue, fechaLimite: fechaLimiteEntrada, etapaActual: entrada.key,
      historial: { create: { etapaKey: entrada.key, usuarioId: t.userId } },
    });
    if (clienteVinculado && body.cliente) {
      await rt.createParte({ procesoId: creado.id, litiganteId: clienteVinculado.litiganteId, rol: body.cliente.rol, rolEtiqueta: body.cliente.rolEtiqueta, esNuestroCliente: true });
    }
    for (const p of body.partes) {
      let litiganteId = p.litiganteId;
      if (litiganteId) {
        if (!(await rt.findLitiganteScoped(litiganteId))) throw new HttpError(400, "Un litigante no pertenece a tu despacho");
      } else if (p.litigante) {
        litiganteId = (await rt.createLitigante({ ...p.litigante, ...fusionarCorreos(p.litigante) })).id;
      }
      await rt.createParte({ procesoId: creado.id, litiganteId: litiganteId!, rol: p.rol, rolEtiqueta: p.rolEtiqueta, esNuestroCliente: p.esNuestroCliente });
    }
    return rt.findDetalleById(creado.id);
  });
  return serializeDetalle(proceso);
}

// ===================== MOVER ETAPA =====================
export async function moverEtapa(t: TenantContext, id: string, body: In<typeof moverEtapaSchema>) {
  const empresaId = empresaIdOrThrow(t);
  const r = repo(t);
  const proceso = await r.findParaEtapa(id);
  if (!proceso) throw new HttpError(404, "Proceso no encontrado");
  if (proceso.estado === "ARCHIVADO") throw new HttpError(400, "El proceso está archivado; no se puede mover de etapa");

  const etapas = proceso.tipoProceso.etapas as unknown as EtapaDef[];
  const destino = etapas.find((e) => e.key === body.etapaKey);
  if (!destino) throw new HttpError(400, "Etapa inválida para este tipo de proceso");
  const ordenActual = etapas.find((e) => e.key === proceso.etapaActual)?.orden ?? 0;
  const esRetroceso = destino.orden < ordenActual;
  const datos = proceso.datos as Record<string, unknown>;

  if (destino.disponibleSi && !evaluarCondicion(destino.disponibleSi, datos)) {
    throw new HttpError(422, "Esa etapa no está disponible con los datos actuales del proceso", { condicion: destino.disponibleSi });
  }
  const reglas = destino.reglas;
  const camposReq = [...(reglas?.camposRequeridos ?? []), ...(reglas?.requeridosSi ?? []).filter((x) => evaluarCondicion(x.si, datos)).flatMap((x) => x.camposRequeridos ?? [])];
  const docsReq = [...(reglas?.documentosRequeridos ?? []), ...(reglas?.requeridosSi ?? []).filter((x) => evaluarCondicion(x.si, datos)).flatMap((x) => x.documentosRequeridos ?? [])];
  const faltantes = [...new Set(camposReq)].filter((k) => { const v = datos[k]; return v === undefined || v === null || v === ""; });
  const docsPresentes = new Set(proceso.documentos.map((d) => d.nombre.trim().toLowerCase()));
  const documentosFaltantes = [...new Set(docsReq)].filter((nombre) => !docsPresentes.has(nombre.trim().toLowerCase()));
  if (!esRetroceso && (faltantes.length > 0 || documentosFaltantes.length > 0)) {
    throw new HttpError(400, "No puedes avanzar: faltan requisitos", { faltantes, documentosFaltantes });
  }
  const esTransicion = destino.key !== proceso.etapaActual;
  const nuevaFechaLimite = esTransicion && reglas?.plazoDesdeCampo ? derivarFechaLimite(reglas, datos) : undefined;

  const actualizado = await prisma.$transaction(async (tx) => {
    const rt = new ProcesosRepository(empresaId, tx);
    await rt.createEtapa({ procesoId: proceso.id, etapaKey: destino.key, nota: body.nota, usuarioId: t.userId });
    return rt.updateProcesoConDetalle(proceso.id, {
      etapaActual: destino.key,
      estado: destino.terminal ? "CERRADO" : "EN_PROCESO",
      ...(nuevaFechaLimite !== undefined ? { fechaLimite: nuevaFechaLimite } : {}),
    });
  });
  return serializeDetalle(actualizado);
}

// ===================== DERIVAR =====================
export async function derivar(t: TenantContext, id: string) {
  const empresaId = empresaIdOrThrow(t);
  const r = repo(t);
  const proceso = await r.findParaDerivar(id);
  if (!proceso) throw new HttpError(404, "Proceso no encontrado");
  const etapas = proceso.tipoProceso.etapas as unknown as EtapaDef[];
  const accion = etapas.find((e) => e.key === proceso.etapaActual)?.accion;
  if (!accion || accion.tipo !== "crearDerivado") throw new HttpError(400, "La etapa actual no define una acción de derivación");

  const tipoDestino = await r.findTipoGlobalPorNombre(accion.tipoDestinoNombre);
  if (!tipoDestino) throw new HttpError(422, `No existe el tipo global "${accion.tipoDestinoNombre}"`);
  const existente = await r.findDerivadoExistente(proceso.id, tipoDestino.id);
  if (existente) throw new HttpError(409, "Ya existe un proceso derivado de este tipo", { procesoId: existente.id, codigoInterno: existente.codigoInterno });
  const entrada = etapaEntrada(tipoDestino.etapas as unknown as EtapaDef[]);
  if (!entrada) throw new HttpError(400, "El tipo destino no define etapas");

  const baseDatos = proceso.datos as Record<string, unknown>;
  const datosCopiados: Record<string, unknown> = {};
  for (const k of accion.copiarDatos ?? []) if (baseDatos[k] !== undefined) datosCopiados[k] = baseDatos[k];

  const derivado = await prisma.$transaction(async (tx) => {
    const rt = new ProcesosRepository(empresaId, tx);
    let clienteCopia: { clienteId: string; litiganteId: string } | null = null;
    if (accion.copiarCliente && proceso.clienteId) {
      const cli = await rt.findClienteScoped(proceso.clienteId);
      if (cli) clienteCopia = { clienteId: cli.id, litiganteId: cli.litiganteId ?? (await convertirCliente(tx, cli)) };
    }
    const codigoInterno = await generarCodigoInterno(tx, empresaId);
    const creado = await rt.createProceso({
      codigoInterno, empresaId, tipoProcesoId: tipoDestino.id, tipoEsquemaVersion: tipoDestino.esquemaVersion,
      jurisdiccion: tipoDestino.jurisdiccion, casoRelacionadoId: proceso.id, clienteId: clienteCopia?.clienteId,
      creadoPorId: t.userId, responsableId: proceso.responsableId, titulo: `${tipoDestino.nombre} — ${proceso.titulo}`,
      datos: datosCopiados as Prisma.InputJsonValue, etapaActual: entrada.key,
      historial: { create: { etapaKey: entrada.key, usuarioId: t.userId } },
    });
    if (clienteCopia) {
      await rt.createParte({ procesoId: creado.id, litiganteId: clienteCopia.litiganteId, esNuestroCliente: true, rol: tipoDestino.esJudicial ? RolParte.ACCIONANTE : RolParte.OTRO, rolEtiqueta: tipoDestino.esJudicial ? undefined : "Peticionario" });
    }
    const nombresHeredar = (accion.copiarDocumentos ?? []).map((n) => n.trim().toLowerCase());
    if (nombresHeredar.length > 0) {
      const baseDocs = await rt.findBaseDocs(proceso.id);
      const aHeredar = baseDocs.filter((d) => nombresHeredar.includes(d.nombre.trim().toLowerCase()));
      if (aHeredar.length > 0) {
        await rt.createManyDocs(aHeredar.map((d) => ({ procesoId: creado.id, nombre: d.nombre, url: d.url, contenido: d.contenido, generadoDePlantilla: d.generadoDePlantilla })));
      }
    }
    return rt.findDetalleById(creado.id);
  });
  return serializeDetalle(derivado);
}

// ===================== PATCH /:id =====================
export async function updateProceso(t: TenantContext, id: string, body: In<typeof updateProcesoSchema>) {
  const empresaId = empresaIdOrThrow(t);
  const r = repo(t);
  const existe = await r.findParaPatch(id);
  if (!existe) throw new HttpError(404, "Proceso no encontrado");

  if (body.datos !== undefined) {
    const esquema = existe.tipoProceso.esquemaFormulario as unknown as CampoEsquema[];
    const { ok, errores, faltantes } = validarDatosContraEsquema(esquema, body.datos, { exigirRequeridos: false });
    if (!ok) throw new HttpError(400, "Datos del formulario inválidos", { faltantes, errores });
  }
  if (body.responsableId && !(await r.findUsuarioScoped(body.responsableId))) {
    throw new HttpError(400, "El responsable no pertenece a tu despacho");
  }
  const data: Prisma.ProcesoUpdateInput = {
    ...(body.titulo !== undefined ? { titulo: body.titulo, tituloManual: true } : {}),
    ...(body.radicado !== undefined ? { radicado: body.radicado } : {}),
    ...(body.despachoJuzgado !== undefined ? { despachoJuzgado: body.despachoJuzgado } : {}),
    ...(body.instancia !== undefined ? { instancia: body.instancia } : {}),
    ...(body.cuantiaTipo !== undefined ? { cuantiaTipo: body.cuantiaTipo } : {}),
    ...(body.cuantiaValor !== undefined ? { cuantiaValor: body.cuantiaValor != null ? new Prisma.Decimal(body.cuantiaValor) : null } : {}),
    ...(body.proximaAudiencia !== undefined ? { proximaAudiencia: body.proximaAudiencia ? new Date(body.proximaAudiencia) : null } : {}),
    ...(body.fechaLimite !== undefined ? { fechaLimite: body.fechaLimite ? new Date(body.fechaLimite) : null } : {}),
    ...(body.datos !== undefined ? { datos: body.datos as Prisma.InputJsonValue } : {}),
    ...(body.estado !== undefined ? { estado: body.estado } : {}),
    ...(body.prioridad !== undefined ? { prioridad: body.prioridad } : {}),
    ...(body.responsableId !== undefined ? { responsable: body.responsableId ? { connect: { id: body.responsableId } } : { disconnect: true } } : {}),
  };
  await r.updateProceso(existe.id, data);
  if (body.datos !== undefined) await autoavanzarEtapas(empresaId, existe.id, t.userId);
  const proceso = await r.findDetalle(existe.id);
  return serializeDetalle(proceso);
}

/** Avanza el proceso TODAS las etapas que pueda con los datos/documentos actuales. */
async function autoavanzarEtapas(empresaId: string, procesoId: string, usuarioId: string): Promise<void> {
  const r = new ProcesosRepository(empresaId);
  for (let i = 0; i < 25; i++) {
    const p = await r.findParaAutoavance(procesoId);
    if (!p || p.estado === "ARCHIVADO") return;
    const etapas = p.tipoProceso?.etapas as unknown as EtapaDef[] | undefined;
    if (!Array.isArray(etapas) || etapas.length === 0) return;
    const datos = (p.datos ?? {}) as Record<string, unknown>;
    const docs = (p.documentos ?? []).map((d) => d.nombre);
    const next = siguienteEtapaAuto(etapas, p.etapaActual, datos, docs) ?? terminalDecidido(etapas, p.etapaActual, datos, docs);
    if (!next) return;
    const fechaLimite = next.reglas?.plazoDesdeCampo ? derivarFechaLimite(next.reglas, datos) : undefined;
    await prisma.$transaction(async (tx) => {
      const rt = new ProcesosRepository(empresaId, tx);
      await rt.createEtapa({ procesoId: p.id, etapaKey: next.key, usuarioId, nota: "Avance automático (datos completos)" });
      await rt.updateProceso(p.id, { etapaActual: next.key, estado: next.terminal ? "CERRADO" : "EN_PROCESO", ...(fechaLimite !== undefined ? { fechaLimite } : {}) });
    });
  }
}

/** Recalcula el título de LITIGIO "demandante vs. demandado" tras cambiar partes (salvo título
 *  manual). Aplica al laboral y a los verbales civiles (CGP): litigio entre dos partes. */
async function recomputarTituloLaboral(empresaId: string, procesoId: string): Promise<void> {
  const r = new ProcesosRepository(empresaId);
  const proceso = await r.findParaRecompute(procesoId);
  if (!proceso || proceso.tituloManual) return;
  const esLitigioVs =
    proceso.tipoProceso.grupo === "LABORAL" ||
    ["Proceso verbal", "Proceso verbal sumario"].includes(proceso.tipoProceso.nombre);
  if (!esLitigioVs) return;
  const otras = proceso.partes.filter((p) => !p.esNuestroCliente);
  const nombreCliente = proceso.partes.find((p) => p.esNuestroCliente)?.litigante.nombre.trim() ?? "";
  const contraparte = (otras.find((p) => p.rol === RolParte.DEMANDADO) ?? otras[0])?.litigante.nombre.trim() ?? "";
  const representamosDemandado = String((proceso.datos as { rol?: unknown })?.rol ?? "") === "Demandado";
  const partesTit = [representamosDemandado ? contraparte : nombreCliente, representamosDemandado ? nombreCliente : contraparte].filter(Boolean).join(" vs. ");
  const titulo = [proceso.tipoProceso.nombre, partesTit].filter(Boolean).join(" — ");
  if (titulo && titulo !== proceso.titulo) await r.updateTitulo(procesoId, titulo);
}

// ===================== PARTES =====================
export async function agregarParte(t: TenantContext, procesoId: string, p: In<typeof addParteSchema>) {
  const empresaId = empresaIdOrThrow(t);
  const r = repo(t);
  if (!(await r.findProcesoScopedId(procesoId))) throw new HttpError(404, "Proceso no encontrado");
  let litiganteId = p.litiganteId;
  if (litiganteId) {
    if (!(await r.findLitiganteScoped(litiganteId))) throw new HttpError(400, "El litigante no pertenece a tu despacho");
  } else if (p.litigante) {
    litiganteId = (await r.createLitigante({ ...p.litigante, ...fusionarCorreos(p.litigante) })).id;
  }
  try {
    await r.createParte({ procesoId, litiganteId: litiganteId!, rol: p.rol, rolEtiqueta: p.rolEtiqueta, esNuestroCliente: false });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new HttpError(409, "Esa parte ya está registrada con ese rol");
    throw err;
  }
  await recomputarTituloLaboral(empresaId, procesoId);
  return serializeDetalle(await r.findDetalle(procesoId));
}

export async function editarParte(t: TenantContext, procesoId: string, parteId: string, body: In<typeof updateParteSchema>) {
  const empresaId = empresaIdOrThrow(t);
  const r = repo(t);
  const parte = await r.findParte(parteId, procesoId);
  if (!parte) throw new HttpError(404, "Parte no encontrada");
  if (body.litigante) {
    const l = body.litigante;
    const correosPatch = l.correos !== undefined || l.email !== undefined ? fusionarCorreos(l) : {};
    await r.updateLitigante(parte.litiganteId, {
      ...(l.nombre !== undefined ? { nombre: l.nombre } : {}),
      ...(l.tipoPersona !== undefined ? { tipoPersona: l.tipoPersona } : {}),
      ...(l.tipoDocumento !== undefined ? { tipoDocumento: l.tipoDocumento } : {}),
      ...(l.numeroDocumento !== undefined ? { numeroDocumento: l.numeroDocumento } : {}),
      ...(l.telefono !== undefined ? { telefono: l.telefono } : {}),
      ...correosPatch,
    });
  }
  if (body.rol !== undefined || body.rolEtiqueta !== undefined) {
    try {
      await r.updateParte(parte.id, { ...(body.rol !== undefined ? { rol: body.rol } : {}), ...(body.rolEtiqueta !== undefined ? { rolEtiqueta: body.rolEtiqueta } : {}) });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new HttpError(409, "Esa parte ya está registrada con ese rol");
      throw err;
    }
  }
  await recomputarTituloLaboral(empresaId, procesoId);
  return serializeDetalle(await r.findDetalle(procesoId));
}

export async function eliminarParte(t: TenantContext, procesoId: string, parteId: string) {
  const empresaId = empresaIdOrThrow(t);
  const r = repo(t);
  const parte = await r.findParteParaBorrar(parteId, procesoId);
  if (!parte) throw new HttpError(404, "Parte no encontrada");
  if (parte.esNuestroCliente) throw new HttpError(400, "No se puede quitar a nuestro cliente del proceso");
  await r.deleteParte(parte.id);
  await recomputarTituloLaboral(empresaId, procesoId);
  return serializeDetalle(await r.findDetalle(procesoId));
}

// ===================== PLANTILLAS / DOCUMENTOS =====================
export async function listPlantillas(t: TenantContext, id: string) {
  const r = repo(t);
  const proceso = await r.findProcesoTipoCaso(id);
  if (!proceso) throw new HttpError(404, "Proceso no encontrado");
  const plantillas = await r.listPlantillas(proceso.tipoProcesoId);
  const esDerivado = proceso.casoRelacionadoId != null;
  return plantillas.filter((p) => esDerivado || !p.contenido.includes("casoBase")).map(({ id: pid, nombre }) => ({ id: pid, nombre }));
}

export async function adjuntarDocumento(t: TenantContext, id: string, body: { nombre: string; url: string }) {
  const r = repo(t);
  if (!(await r.findProcesoScopedId(id))) throw new HttpError(404, "Proceso no encontrado");
  return r.createDocumento({ procesoId: id, nombre: body.nombre, url: body.url });
}

async function plantillaRenderizada(t: TenantContext, id: string, body: In<typeof generarDocumentoSchema>) {
  const r = repo(t);
  const proceso = await r.findProcesoConPartes(id);
  if (!proceso) throw new HttpError(404, "Proceso no encontrado");
  const plantilla = await r.findPlantillaDeTipo(body.plantillaId, proceso.tipoProcesoId);
  if (!plantilla) throw new HttpError(404, "Plantilla no encontrada para este tipo de proceso");
  if (plantilla.contenido.includes("casoBase") && proceso.casoRelacionadoId == null) {
    throw new HttpError(422, "Esta plantilla solo aplica a una reiteración (proceso derivado de otro).");
  }
  const casoBase = proceso.casoRelacionadoId ? await r.findCasoBase(proceso.casoRelacionadoId) : null;
  const contenido = renderPlantilla(plantilla.contenido, construirContexto(proceso, casoBase));
  return { proceso, plantilla, contenido };
}

export async function generarDocumento(t: TenantContext, id: string, body: In<typeof generarDocumentoSchema>) {
  const { plantilla, contenido } = await plantillaRenderizada(t, id, body);
  return repo(t).createDocumento({ procesoId: id, nombre: body.nombre ?? plantilla.nombre, contenido, generadoDePlantilla: plantilla.id });
}

export async function renderDocumento(t: TenantContext, id: string, body: In<typeof generarDocumentoSchema>) {
  const { plantilla, contenido } = await plantillaRenderizada(t, id, body);
  return { nombre: body.nombre ?? plantilla.nombre, contenido };
}

export async function subirArchivo(t: TenantContext, id: string, file: { buffer: Buffer; originalname: string; mimetype: string } | undefined, nombreIn?: string) {
  const r = repo(t);
  const proceso = await r.findProcesoCodigo(id);
  if (!proceso) throw new HttpError(404, "Proceso no encontrado");
  if (!file) throw new HttpError(400, "No se recibió ningún archivo");
  const nombre = (typeof nombreIn === "string" && nombreIn.trim()) || file.originalname;
  const subido = await subirDocumento({ archivo: file.buffer, nombreArchivo: file.originalname, documento: proceso.codigoInterno ?? proceso.id, carpeta: "procesos", tipo: file.mimetype });
  const doc = await r.createDocumento({ procesoId: proceso.id, nombre, url: subido.path });
  return { ...doc, url: construirUrlDocumento(doc.url) };
}

export async function editarDocumento(t: TenantContext, id: string, docId: string, body: { nombre?: string; contenido?: string }) {
  const r = repo(t);
  const doc = await r.findDocumento(docId, id);
  if (!doc) throw new HttpError(404, "Documento no encontrado");
  return r.updateDocumento(doc.id, { ...(body.nombre !== undefined ? { nombre: body.nombre } : {}), ...(body.contenido !== undefined ? { contenido: body.contenido } : {}) });
}

export async function eliminarDocumento(t: TenantContext, id: string, docId: string): Promise<void> {
  const r = repo(t);
  const doc = await r.findDocumento(docId, id);
  if (!doc) throw new HttpError(404, "Documento no encontrado");
  await r.deleteDocumento(doc.id);
}
