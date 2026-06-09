import { type Request, Router } from "express";
import multer from "multer";
import { CategoriaDocumento, Rol } from "@prisma/client";
import { prisma } from "../../index";
import { asyncHandler } from "../../middleware/async";
import { requireAuth } from "../../middleware/auth";
import { HttpError } from "../../middleware/error";
import { validate } from "../../middleware/validate";
import { construirUrlDocumento, subirDocumento } from "../documentos/documentos.client";
import {
  contratoIdParams,
  type CreateContratoInput,
  createContratoSchema,
  createDocumentoSchema,
  documentoIdParams,
  type UpdateContratoInput,
  updateContratoSchema,
} from "./contratos.schemas";

export const contratoRoutes: Router = Router();

// Subida en memoria (máx 15 MB); el buffer se reenvía a la API documental.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Subcarpeta {CARPETA} en la API documental para los adjuntos de contratos.
const CARPETA = "contratos";

const includeDocs = { documentos: { orderBy: { createdAt: "desc" as const } } };

/** Ámbito de gestión de quien hace la petición. */
type Scope = { tipo: "EMPRESA"; empresaId: string } | { tipo: "PLATAFORMA" };

/**
 * Resuelve el ámbito que ADMINISTRA contratos:
 *  • ADMIN de plataforma → contratos del personal de la plataforma (empresaId null).
 *  • USUARIO + esAdminEmpresa → contratos de SU empresa.
 * Cualquier otro (USUARIO común) no gestiona: usa /contratos/mio. El ámbito sale
 * SIEMPRE del token, nunca del body (no se puede cruzar de empresa).
 */
function managerScope(req: Request): Scope | null {
  if (req.user!.rol === Rol.ADMIN) return { tipo: "PLATAFORMA" };
  if (req.user!.rol === Rol.USUARIO && req.esAdminEmpresa && req.empresaId) {
    return { tipo: "EMPRESA", empresaId: req.empresaId };
  }
  return null;
}

/** Filtro Prisma que aísla los contratos del ámbito. */
function scopeWhere(scope: Scope) {
  return scope.tipo === "PLATAFORMA"
    ? { empresaId: null }
    : { empresaId: scope.empresaId };
}

/** ¿Puede `req` gestionar este contrato (según su ámbito)? */
function canManage(req: Request, contrato: { empresaId: string | null }): boolean {
  const scope = managerScope(req);
  if (!scope) return false;
  return scope.tipo === "PLATAFORMA"
    ? contrato.empresaId === null
    : contrato.empresaId === scope.empresaId;
}

/** Añade la URL pública a cada documento del contrato. */
function serialize<T extends { documentos: { path: string }[] }>(c: T) {
  return {
    ...c,
    documentos: c.documentos.map((d) => ({ ...d, url: construirUrlDocumento(d.path) })),
  };
}

/**
 * Valida que el `usuarioId` enlazado pertenezca al ámbito del contrato. Evita
 * que un admin de empresa enlace a alguien de otra empresa, o que el ADMIN
 * enlace a un usuario de despacho como si fuera personal de plataforma.
 */
async function assertUsuarioEnAmbito(usuarioId: string, scope: Scope): Promise<void> {
  const u = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { empresaId: true },
  });
  if (!u) throw new HttpError(404, "Usuario no encontrado");
  if (scope.tipo === "EMPRESA" && u.empresaId !== scope.empresaId) {
    throw new HttpError(400, "El usuario no pertenece a tu empresa");
  }
  if (scope.tipo === "PLATAFORMA" && u.empresaId !== null) {
    throw new HttpError(400, "El usuario no es personal de la plataforma");
  }
}

// ── Vista del propio usuario ────────────────────────────────────────────────

/** GET /contratos/mio — los contratos de la persona logueada (su historial).
 *  Sirve la pantalla "Mi Contrato" tanto a personal de despacho como a los
 *  comerciales de la plataforma. Lista (posiblemente vacía). */
