import { CategoriaDocumento, EstadoContrato, TipoDocumento } from "@prisma/client";
import { z } from "zod";

// Texto opcional que normaliza "" → undefined (un campo vacío en el form no debe
// guardarse como cadena vacía).
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

// Campos comunes del contrato (todos opcionales salvo el nombre, que se exige
// solo al crear). Reusa los enums de Prisma; los "otro → digitar" del doc quedan
// como texto libre.
const contratoFields = {
  // Vínculo opcional a un Usuario (despacho o comercial admin). El ÁMBITO
  // (empresaId / plataforma) NUNCA sale del body: lo fija el servidor según
  // quién crea, igual que en mi-empresa. Por eso aquí no hay empresaId.
  usuarioId: z.string().min(1).optional(),

  // A. Datos del contratado
  nombreCompleto: z.string().trim().min(1, "El nombre es obligatorio"),
  tipoDocumento: z.nativeEnum(TipoDocumento).optional(),
  numeroDocumento: optionalText,
  fechaNacimiento: z.coerce.date().optional(),
  direccion: optionalText,
  telefono: optionalText,
  email: z.string().trim().email("Correo inválido").optional().or(z.literal("").transform(() => undefined)),

  // B. Laboral / contractual
  tipoColaborador: optionalText,
  cargo: optionalText,
  tipoContrato: optionalText,
  fechaInicio: z.coerce.date().optional(),
  fechaFin: z.coerce.date().optional(),
  duracionValor: z.coerce.number().int().positive().optional(),
  duracionUnidad: optionalText,
  estado: z.nativeEnum(EstadoContrato).optional(),

  // C. Económica
  honorarios: z.coerce.number().nonnegative().optional(),
  formaPago: optionalText,
  diaPago: z.coerce.number().int().min(1).max(31).optional(),
  bonificaciones: optionalText,
  descuentos: optionalText,
  cuentaBancaria: optionalText,

  // D. Funciones
  descripcionCargo: optionalText,
  funciones: optionalText,
  area: optionalText,
  supervisor: optionalText,

  // E. Control y seguimiento
  horario: optionalText,
  modalidad: optionalText,
  observaciones: optionalText,

  // F. Legal
  clausulas: optionalText,
  tipoTerminacion: optionalText,
  penalidades: optionalText,
};

/** Crear un contrato. `nombreCompleto` obligatorio; el resto opcional. */
export const createContratoSchema = z.object(contratoFields);

/** Actualizar un contrato: todo opcional, pero al menos un campo. */
export const updateContratoSchema = z
  .object({ ...contratoFields, nombreCompleto: z.string().trim().min(1).optional() })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada que actualizar" });

export const contratoIdParams = z.object({ id: z.string().min(1) });
export const documentoIdParams = z.object({ id: z.string().min(1), docId: z.string().min(1) });

/** Metadata de un documento que se adjunta (el binario va aparte, vía multer). */
export const createDocumentoSchema = z.object({
  categoria: z.nativeEnum(CategoriaDocumento),
  nombre: z.string().trim().min(1, "El nombre del documento es obligatorio"),
  tipo: optionalText,
});

export type CreateContratoInput = z.infer<typeof createContratoSchema>;
export type UpdateContratoInput = z.infer<typeof updateContratoSchema>;
