// Lógica reutilizable de Cliente, extraída del router para que la consuman el
// embudo comercial (fase FIRMADO) y el puente de asignación de procesos.
// Ver openspec/changes/comercial-funnel/ (fix F3: antes estaba inline en /convertir).
import { Prisma } from "@prisma/client";
import { fusionarCorreos } from "../../correos";

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
