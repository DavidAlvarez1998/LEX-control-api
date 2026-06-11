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

/**
 * Condición de igualdad sobre otro campo del formulario: se cumple si
 * `datos[campo]` (coercionado a texto) es igual a `igualA` (o está incluido,
 * cuando `igualA` es lista). Solo igualdad — sin AND/OR ni aritmética.
 */
export type Condicion = {
  campo: string;
  igualA: string | string[];
};

export type CampoEsquema = {
  key: string;
  label: string;
  tipo: CampoTipo;
  requerido: boolean;
  opciones?: string[];
  ayuda?: string;
  mostrarSi?: Condicion; // el campo se oculta salvo que la condición se cumpla
  requeridoSi?: Condicion; // requerido (adicionalmente) cuando la condición se cumple
};

export type ReglasEtapa = {
  camposRequeridos?: string[];
  documentosRequeridos?: string[];
  plazoDias?: number; // término informativo (existente; sin derivación de fechaLimite)
  // Requeridos condicionales: aplican solo cuando `si` se cumple.
  requeridosSi?: { si: Condicion; camposRequeridos?: string[]; documentosRequeridos?: string[] }[];
  // Derivación de vencimiento: se computa fechaLimite SOLO si `plazoDesdeCampo` está.
  plazoDesdeCampo?: string; // key de un campo `fecha` en datos
  plazoTipoDias?: "habiles" | "calendario"; // default "calendario"
  plazoDiasPorValorDe?: { campo: string; mapa: Record<string, number> }; // término según otro campo
};

export type AccionEtapa = {
  tipo: "crearDerivado";
  tipoDestinoNombre: string;
  copiarDatos?: string[]; // keys de datos a copiar del proceso base al derivado
  copiarCliente?: boolean; // arrastra el mismo cliente/peticionario como parte
};

export type EtapaDef = {
  key: string;
  nombre: string;
  orden: number;
  terminal?: boolean;
  resultado?: string;
  reglas?: ReglasEtapa;
  disponibleSi?: Condicion; // la etapa solo se ofrece como destino si se cumple
  accion?: AccionEtapa; // acción al entrar (p. ej. crear proceso derivado)
};

/** Evalúa una condición de igualdad contra `datos`. `String()` para que los
 *  boolean (true/false) comparen con `igualA: "true"`. */
export function evaluarCondicion(cond: Condicion, datos: Record<string, unknown>): boolean {
  const actual = String(datos[cond.campo] ?? "");
  return Array.isArray(cond.igualA) ? cond.igualA.includes(actual) : actual === cond.igualA;
}

/** ¿El campo es visible dado el estado actual de `datos`? */
export function campoVisible(campo: CampoEsquema, datos: Record<string, unknown>): boolean {
  return !campo.mostrarSi || evaluarCondicion(campo.mostrarSi, datos);
}

/** ¿El campo es efectivamente requerido? Requerido (fijo o condicional) y visible. */
export function campoEfectivamenteRequerido(
  campo: CampoEsquema,
  datos: Record<string, unknown>,
): boolean {
  if (!campoVisible(campo, datos)) return false;
  return campo.requerido || (campo.requeridoSi != null && evaluarCondicion(campo.requeridoSi, datos));
}

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
  opts: { exigirRequeridos?: boolean } = {},
): { ok: boolean; faltantes: string[]; errores: string[] } {
  const exigirRequeridos = opts.exigirRequeridos ?? true;
  const faltantes: string[] = [];
  const errores: string[] = [];
  const keys = new Set(esquema.map((c) => c.key));

  // Claves que no existen en el esquema → se rechazan (fail closed).
  for (const k of Object.keys(datos)) {
    if (!keys.has(k)) errores.push(`Campo desconocido: ${k}`);
  }

  for (const campo of esquema) {
    // Campos ocultos (mostrarSi no se cumple) se ignoran por completo: no se
    // exigen ni se validan, aunque traigan un valor viejo en datos.
    if (!campoVisible(campo, datos)) continue;

    const v = datos[campo.key];
    // Al editar un borrador se permite guardar incompleto (exigirRequeridos=false);
    // los requeridos se exigen igual al avanzar de etapa.
    if (exigirRequeridos && campoEfectivamenteRequerido(campo, datos) && campo.tipo !== "boolean" && vacio(v)) {
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
