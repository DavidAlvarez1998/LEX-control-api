// Casos de uso de Contratos (RRHH). El ámbito (PLATAFORMA / EMPRESA) sale SIEMPRE
// del TenantContext (rol + esAdminEmpresa + empresaId), nunca del body. Sin Express.
import { CategoriaDocumento, Rol } from "@prisma/client";
import type { z } from "zod";
import { HttpError } from "../../middleware/error";
import type { TenantContext } from "../../shared/tenant";
import { construirUrlDocumento, subirDocumento } from "../documentos/documentos.client";
import { ContratosRepository } from "./contratos.repository";
import { serializeContrato } from "./contratos.dto";
import type { createContratoSchema, createDocumentoSchema, updateContratoSchema } from "./contratos.schemas";

const CARPETA = "contratos";
const repo = () => new ContratosRepository();

type Scope = { tipo: "EMPRESA"; empresaId: string } | { tipo: "PLATAFORMA" };

/** Ámbito que ADMINISTRA contratos (ADMIN=plataforma; admin de empresa=su empresa). */
function managerScope(t: TenantContext): Scope | null {
  if (t.rol === Rol.ADMIN) return { tipo: "PLATAFORMA" };
  if (t.rol === Rol.USUARIO && t.esAdminEmpresa && t.empresaId) return { tipo: "EMPRESA", empresaId: t.empresaId };
  return null;
}
function scopeWhere(scope: Scope) {
  return scope.tipo === "PLATAFORMA" ? { empresaId: null } : { empresaId: scope.empresaId };
}
function canManage(t: TenantContext, contrato: { empresaId: string | null }): boolean {
  const scope = managerScope(t);
  if (!scope) return false;
  return scope.tipo === "PLATAFORMA" ? contrato.empresaId === null : contrato.empresaId === scope.empresaId;
}
async function assertUsuarioEnAmbito(r: ContratosRepository, usuarioId: string, scope: Scope) {
  const u = await r.usuarioEmpresaId(usuarioId);
  if (!u) throw new HttpError(404, "Usuario no encontrado");
  if (scope.tipo === "EMPRESA" && u.empresaId !== scope.empresaId) throw new HttpError(400, "El usuario no pertenece a tu empresa");
  if (scope.tipo === "PLATAFORMA" && u.empresaId !== null) throw new HttpError(400, "El usuario no es personal de la plataforma");
}
function requireScope(t: TenantContext): Scope {
  const scope = managerScope(t);
  if (!scope) throw new HttpError(403, "No autorizado");
  return scope;
}

export async function listMios(t: TenantContext) {
  return (await repo().listByUsuario(t.userId)).map(serializeContrato);
}

export async function reportes(t: TenantContext) {
  const where = scopeWhere(requireScope(t));
  const ahora = new Date();
  const limite = new Date(ahora.getTime() + 60 * 24 * 60 * 60 * 1000);
  const [total, porEstado, vencimientos] = await repo().reportes(where, ahora, limite);
  return { total, porEstado: Object.fromEntries(porEstado.map((e) => [e.estado, e._count.estado])), vencimientos };
}

export async function listContratos(t: TenantContext) {
  return (await repo().listByWhere(scopeWhere(requireScope(t)))).map(serializeContrato);
}

export async function createContrato(t: TenantContext, data: z.infer<typeof createContratoSchema>) {
  const scope = requireScope(t);
  const r = repo();
  if (data.usuarioId) await assertUsuarioEnAmbito(r, data.usuarioId, scope);
  const contrato = await r.create({ ...data, empresaId: scope.tipo === "EMPRESA" ? scope.empresaId : null });
  return serializeContrato(contrato);
}

export async function getContrato(t: TenantContext, id: string) {
  const contrato = await repo().findById(id);
  if (!contrato) throw new HttpError(404, "Contrato no encontrado");
  if (!canManage(t, contrato) && contrato.usuarioId !== t.userId) throw new HttpError(403, "No autorizado");
  return serializeContrato(contrato);
}

export async function updateContrato(t: TenantContext, id: string, data: z.infer<typeof updateContratoSchema>) {
  const r = repo();
  const contrato = await r.findEmpresaId(id);
  if (!contrato) throw new HttpError(404, "Contrato no encontrado");
  if (!canManage(t, contrato)) throw new HttpError(403, "No autorizado");
  if (data.usuarioId) await assertUsuarioEnAmbito(r, data.usuarioId, requireScope(t));
  return serializeContrato(await r.update(id, data));
}

export async function deleteContrato(t: TenantContext, id: string): Promise<void> {
  const r = repo();
  const contrato = await r.findEmpresaId(id);
  if (!contrato) throw new HttpError(404, "Contrato no encontrado");
  if (!canManage(t, contrato)) throw new HttpError(403, "No autorizado");
  await r.delete(id);
}

export async function subirDocumentoContrato(
  t: TenantContext,
  id: string,
  file: { buffer: Buffer; originalname: string; mimetype: string } | undefined,
  body: z.infer<typeof createDocumentoSchema>,
) {
  const r = repo();
  const contrato = await r.findParaDoc(id);
  if (!contrato) throw new HttpError(404, "Contrato no encontrado");
  const esDueno = contrato.usuarioId === t.userId;
  if (!canManage(t, contrato) && !esDueno) throw new HttpError(403, "No autorizado");
  if (!file) throw new HttpError(400, "Falta el archivo (campo `file`)");
  const mime = body.tipo ?? file.mimetype;
  const subido = await subirDocumento({
    archivo: file.buffer, nombreArchivo: file.originalname,
    documento: contrato.numeroDocumento ?? contrato.usuarioId ?? contrato.id, carpeta: CARPETA, tipo: mime,
  });
  const doc = await r.createDocumento({ contratoId: contrato.id, categoria: body.categoria as CategoriaDocumento, nombre: body.nombre, path: subido.path, tipo: mime });
  return { ...doc, url: construirUrlDocumento(doc.path) };
}

export async function eliminarDocumentoContrato(t: TenantContext, id: string, docId: string): Promise<void> {
  const r = repo();
  const contrato = await r.findDuenoYAmbito(id);
  if (!contrato) throw new HttpError(404, "Contrato no encontrado");
  const esDueno = contrato.usuarioId === t.userId;
  if (!canManage(t, contrato) && !esDueno) throw new HttpError(403, "No autorizado");
  if ((await r.deleteDocumento(docId, id)) === 0) throw new HttpError(404, "Documento no encontrado");
}
