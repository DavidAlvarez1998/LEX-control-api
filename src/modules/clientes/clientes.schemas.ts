import { z } from "zod";

const tipoPersona = z.enum(["NATURAL", "JURIDICA"]);
const tipoDocumento = z.enum(["CC", "CE", "NIT", "TI", "PASAPORTE", "PEP_PPT"]);
const canalIngreso = z.enum([
  "REFERIDO", "INSTAGRAM", "FACEBOOK", "WHATSAPP", "WEB", "LLAMADA", "OTRO",
]);
// Área de práctica (slug del catálogo). Antes era un enum rígido; ahora sigue el
// catálogo AreaPractica, así que se acepta cualquier slug no vacío.
const tipoCaso = z.string().trim().min(1);
const viabilidad = z.enum(["VIABLE", "NO_VIABLE", "EN_ESTUDIO"]);

// Campos que el usuario diligencia. NUNCA se aceptan del body: empresaId,
// litiganteId, convertidoEn ni estado=CLIENTE (la conversión va por su endpoint).
export const createClienteSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio"),
  tipoPersona: tipoPersona.optional(),
  tipoDocumento: tipoDocumento.optional(),
  numeroDocumento: z.string().trim().min(1).optional(),
  telefono: z.string().trim().min(1).optional(),
  email: z.string().trim().email("Correo inválido").optional(),
  // Lista de correos (el primero es el principal). `email` se mantiene como espejo
  // de correos[0] del lado del servidor.
  correos: z.array(z.string().trim().email("Correo inválido")).optional(),
  ciudad: z.string().trim().min(1).optional(),
  canalIngreso: canalIngreso.optional(),
  tipoCaso: tipoCaso.optional(),
  necesidadTipoProcesoId: z.string().min(1).optional(),
  resumenCaso: z.string().trim().min(1).optional(),
  viabilidad: viabilidad.optional(),
  responsableComercialId: z.string().min(1).optional(),
  observaciones: z.string().trim().min(1).optional(),
});

// En update se permite marcar DESCARTADO o volver a PROSPECTO; pasar a CLIENTE
// es exclusivo del endpoint de conversión (que vincula el Litigante).
export const updateClienteSchema = createClienteSchema.partial().extend({
  estado: z.enum(["PROSPECTO", "DESCARTADO"]).optional(),
});

export const clienteIdParams = z.object({ id: z.string().min(1) });

export type CreateClienteInput = z.infer<typeof createClienteSchema>;
export type UpdateClienteInput = z.infer<typeof updateClienteSchema>;
