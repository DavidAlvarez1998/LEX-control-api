// Módulo CRM: clientes/prospectos del despacho. Scoped por empresa (empresaId
// SIEMPRE del token). Protegido por requirePermiso("cliente.*") — puerta de
// módulo (comercial contratado) + RBAC. Ver
// openspec/changes/foundations-roles-plans-clientes/.
import { Router } from "express";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import { empresaIdRequerido, requireAuth, requirePermiso } from "../../middleware/auth";
import { HttpError } from "../../middleware/error";
import { validate } from "../../middleware/validate";
import {
  clienteIdParams,
  createClienteSchema,
  updateClienteSchema,
} from "./clientes.schemas";
import { convertirCliente } from "./clientes.service";

export const clienteRoutes: Router = Router();

/**
 * Valida que las FK salientes de un Cliente apunten a la MISMA empresa (B3): no
 * hay constraint en BD que lo impida, así que se exige en la app. El
 * `necesidadTipoProcesoId` puede ser un tipo global (empresaId null) o del propio
 * despacho.
 */
async function assertSameEmpresa(
  empresaId: string,
  data: {
    responsableComercialId?: string | null;
    necesidadTipoProcesoId?: string | null;
    litiganteId?: string | null;
  },
) {
  if (data.responsableComercialId) {
    const u = await prisma.usuario.findUnique({
      where: { id: data.responsableComercialId },
      select: { empresaId: true },
    });
    if (!u || u.empresaId !== empresaId) {
      throw new HttpError(400, "El responsable comercial no pertenece a tu empresa");
    }
  }
  if (data.litiganteId) {
    const l = await prisma.litigante.findUnique({
      where: { id: data.litiganteId },
      select: { empresaId: true },
    });
    if (!l || l.empresaId !== empresaId) {
      throw new HttpError(400, "El litigante no pertenece a tu empresa");
    }
  }
  if (data.necesidadTipoProcesoId) {
    const t = await prisma.tipoProceso.findUnique({
      where: { id: data.necesidadTipoProcesoId },
      select: { empresaId: true },
    });
    // Global (null) o de la propia empresa.
    if (!t || (t.empresaId !== null && t.empresaId !== empresaId)) {
      throw new HttpError(400, "El tipo de proceso no es válido para tu empresa");
    }
  }
}

/**
 * GET /clientes — lista del despacho.
 * Filtros opcionales: `?estado=`. Con `?mios=true` solo los del usuario actual:
 * los que lleva comercialmente (responsableComercial) o de los que es abogado
 * responsable en algún proceso — la unión, no un muro de visibilidad.
 */
clienteRoutes.get(
  "/",
  requireAuth,
  requirePermiso("cliente.ver"),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const estado =
      typeof req.query.estado === "string" ? req.query.estado : undefined;
    const mios = req.query.mios === "true";
    const usuarioId = req.user!.sub;
    const clientes = await prisma.cliente.findMany({
      where: {
        empresaId,
        ...(estado ? { estado: estado as never } : {}),
        ...(mios
          ? {
              OR: [
                { responsableComercialId: usuarioId },
                { procesos: { some: { responsableId: usuarioId } } },
              ],
            }
          : {}),
      },
      orderBy: { fechaIngreso: "desc" },
      include: { responsableComercial: { select: { id: true, nombre: true } } },
    });
    res.json(clientes);
  }),
);

/** GET /clientes/:id — un cliente del despacho. */
clienteRoutes.get(
  "/:id",
  requireAuth,
  requirePermiso("cliente.ver"),
  validate({ params: clienteIdParams }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const cliente = await prisma.cliente.findFirst({
      where: { id: req.params.id, empresaId },
      include: { responsableComercial: { select: { id: true, nombre: true } } },
    });
    if (!cliente) throw new HttpError(404, "Cliente no encontrado");
    res.json(cliente);
  }),
);

/** POST /clientes — crea un prospecto. empresaId del token; FK validadas. */
clienteRoutes.post(
  "/",
  requireAuth,
  requirePermiso("cliente.crear"),
  validate({ body: createClienteSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    await assertSameEmpresa(empresaId, req.body);
    const cliente = await prisma.cliente.create({
      // El responsable por defecto es quien lo crea (queda "dueño" para atribución
      // y para el filtro "Míos"); el admin puede asignar otro vía el body.
      data: {
        ...req.body,
        empresaId, // estado=PROSPECTO por default del schema
        responsableComercialId: req.body.responsableComercialId ?? req.user!.sub,
      },
    });
    res.status(201).json(cliente);
  }),
);

/** PATCH /clientes/:id — edita un cliente del despacho (no convierte a CLIENTE). */
clienteRoutes.patch(
  "/:id",
  requireAuth,
  requirePermiso("cliente.editar"),
  validate({ params: clienteIdParams, body: updateClienteSchema }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const actual = await prisma.cliente.findFirst({
      where: { id: req.params.id, empresaId },
      select: { id: true },
    });
    if (!actual) throw new HttpError(404, "Cliente no encontrado");
    await assertSameEmpresa(empresaId, req.body);
    const cliente = await prisma.cliente.update({
      where: { id: actual.id },
      data: req.body,
    });
    res.json(cliente);
  }),
);

/**
 * POST /clientes/:id/convertir — PROSPECTO → CLIENTE. Vincula (find-or-create)
 * un Litigante por (empresaId, tipoDocumento, numeroDocumento); si el cliente no
 * tiene documento, crea un Litigante nuevo. Estampa `convertidoEn`.
 */
clienteRoutes.post(
  "/:id/convertir",
  requireAuth,
  requirePermiso("cliente.convertir"),
  validate({ params: clienteIdParams }),
  asyncHandler(async (req, res) => {
    const empresaId = empresaIdRequerido(req);
    const cliente = await prisma.cliente.findFirst({
      where: { id: req.params.id, empresaId },
    });
    if (!cliente) throw new HttpError(404, "Cliente no encontrado");

    // Lógica compartida (find-or-create Litigante + estado=CLIENTE), también
    // usada por la fase FIRMADO y el puente de asignación de procesos.
    const actualizado = await prisma.$transaction(async (tx) => {
      await convertirCliente(tx, cliente);
      return tx.cliente.findUnique({ where: { id: cliente.id } });
    });
    res.json(actualizado);
  }),
);
