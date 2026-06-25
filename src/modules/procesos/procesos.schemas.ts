import {
  CuantiaTipo,
  EstadoProceso,
  Instancia,
  NaturalezaJuridica,
  Prioridad,
  RolParte,
  TipoDocumento,
  TipoPersona,
} from "@prisma/client";
import { z } from "zod";

// Una parte: o referencia un litigante existente (`litiganteId`) o crea uno
// nuevo inline (`litigante`). El cliente del prototipo manda datos inline.
const parteSchema = z
  .object({
    litiganteId: z.string().min(1).optional(),
    litigante: z
      .object({
        tipoPersona: z.nativeEnum(TipoPersona).default(TipoPersona.NATURAL),
        naturalezaJuridica: z.nativeEnum(NaturalezaJuridica).nullish(),
        nombre: z.string().min(1),
        tipoDocumento: z.nativeEnum(TipoDocumento).optional(),
        numeroDocumento: z.string().optional(),
        telefono: z.string().optional(),
        direccion: z.string().optional(),
        email: z.string().email().optional(),
        // Lista de correos (peticionarios adicionales, contraparte…); el primero
        // es el principal y se refleja en `email`.
        correos: z.array(z.string().trim().email()).optional(),
        // Marcas "se desconocen los datos" de notificación.
        correoDesconocido: z.boolean().optional(),
        direccionDesconocida: z.boolean().optional(),
        telefonoDesconocido: z.boolean().optional(),
      })
      .optional(),
    rol: z.nativeEnum(RolParte),
    rolEtiqueta: z.string().optional(),
    esNuestroCliente: z.boolean().default(false),
  })
  .refine((p) => p.litiganteId != null || p.litigante != null, {
    message: "Cada parte requiere litiganteId o litigante",
  });

// El cliente (CRM) dueño del caso: o se referencia uno existente (`clienteId`)
// o se crea uno nuevo inline (`nuevo`). `rol` es el rol procesal que juega
// nuestro cliente (DEMANDANTE, ACCIONANTE…). El backend lo materializa como
// una ParteProceso con esNuestroCliente=true y enlaza Cliente↔Litigante.
const procesoClienteSchema = z
  .object({
    clienteId: z.string().min(1).optional(),
    nuevo: z
      .object({
        nombre: z.string().min(1),
        tipoPersona: z.nativeEnum(TipoPersona).optional(),
        naturalezaJuridica: z.nativeEnum(NaturalezaJuridica).nullish(),
        tipoDocumento: z.nativeEnum(TipoDocumento).optional(),
        numeroDocumento: z.string().optional(),
        telefono: z.string().optional(),
        direccion: z.string().optional(),
        email: z.string().email().optional(),
        correos: z.array(z.string().trim().email()).optional(),
        ciudad: z.string().optional(),
        correoDesconocido: z.boolean().optional(),
        direccionDesconocida: z.boolean().optional(),
        telefonoDesconocido: z.boolean().optional(),
      })
      .optional(),
    rol: z.nativeEnum(RolParte),
    rolEtiqueta: z.string().optional(),
  })
  .refine((c) => (c.clienteId != null) !== (c.nuevo != null), {
    message: "El cliente requiere clienteId o nuevo (exactamente uno)",
  });

export const createProcesoSchema = z.object({
  tipoProcesoId: z.string().min(1),
  titulo: z.string().min(1),
  datos: z.record(z.unknown()).default({}),
  radicado: z.string().optional(),
  despachoJuzgado: z.string().optional(),
  instancia: z.nativeEnum(Instancia).optional(),
  cuantiaTipo: z.nativeEnum(CuantiaTipo).optional(),
  cuantiaValor: z.union([z.number(), z.string()]).optional(),
  casoRelacionadoId: z.string().min(1).optional(),
  // Cliente dueño del caso + abogado responsable. Opcionales en el esquema
  // (no rompen tests/puente comercial); la UI los exige al crear manualmente.
  cliente: procesoClienteSchema.optional(),
  responsableId: z.string().min(1).optional(),
  partes: z.array(parteSchema).default([]),
});

export const updateProcesoSchema = z.object({
  titulo: z.string().min(1).optional(),
  responsableId: z.string().min(1).nullable().optional(),
  radicado: z.string().nullable().optional(),
  despachoJuzgado: z.string().nullable().optional(),
  instancia: z.nativeEnum(Instancia).optional(),
  cuantiaTipo: z.nativeEnum(CuantiaTipo).nullable().optional(),
  cuantiaValor: z.union([z.number(), z.string()]).nullable().optional(),
  proximaAudiencia: z.string().nullable().optional(),
  fechaLimite: z.string().nullable().optional(), // override manual del vencimiento
  datos: z.record(z.unknown()).optional(), // editar el formulario dinámico (validado contra el esquema)
  estado: z.nativeEnum(EstadoProceso).optional(),
  prioridad: z.nativeEnum(Prioridad).optional(),
});

