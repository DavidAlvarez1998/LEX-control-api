// Lógica reutilizable de Cliente, extraída del router para que la consuman el
// embudo comercial (fase FIRMADO) y el puente de asignación de procesos.
// Ver openspec/changes/comercial-funnel/ (fix F3: antes estaba inline en /convertir).
import { Prisma } from "@prisma/client";
import { fusionarCorreos } from "../../correos";
import { HttpError } from "../../middleware/error";
import { prisma } from "../../shared/prisma";
import { empresaIdOrThrow, type TenantContext } from "../../shared/tenant";
import { ClientesRepository } from "./clientes.repository";
import type { CreateClienteInput, UpdateClienteInput } from "./clientes.schemas";

type ClienteParaConvertir = {
  id: string;
  empresaId: string;
  litiganteId: string | null;
  nombre: string;
  tipoPersona: "NATURAL" | "JURIDICA";
  tipoDocumento: string | null;
  numeroDocumento: string | null;
  email: string | null;
  correos?: unknown; // Json (string[]) del cliente; se copia al litigante
  telefono: string | null;
};

/**
 * Find-or-create del Litigante asociado a un Cliente, matcheando por
 * (empresaId, tipoDocumento, numeroDocumento). Con documento usa upsert atómico
 * (gracias al @@unique de Litigante); sin documento crea uno nuevo. Devuelve el
 * litiganteId (el existente del cliente si ya estaba vinculado). Corre dentro de
 * la transacción que se le pasa.
 */
export async function findOrCreateLitiganteByDoc(
  tx: Prisma.TransactionClient,
  cliente: ClienteParaConvertir,
): Promise<string> {
  if (cliente.litiganteId) return cliente.litiganteId;

  const { correos, email } = fusionarCorreos(cliente);
  const base = {
    empresaId: cliente.empresaId,
    nombre: cliente.nombre,
    tipoPersona: cliente.tipoPersona,
    email,
    correos,
    telefono: cliente.telefono,
  };

  if (cliente.tipoDocumento && cliente.numeroDocumento) {
    const lit = await tx.litigante.upsert({
      where: {
        empresaId_tipoDocumento_numeroDocumento: {
          empresaId: cliente.empresaId,
          tipoDocumento: cliente.tipoDocumento as never,
          numeroDocumento: cliente.numeroDocumento,
        },
      },
      update: {},
      create: {
        ...base,
        tipoDocumento: cliente.tipoDocumento as never,
        numeroDocumento: cliente.numeroDocumento,
      },
    });
    return lit.id;
  }

  const lit = await tx.litigante.create({ data: base });
  return lit.id;
}

/**
 * Convierte un PROSPECTO en CLIENTE: vincula su Litigante (find-or-create) y
 * estampa estado=CLIENTE + convertidoEn. Idempotente respecto al litigante.
 */
export async function convertirCliente(
  tx: Prisma.TransactionClient,
  cliente: ClienteParaConvertir,
): Promise<string> {
  const litiganteId = await findOrCreateLitiganteByDoc(tx, cliente);
  await tx.cliente.update({
    where: { id: cliente.id },
    data: { estado: "CLIENTE", convertidoEn: new Date(), litiganteId },
  });
  return litiganteId;
}

// ===================== CASOS DE USO (CRM) =====================
// Orquestan reglas + repositorio. Sin Express (req/res). El empresaId sale del
// TenantContext y se inyecta al repositorio (scoping forzado).

/** Valida que las FK salientes de un Cliente apunten a la MISMA empresa (no hay constraint en BD). */
async function assertSameEmpresa(
  repo: ClientesRepository,
  empresaId: string,
  data: { responsableComercialId?: string | null; necesidadTipoProcesoId?: string | null; litiganteId?: string | null },
) {
  if (data.responsableComercialId) {
    const u = await repo.usuarioEmpresaId(data.responsableComercialId);
    if (!u || u.empresaId !== empresaId) throw new HttpError(400, "El responsable comercial no pertenece a tu empresa");
  }
  if (data.litiganteId) {
    const l = await repo.litiganteEmpresaId(data.litiganteId);
    if (!l || l.empresaId !== empresaId) throw new HttpError(400, "El litigante no pertenece a tu empresa");
  }
  if (data.necesidadTipoProcesoId) {
    const t = await repo.tipoProcesoEmpresaId(data.necesidadTipoProcesoId);
    if (!t || (t.empresaId !== null && t.empresaId !== empresaId)) throw new HttpError(400, "El tipo de proceso no es válido para tu empresa");
  }
}

export async function listClientes(t: TenantContext, filtros: { estado?: string; mios?: boolean }) {
  const repo = new ClientesRepository(empresaIdOrThrow(t));
  return repo.list({ estado: filtros.estado, mios: filtros.mios, usuarioId: t.userId });
}

export async function getCliente(t: TenantContext, id: string) {
  const repo = new ClientesRepository(empresaIdOrThrow(t));
  const cliente = await repo.findById(id);
  if (!cliente) throw new HttpError(404, "Cliente no encontrado");
  return cliente;
}

export async function createCliente(t: TenantContext, input: CreateClienteInput) {
  const empresaId = empresaIdOrThrow(t);
  const repo = new ClientesRepository(empresaId);
  await assertSameEmpresa(repo, empresaId, input);
  const { correos, email } = fusionarCorreos(input);
  // El responsable por defecto es quien lo crea (atribución + filtro "Míos").
  return repo.create({ ...input, correos, email, responsableComercialId: input.responsableComercialId ?? t.userId });
}

export async function updateCliente(t: TenantContext, id: string, input: UpdateClienteInput) {
  const empresaId = empresaIdOrThrow(t);
  const repo = new ClientesRepository(empresaId);
  const actual = await repo.findForConvert(id);
  if (!actual) throw new HttpError(404, "Cliente no encontrado");
  await assertSameEmpresa(repo, empresaId, input);
  const data: Record<string, unknown> = { ...input };
  // Solo re-derivar el espejo correos↔email si el body trae alguno (PATCH parcial).
  if (input.correos !== undefined || input.email !== undefined) {
    const { correos, email } = fusionarCorreos(input);
    data.correos = correos;
    data.email = email;
  }
  return repo.update(id, data);
}

export async function convertirClienteUseCase(t: TenantContext, id: string) {
  const empresaId = empresaIdOrThrow(t);
  const repo = new ClientesRepository(empresaId);
  const cliente = await repo.findForConvert(id);
  if (!cliente) throw new HttpError(404, "Cliente no encontrado");
  return prisma.$transaction(async (tx) => {
    await convertirCliente(tx, cliente);
    // Scoped (defense-in-depth): aunque el id ya está validado, no leemos por solo `{ id }`.
    return tx.cliente.findFirst({ where: { id: cliente.id, empresaId } });
  });
}