contratoRoutes.get(
  "/mio",
  requireAuth,
  asyncHandler(async (req, res) => {
    const contratos = await prisma.contrato.findMany({
      where: { usuarioId: req.user!.sub },
      include: includeDocs,
      orderBy: { createdAt: "desc" },
    });
    res.json(contratos.map(serialize));
  }),
);

// ── Reportes (solo gestor del ámbito) ────────────────────────────────────────

/** GET /contratos/reportes — nº de contratos por estado y vencimientos próximos
 *  (≤ 60 días, estado ACTIVO) del ámbito. */
contratoRoutes.get(
  "/reportes",
  requireAuth,
  asyncHandler(async (req, res) => {
    const scope = managerScope(req);
    if (!scope) throw new HttpError(403, "No autorizado");
    const where = scopeWhere(scope);

    const ahora = new Date();
    const limite = new Date(ahora.getTime() + 60 * 24 * 60 * 60 * 1000);

    const [total, porEstado, vencimientos] = await Promise.all([
      prisma.contrato.count({ where }),
      prisma.contrato.groupBy({ by: ["estado"], where, _count: { estado: true } }),
      prisma.contrato.findMany({
        where: { ...where, estado: "ACTIVO", fechaFin: { gte: ahora, lte: limite } },
        select: { id: true, nombreCompleto: true, fechaFin: true },
        orderBy: { fechaFin: "asc" },
      }),
    ]);

    res.json({
      total,
      porEstado: Object.fromEntries(porEstado.map((e) => [e.estado, e._count.estado])),
      vencimientos,
    });
  }),
);

// ── Gestión (gestor del ámbito) ──────────────────────────────────────────────

/** GET /contratos — lista los contratos del ámbito del gestor. */
contratoRoutes.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const scope = managerScope(req);
    if (!scope) throw new HttpError(403, "No autorizado");
    const contratos = await prisma.contrato.findMany({
      where: scopeWhere(scope),
      include: includeDocs,
      orderBy: { createdAt: "desc" },
    });
    res.json(contratos.map(serialize));
  }),
);

/** POST /contratos — crea un contrato en el ámbito del gestor. El empresaId lo
 *  fija el servidor (empresa del admin, o null para la plataforma). */
contratoRoutes.post(
  "/",
  requireAuth,
  validate({ body: createContratoSchema }),
  asyncHandler(async (req, res) => {
    const scope = managerScope(req);
    if (!scope) throw new HttpError(403, "No autorizado");

    const data = req.body as CreateContratoInput;
    if (data.usuarioId) await assertUsuarioEnAmbito(data.usuarioId, scope);

    const contrato = await prisma.contrato.create({
      data: {
        ...data,
        empresaId: scope.tipo === "EMPRESA" ? scope.empresaId : null,
      },
      include: includeDocs,
    });
    res.status(201).json(serialize(contrato));
  }),
);

/** GET /contratos/:id — un contrato. Lo ve su gestor o el dueño (usuarioId). */
contratoRoutes.get(
  "/:id",
  requireAuth,
  validate({ params: contratoIdParams }),
  asyncHandler(async (req, res) => {
    const contrato = await prisma.contrato.findUnique({
      where: { id: req.params.id },
      include: includeDocs,
    });
    if (!contrato) throw new HttpError(404, "Contrato no encontrado");
    if (!canManage(req, contrato) && contrato.usuarioId !== req.user!.sub) {
      throw new HttpError(403, "No autorizado");
    }
    res.json(serialize(contrato));
  }),
);

/** PATCH /contratos/:id — edita un contrato. Solo el gestor (el dueño no edita
 *  sus propios términos; solo sube documentos). */