export const moverEtapaSchema = z.object({
  etapaKey: z.string().min(1),
  nota: z.string().optional(),
});

export const procesoIdParams = z.object({ id: z.string().min(1) });

// P16: body opcional para "Actualizar con Rama". Sin body = sincroniza los pendientes
// (ventana de 6 h). Con `procesoIds` = reintento dirigido de SOLO esos procesos.
export const sincronizarMisSchema = z.object({
  procesoIds: z.array(z.string().min(1)).max(40).optional(),
});

// --- Partes del proceso (gestión post-creación, desde la ficha) ---
// Agregar una contraparte/tercero a un proceso ya creado: o referencia un litigante
// existente (`litiganteId`) o crea uno nuevo inline. Tolera `null` en los campos
// opcionales (la ficha envía null para un documento/teléfono vacío). `esNuestroCliente`
// se fuerza a false en el handler (el cliente se define al crear el proceso).
export const addParteSchema = z
  .object({
    litiganteId: z.string().min(1).optional(),
    litigante: z
      .object({
        tipoPersona: z.nativeEnum(TipoPersona).default(TipoPersona.NATURAL),
        naturalezaJuridica: z.nativeEnum(NaturalezaJuridica).nullish(),
        nombre: z.string().min(1),
        tipoDocumento: z.nativeEnum(TipoDocumento).nullish(),
        numeroDocumento: z.string().nullish(),
        telefono: z.string().nullish(),
        direccion: z.string().nullish(),
        email: z.string().email().nullish(),
        correos: z.array(z.string().trim().email()).optional(),
        correoDesconocido: z.boolean().optional(),
        direccionDesconocida: z.boolean().optional(),
        telefonoDesconocido: z.boolean().optional(),
      })
      .optional(),
    rol: z.nativeEnum(RolParte),
    rolEtiqueta: z.string().optional(),
  })
  .refine((p) => p.litiganteId != null || p.litigante != null, {
    message: "Cada parte requiere litiganteId o litigante",
  });

// Editar una parte existente: su rol/etiqueta y/o los datos de su litigante.
export const updateParteSchema = z
  .object({
    rol: z.nativeEnum(RolParte).optional(),
    rolEtiqueta: z.string().nullable().optional(),
    litigante: z
      .object({
        tipoPersona: z.nativeEnum(TipoPersona).optional(),
        naturalezaJuridica: z.nativeEnum(NaturalezaJuridica).nullable().optional(),
        nombre: z.string().min(1).optional(),
        tipoDocumento: z.nativeEnum(TipoDocumento).nullable().optional(),
        numeroDocumento: z.string().nullable().optional(),
        telefono: z.string().nullable().optional(),
        direccion: z.string().nullable().optional(),
        email: z.string().email().nullable().optional(),
        correos: z.array(z.string().trim().email()).optional(),
        correoDesconocido: z.boolean().optional(),
        direccionDesconocida: z.boolean().optional(),
        telefonoDesconocido: z.boolean().optional(),
      })
      .optional(),
  })
  .refine((p) => p.rol !== undefined || p.rolEtiqueta !== undefined || p.litigante !== undefined, {
    message: "Nada que actualizar",
  });

export const parteIdParams = z.object({
  id: z.string().min(1),
  parteId: z.string().min(1),
});

// --- Documentos del proceso ---
// Adjuntar un archivo externo (enlace) al expediente.
export const adjuntarDocumentoSchema = z.object({
  nombre: z.string().min(1),
  url: z.string().min(1),
});

// Generar un borrador desde una plantilla del tipo del proceso.
export const generarDocumentoSchema = z.object({
  plantillaId: z.string().min(1),
  nombre: z.string().min(1).optional(), // por defecto, el nombre de la plantilla
});

// Editar el borrador generado (nombre y/o contenido).
export const updateDocumentoSchema = z
  .object({
    nombre: z.string().min(1).optional(),
    contenido: z.string().optional(),
  })
  .refine((d) => d.nombre !== undefined || d.contenido !== undefined, {
    message: "Nada que actualizar",
  });

export const documentoIdParams = z.object({
  id: z.string().min(1),
  docId: z.string().min(1),
});
