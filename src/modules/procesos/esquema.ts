// Tipos y validación del formulario dinámico de un tipo de proceso. Esta misma
// lógica corre en el cliente (validarDatos) y aquí en el servidor, que es la
// fuente de verdad. Ver openspec/changes/legal-procesos/.

export const CAMPO_TIPOS = [
  "texto",
  "textoLargo",
  "numero",
  "moneda", // entero en pesos; se captura/muestra con separador de miles (9.999.999)
  "porcentaje", // número 0–100 con decimales; se captura/muestra con sufijo %
  "fecha",
  "boolean",
  "select",
  "multiselect",
  "listaCorreos", // varios correos (string[]); p. ej. correos de la entidad del DdP
] as const;

export type CampoTipo = (typeof CAMPO_TIPOS)[number];

/**
 * Condición sobre los datos del formulario. Tres formas, evaluadas por
 * `evaluarCondicion`:
 *  - Hoja `{campo, igualA}`: igualdad sobre `datos[campo]` (coercionado a texto);
 *    si `igualA` es lista, se cumple cuando el valor está incluido, y si el campo
 *    es multiselect (array) cuando el array CONTIENE alguno de los objetivos.
 *  - AND `{todas: [...]}`: se cumple si TODAS las sub-condiciones se cumplen.
 *  - OR  `{alguna: [...]}`: se cumple si ALGUNA sub-condición se cumple.
 * Las hojas son retro-compatibles con el formato anterior (solo `{campo, igualA}`).
 */
export type Condicion =
  | { campo: string; igualA: string | string[] }
  | { todas: Condicion[] }
  | { alguna: Condicion[] };

export type CampoEsquema = {
  key: string;
  label: string;
  tipo: CampoTipo;
  requerido: boolean;
  opciones?: string[];
  ayuda?: string;
  mostrarSi?: Condicion; // el campo se oculta salvo que la condición se cumpla
  requeridoSi?: Condicion; // requerido (adicionalmente) cuando la condición se cumple
  auto?: boolean; // lo genera el servidor al crear (p. ej. radicado de ingreso); no se pide al usuario
};

export type ReglasEtapa = {
  camposRequeridos?: string[];
  documentosRequeridos?: string[];
  documentosOpcionales?: string[]; // ofrecidos para adjuntar, NO bloquean (p. ej. reiteracion.pdf)
  plazoDias?: number; // término informativo (existente; sin derivación de fechaLimite)
  plazoEtiqueta?: string; // nombre humano de QUÉ vence (p. ej. "Plazo para subsanar"); fallback = nombre de la etapa
  // Requeridos condicionales: aplican solo cuando `si` se cumple.
  requeridosSi?: { si: Condicion; camposRequeridos?: string[]; documentosRequeridos?: string[] }[];
  // Opcionales condicionales: se OFRECEN para adjuntar (no bloquean) solo si `si` se cumple
  // (p. ej. recurso.pdf cuando la respuesta fue parcial).
  opcionalesSi?: { si: Condicion; documentosOpcionales?: string[] }[];
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
  copiarDocumentos?: string[]; // nombres de documentos a heredar (p. ej. "poder.pdf")
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
 *  boolean (true/false) comparen con `igualA: "true"`. Si el campo es un
 *  multiselect (array), la condición se cumple cuando el array CONTIENE alguno
 *  de los objetivos (p. ej. mostrar un campo si "Otro" está entre lo elegido). */
export function evaluarCondicion(cond: Condicion, datos: Record<string, unknown>): boolean {
  if ("todas" in cond) return cond.todas.every((c) => evaluarCondicion(c, datos));
  if ("alguna" in cond) return cond.alguna.some((c) => evaluarCondicion(c, datos));
  const objetivos = Array.isArray(cond.igualA) ? cond.igualA : [cond.igualA];
  const valor = datos[cond.campo];
  if (Array.isArray(valor)) return valor.some((v) => objetivos.includes(String(v)));
  return objetivos.includes(String(valor ?? ""));
}

/** Campos que referencia una condición (hoja o compuesta), recursivamente. */
export function camposDeCondicion(cond: Condicion): string[] {
  if ("todas" in cond) return cond.todas.flatMap(camposDeCondicion);
  if ("alguna" in cond) return cond.alguna.flatMap(camposDeCondicion);
  return [cond.campo];
}

const vacioVal = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** ¿La condición PODRÍA volverse verdadera llenando los campos hoy vacíos? Trata
 *  un campo vacío como comodín (podría tomar cualquier valor) y un campo lleno
 *  como ya decidido. Sirve para distinguir "decisión pendiente" (esperar) de
 *  "rama N/A definitiva" (saltar) en el auto-avance, también con AND/OR. */
export function puedeSerVerdad(cond: Condicion, datos: Record<string, unknown>): boolean {
  if ("todas" in cond) return cond.todas.every((c) => puedeSerVerdad(c, datos));
  if ("alguna" in cond) return cond.alguna.some((c) => puedeSerVerdad(c, datos));
  if (vacioVal(datos[cond.campo])) return true; // vacío → podría coincidir
  return evaluarCondicion(cond, datos); // lleno → ya decidido
}

/** Una rama está "pendiente" (hay que esperar) si HOY es falsa pero PODRÍA volverse
 *  verdadera al completar campos vacíos. Si ni siquiera con comodines puede ser
 *  verdad, es N/A definitiva (se salta). */
export function condicionPendiente(cond: Condicion, datos: Record<string, unknown>): boolean {
  return !evaluarCondicion(cond, datos) && puedeSerVerdad(cond, datos);
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
  if (campo.auto) return false; // lo llena el servidor; nunca se le exige al usuario
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
    } else if (campo.tipo === "numero" || campo.tipo === "moneda") {
      if (!Number.isFinite(Number(v))) errores.push(`${campo.label}: número inválido`);
    } else if (campo.tipo === "porcentaje") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        errores.push(`${campo.label}: porcentaje inválido (0–100)`);
      }
    } else if (campo.tipo === "listaCorreos") {
      const arr = Array.isArray(v) ? v : [];
      const correoOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (arr.some((x) => !correoOk.test(String(x).trim()))) {
        errores.push(`${campo.label}: correo inválido`);
      }
    }
  }

  return { ok: faltantes.length === 0 && errores.length === 0, faltantes, errores };
}

/** Etapa de entrada (menor `orden`) de un tipo de proceso. */
export function etapaEntrada(etapas: EtapaDef[]): EtapaDef | undefined {
  return etapas.slice().sort((a, b) => a.orden - b.orden)[0];
}
