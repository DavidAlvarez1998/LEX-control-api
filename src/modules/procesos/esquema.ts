// Tipos y validación del formulario dinámico de un tipo de proceso. Esta misma
// lógica corre en el cliente (validarDatos) y aquí en el servidor, que es la
// fuente de verdad. Ver openspec/changes/legal-procesos/.

export const CAMPO_TIPOS = [
  "texto",
  "textoLargo",
  "numero",
  "fecha",
  "boolean",
  "select",
  "multiselect",
] as const;

export type CampoTipo = (typeof CAMPO_TIPOS)[number];

export type CampoEsquema = {
  key: string;
  label: string;
  tipo: CampoTipo;
  requerido: boolean;
  opciones?: string[];
  ayuda?: string;
};

export type ReglasEtapa = {
  camposRequeridos?: string[];
  documentosRequeridos?: string[];
  plazoDias?: number;
};

export type EtapaDef = {
  key: string;
  nombre: string;
  orden: number;
  terminal?: boolean;
  resultado?: string;
  reglas?: ReglasEtapa;
};

/** True si el valor cuenta como "vacío" para un campo requerido. */
function vacio(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    v === "" ||
    (Array.isArray(v) && v.length === 0)
  );
}

/**
 * Valida `datos` contra el esquema del tipo. Devuelve los problemas encontrados:
 * faltantes (campos requeridos vacíos), claves no declaradas en el esquema, y
 * valores inválidos (select/multiselect fuera de opciones). El llamador decide
 * el status (400) a partir de esto.
 */
export function validarDatosContraEsquema(
  esquema: CampoEsquema[],
  datos: Record<string, unknown>,
): { ok: boolean; faltantes: string[]; errores: string[] } {
  const faltantes: string[] = [];
  const errores: string[] = [];
  const keys = new Set(esquema.map((c) => c.key));

  // Claves que no existen en el esquema → se rechazan (fail closed).
  for (const k of Object.keys(datos)) {
    if (!keys.has(k)) errores.push(`Campo desconocido: ${k}`);
  }

  for (const campo of esquema) {
    const v = datos[campo.key];
    if (campo.requerido && campo.tipo !== "boolean" && vacio(v)) {
      faltantes.push(campo.label);
      continue;
    }
    if (vacio(v)) continue;

    if (campo.tipo === "select") {
      if (!campo.opciones?.includes(String(v))) {
        errores.push(`${campo.label}: opción inválida`);
      }
    } else if (campo.tipo === "multiselect") {
      const arr = Array.isArray(v) ? v.map(String) : [];
      if (arr.some((x) => !campo.opciones?.includes(x))) {
        errores.push(`${campo.label}: opción inválida`);
      }
    } else if (campo.tipo === "numero") {
      if (!Number.isFinite(Number(v))) errores.push(`${campo.label}: número inválido`);
    }
  }

  return { ok: faltantes.length === 0 && errores.length === 0, faltantes, errores };
}

/** Etapa de entrada (menor `orden`) de un tipo de proceso. */
export function etapaEntrada(etapas: EtapaDef[]): EtapaDef | undefined {
  return etapas.slice().sort((a, b) => a.orden - b.orden)[0];
}