contratoRoutes.patch(
  "/:id",
  requireAuth,
  validate({ params: contratoIdParams, body: updateContratoSchema }),
  asyncHandler(async (req, res) => {
    const contrato = await prisma.contrato.findUnique({
      where: { id: req.params.id },
      select: { empresaId: true },
    });
    if (!contrato) throw new HttpError(404, "Contrato no encontrado");
    if (!canManage(req, contrato)) throw new HttpError(403, "No autorizado");

    const data = req.body as UpdateContratoInput;
    if (data.usuarioId) await assertUsuarioEnAmbito(data.usuarioId, managerScope(req)!);

    const updated = await prisma.contrato.update({
      where: { id: req.params.id },
      data,
      include: includeDocs,
    });
    res.json(serialize(updated));
  }),
);

/** DELETE /contratos/:id — elimina un contrato (cascada a sus documentos). Solo
 *  el gestor. No borra el binario en la API documental (no expone delete). */
contratoRoutes.delete(
  "/:id",
  requireAuth,
  validate({ params: contratoIdParams }),
  asyncHandler(async (req, res) => {
    const contrato = await prisma.contrato.findUnique({
      where: { id: req.params.id },
      select: { empresaId: true },
    });
    if (!contrato) throw new HttpError(404, "Contrato no encontrado");
    if (!canManage(req, contrato)) throw new HttpError(403, "No autorizado");

    await prisma.contrato.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ── Documentos del contrato ──────────────────────────────────────────────────

/** POST /contratos/:id/documentos — sube un archivo (multipart) a la API
 *  documental y guarda su metadata. Lo hace el gestor o el dueño del contrato
 *  (autoservicio: cada quien sube SUS documentos). */
contratoRoutes.post(
  "/:id/documentos",
  requireAuth,
  upload.single("file"),
  validate({ params: contratoIdParams, body: createDocumentoSchema }),
  asyncHandler(async (req, res) => {
    const contrato = await prisma.contrato.findUnique({
      where: { id: req.params.id },
      select: { id: true, empresaId: true, usuarioId: true, numeroDocumento: true },
    });
    if (!contrato) throw new HttpError(404, "Contrato no encontrado");
    const esDueno = contrato.usuarioId === req.user!.sub;
    if (!canManage(req, contrato) && !esDueno) throw new HttpError(403, "No autorizado");
    if (!req.file) throw new HttpError(400, "Falta el archivo (campo `file`)");

    const { categoria, nombre, tipo } = req.body as {
      categoria: string;
      nombre: string;
      tipo?: string;
    };
    const mime = tipo ?? req.file.mimetype;

    const subido = await subirDocumento({
      archivo: req.file.buffer,
      nombreArchivo: req.file.originalname,
      // Id del dueño para componer el filename (cédula del contratado o su id).
      documento: contrato.numeroDocumento ?? contrato.usuarioId ?? contrato.id,
      carpeta: CARPETA,
      tipo: mime,
    });

    const doc = await prisma.documentoContrato.create({
      data: { contratoId: contrato.id, categoria: categoria as CategoriaDocumento, nombre, path: subido.path, tipo: mime },
    });
    res.status(201).json({ ...doc, url: construirUrlDocumento(doc.path) });
  }),
);

/** DELETE /contratos/:id/documentos/:docId — quita la metadata de un documento
 *  (el binario permanece en la API documental). Gestor o dueño. */
contratoRoutes.delete(
  "/:id/documentos/:docId",
  requireAuth,
  validate({ params: documentoIdParams }),
  asyncHandler(async (req, res) => {
    const contrato = await prisma.contrato.findUnique({
      where: { id: req.params.id },
      select: { empresaId: true, usuarioId: true },
    });
    if (!contrato) throw new HttpError(404, "Contrato no encontrado");
    const esDueno = contrato.usuarioId === req.user!.sub;
    if (!canManage(req, contrato) && !esDueno) throw new HttpError(403, "No autorizado");

    const { count } = await prisma.documentoContrato.deleteMany({
      where: { id: req.params.docId, contratoId: req.params.id },
    });
    if (count === 0) throw new HttpError(404, "Documento no encontrado");
    res.status(204).end();
  }),
);
