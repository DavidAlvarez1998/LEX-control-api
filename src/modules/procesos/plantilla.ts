// Motor de plantillas de documentos (Decisión 9 del diseño legal-tramites).
//
// Sintaxis estilo Handlebars, mínima pero suficiente para una demanda colombiana
// (art. 82 CGP): variables, condicionales, loops sobre arreglos (partes, hechos,
// pretensiones) y helpers (cuantía en letras, moneda, fecha). Un placeholder que
// no resuelve NO falla: se renderiza un marcador VISIBLE `[[falta: <path>]]`.
//
//   {{ datos.monto }}                      → valor del campo
//   {{ proceso.codigoInterno }}            → campo de primer nivel del proceso
//   {{ parte.demandante.nombre }}          → primera parte con ese rol
//   {{ moneda datos.monto }}               → 1.000.000
//   {{ enLetras datos.monto }}             → UN MILLÓN
//   {{ fecha proceso.createdAt }}          → 6 de junio de 2026
//   {{ mayus parte.demandante.nombre }}    → JUAN PÉREZ
//   {{#if datos.tieneApoderado}} ... {{else}} ... {{/if}}
//   {{#each partes}} {{this.nombre}} ({{this.rol}}) {{/each}}
//   {{#each datos.hechos}} {{@index}}. {{this}} {{/each}}

type Contexto = Record<string, unknown>;

type Helper = (arg: unknown) => string;

// --- Helpers de presentación ---

/** Formato de dinero del proyecto: miles con punto, sin decimales (1.000.000). */
function moneda(valor: unknown): string {
  const n = aNumero(valor);
  if (n === null) return marcador("monto");
  return Math.round(n).toLocaleString("es-CO", { useGrouping: true }).replace(/,/g, ".");
}

/** Fecha legible en español: "6 de junio de 2026". */
function fecha(valor: unknown): string {
  if (valor == null || valor === "") return marcador("fecha");
  const d = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(d.getTime())) return String(valor);
  const meses = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

function mayus(valor: unknown): string {
  return String(valor ?? "").toUpperCase();
}

/**
 * Decimal con coma colombiana: 28.5 → "28,5", 30 → "30". El valor se guarda con
 * punto decimal (p. ej. el campo "porcentaje"), así que NO se usa `aNumero` (que
 * trata el punto como separador de miles); se parsea como número plano.
 */
function decimal(valor: unknown): string {
  if (valor == null || valor === "") return marcador("número");
  const n = typeof valor === "number" ? valor : Number(String(valor));
  if (!Number.isFinite(n)) return String(valor);
  return String(n).replace(".", ",");
}

const HELPERS: Record<string, Helper> = {
  moneda,
  fecha,
  mayus,
  decimal,
  enLetras: (v) => {
    const n = aNumero(v);
    return n === null ? marcador("monto") : numeroALetras(Math.round(n));
  },
};

// --- Tokenizer + parser ---

type Token =
  | { t: "text"; v: string }
  | { t: "var"; v: string }
  | { t: "open"; kind: "if" | "each"; expr: string }
  | { t: "else" }
  | { t: "close"; kind: "if" | "each" };

function tokenizar(plantilla: string): Token[] {
  const tokens: Token[] = [];
  const re = /\{\{([^}]*)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(plantilla)) !== null) {
    if (m.index > last) tokens.push({ t: "text", v: plantilla.slice(last, m.index) });
    const expr = m[1].trim();
    if (expr.startsWith("#if ")) tokens.push({ t: "open", kind: "if", expr: expr.slice(4).trim() });
    else if (expr.startsWith("#each ")) tokens.push({ t: "open", kind: "each", expr: expr.slice(6).trim() });
    else if (expr === "else") tokens.push({ t: "else" });
    else if (expr === "/if") tokens.push({ t: "close", kind: "if" });
    else if (expr === "/each") tokens.push({ t: "close", kind: "each" });
    else tokens.push({ t: "var", v: expr });
    last = re.lastIndex;
  }
  if (last < plantilla.length) tokens.push({ t: "text", v: plantilla.slice(last) });
  return tokens;
}

// AST de nodos.
type Nodo =
  | { t: "text"; v: string }
  | { t: "var"; v: string }
  | { t: "if"; expr: string; then: Nodo[]; otherwise: Nodo[] }
  | { t: "each"; expr: string; body: Nodo[] };

function parsear(tokens: Token[]): Nodo[] {
  let i = 0;

  function bloque(fin?: "if" | "each"): Nodo[] {
    const nodos: Nodo[] = [];
    while (i < tokens.length) {
      const tk = tokens[i];
      if (tk.t === "close") {
        if (fin && tk.kind === fin) return nodos;
        throw new Error(`Cierre inesperado {{/${tk.kind}}}`);
      }
      if (tk.t === "else") return nodos; // lo gestiona el #if
      i++;
      if (tk.t === "text") nodos.push({ t: "text", v: tk.v });
      else if (tk.t === "var") nodos.push({ t: "var", v: tk.v });
      else if (tk.t === "open" && tk.kind === "if") {
        const then = bloque("if");
        let otherwise: Nodo[] = [];
        if (tokens[i]?.t === "else") {
          i++;
          otherwise = bloque("if");
        }
        consumirCierre("if");
        nodos.push({ t: "if", expr: tk.expr, then, otherwise });
      } else if (tk.t === "open" && tk.kind === "each") {
        const body = bloque("each");
        consumirCierre("each");
        nodos.push({ t: "each", expr: tk.expr, body });
      }
    }
    if (fin) throw new Error(`Falta cierre {{/${fin}}}`);
    return nodos;
  }

  function consumirCierre(kind: "if" | "each") {
    const tk = tokens[i];
    if (!tk || tk.t !== "close" || tk.kind !== kind) throw new Error(`Falta cierre {{/${kind}}}`);
    i++;
  }

  return bloque();
}

// --- Render ---

function marcador(path: string): string {
  return `[[falta: ${path}]]`;
}

function aNumero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/\./g, "").replace(/,/g, "."));
    return Number.isFinite(n) ? n : null;
  }
  if (v && typeof v === "object" && "toNumber" in v && typeof (v as { toNumber: unknown }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  return null;
}

/** Resuelve un path con puntos contra el contexto. `undefined` si no existe. */
function resolverPath(path: string, ctx: Contexto): unknown {
  const segs = path.split(".");
  let cur: unknown = segs[0] === "this" ? (segs.shift(), ctx["this"]) : ctx;
  for (const seg of segs) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Evalúa una expresión `{{ ... }}`: helper opcional + path (o `@index`). */
function evaluarVar(expr: string, ctx: Contexto): string {
  if (expr === "@index") return String(ctx["@index"] ?? "");
  const partes = expr.split(/\s+/);
  if (partes.length >= 2 && HELPERS[partes[0]]) {
    const valor = resolverArg(partes[1], ctx);
    return HELPERS[partes[0]](valor);
  }
  const v = resolverPath(expr, ctx);
  if (v === undefined || v === null || v === "") return marcador(expr);
  // Listas (multiselect, correos de la entidad…) se muestran separadas por coma.
  if (Array.isArray(v)) return v.length ? v.join(", ") : marcador(expr);
  return String(v);
}

function resolverArg(arg: string, ctx: Contexto): unknown {
  if (arg === "@index") return ctx["@index"];
  return resolverPath(arg, ctx);
}

function veraz(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim() !== "";
  return Boolean(v);
}

function renderNodos(nodos: Nodo[], ctx: Contexto): string {
  let out = "";
  for (const n of nodos) {
    if (n.t === "text") out += n.v;
    else if (n.t === "var") out += evaluarVar(n.v, ctx);
    else if (n.t === "if") {
      out += veraz(resolverPath(n.expr, ctx))
        ? renderNodos(n.then, ctx)
        : renderNodos(n.otherwise, ctx);
    } else if (n.t === "each") {
      const lista = resolverPath(n.expr, ctx);
      if (Array.isArray(lista)) {
        lista.forEach((item, idx) => {
          out += renderNodos(n.body, { ...ctx, this: item, "@index": idx + 1 });
        });
      }
    }
  }
  return out;
}

/**
 * Renderiza una plantilla contra un contexto. Nunca lanza por placeholders sin
 * resolver (devuelve el marcador); una plantilla sintácticamente rota sí lanza.
 */
export function renderPlantilla(contenido: string, contexto: Contexto): string {
  const ast = parsear(tokenizar(contenido));
  return renderNodos(ast, contexto);
}

// --- Contexto desde un proceso ---

type ParteCtx = Record<string, unknown> & { rol: string };

interface ProcesoParaContexto {
  codigoInterno: string;
  radicado: string | null;
  titulo: string;
  despachoJuzgado: string | null;
  jurisdiccion: string;
  instancia: string;
  cuantiaTipo: string | null;
  cuantiaValor: unknown;
  etapaActual: string;
  estado: string;
  proximaAudiencia: Date | null;
  createdAt: Date;
  datos: unknown;
  // Abogado responsable del proceso (para firmar escritos generados). Opcional:
  // findProcesoConPartes lo carga con select { nombre, cedula, tarjetaProfesional, email }.
  responsable?: { nombre: string; cedula: string | null; tarjetaProfesional: string | null; email: string | null } | null;
  partes: Array<{
    rol: string;
    rolEtiqueta: string | null;
    esNuestroCliente: boolean;
    litigante: Record<string, unknown>;
  }>;
}

/**
 * Arma el contexto de render: `datos.*`, `proceso.*` (alias `tramite.*`),
 * `partes` (arreglo para `#each`) y `parte.<rol>` (primera parte de cada rol).
 *
 * `casoBase` (opcional) es el proceso del que éste deriva (`casoRelacionadoId`):
 * se expone como `casoBase.*` con la misma forma, para que un derivado —p. ej. la
 * reiteración de un derecho de petición— pueda citar datos de la petición anterior
 * (`{{casoBase.datos.nroRadicado}}`, `{{fecha casoBase.datos.fechaRadicacion}}`).
 */
export function construirContexto(
  proceso: ProcesoParaContexto,
  casoBase?: ProcesoParaContexto | null,
): Contexto {
  const partes: ParteCtx[] = proceso.partes.map((p) => ({
    rol: p.rol,
    rolEtiqueta: p.rolEtiqueta,
    esNuestroCliente: p.esNuestroCliente,
    nombre: p.litigante.nombre,
    tipoPersona: p.litigante.tipoPersona,
    tipoDocumento: p.litigante.tipoDocumento,
    numeroDocumento: p.litigante.numeroDocumento,
    email: p.litigante.email,
    correos: p.litigante.correos, // string[] (varios correos del litigante)
    telefono: p.litigante.telefono,
    direccion: p.litigante.direccion,
    ciudad: p.litigante.ciudad,
  }));

  // parte.<rol> → primera parte de ese rol (rol en minúsculas: parte.demandante).
  const parte: Record<string, ParteCtx> = {};
  for (const p of partes) {
    const key = p.rol.toLowerCase();
    if (!parte[key]) parte[key] = p;
  }

  // El cliente del despacho: en trámites no judiciales (p. ej. derecho de petición)
  // se guarda con rol OTRO (etiqueta "Peticionario"), no como accionante/demandante.
  // Se expone con nombres estables (peticionario/cliente) y se da alias a los roles
  // comunes si faltan, para que las plantillas resuelvan al cliente sin [[falta:]].
  const cliente = partes.find((p) => p.esNuestroCliente) ?? partes[0];
  if (cliente) {
    if (!parte.peticionario) parte.peticionario = cliente;
    if (!parte.cliente) parte.cliente = cliente;
    if (!parte.accionante) parte.accionante = cliente;
    if (!parte.demandante) parte.demandante = cliente;
    if (!parte.ejecutante) parte.ejecutante = cliente;
  }
  // La parte PASIVA (demandado / ejecutado / accionado) → primera contraparte, con alias
  // cruzado entre términos equivalentes: una plantilla escrita con "demandado" resuelve
  // aunque el proceso use rol "EJECUTADO" (y viceversa). En el ejecutivo el ejecutante/
  // ejecutado son el demandante/demandado del escrito.
  const contraparte = parte.demandado ?? parte.ejecutado ?? parte.accionado ?? partes.find((p) => !p.esNuestroCliente);
  if (contraparte) {
    if (!parte.demandado) parte.demandado = contraparte;
    if (!parte.ejecutado) parte.ejecutado = contraparte;
    if (!parte.accionado) parte.accionado = contraparte;
  }

  const procesoCtx = {
    codigoInterno: proceso.codigoInterno,
    radicado: proceso.radicado,
    titulo: proceso.titulo,
    despachoJuzgado: proceso.despachoJuzgado,
    jurisdiccion: proceso.jurisdiccion,
    instancia: proceso.instancia,
    cuantiaTipo: proceso.cuantiaTipo,
    cuantiaValor: proceso.cuantiaValor,
    etapaActual: proceso.etapaActual,
    estado: proceso.estado,
    proximaAudiencia: proceso.proximaAudiencia,
    createdAt: proceso.createdAt,
    // Abogado responsable (firma de escritos generados). null si no se cargó/asignó.
    responsable: proceso.responsable ?? null,
  };

  const ctx: Contexto = {
    datos: (proceso.datos ?? {}) as Contexto,
    proceso: procesoCtx,
    tramite: procesoCtx, // alias retro: el spec menciona `tramite.<field>`
    partes,
    parte,
    // Todos los peticionarios/accionantes (nuestros) — soporta varios peticionarios.
    // `parte.peticionario` sigue siendo el primero.
    peticionarios: partes.filter((p) => p.esNuestroCliente),
  };
  // El derivado expone su origen como `casoBase.*` (misma forma, sin recursión más
  // allá del padre: el padre se pasa sin su propio casoBase).
  if (casoBase) ctx.casoBase = construirContexto(casoBase);
  return ctx;
}

// --- Número a letras (español, para cuantía "en letras", art. 623 C.Co) ---

const UNIDADES = [
  "", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete",
  "dieciocho", "diecinueve", "veinte",
];
const DECENAS = ["", "", "veinti", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const CENTENAS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
];

function menorDeCien(n: number): string {
  if (n <= 20) return UNIDADES[n];
  if (n < 30) return n === 20 ? "veinte" : "veinti" + UNIDADES[n - 20];
  const d = Math.floor(n / 10);
  const u = n % 10;
  return u === 0 ? DECENAS[d] : `${DECENAS[d]} y ${UNIDADES[u]}`;
}

function menorDeMil(n: number): string {
  if (n === 100) return "cien";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const pre = CENTENAS[c];
  if (resto === 0) return pre;
  return `${pre} ${menorDeCien(resto)}`.trim();
}

function seccion(n: number, singular: string, plural: string): string {
  if (n === 0) return "";
  if (n === 1) return singular;
  return `${menorDeMil(n)} ${plural}`;
}

/** Convierte un entero no negativo a palabras en español. */
export function numeroALetras(n: number): string {
  if (n === 0) return "CERO";
  if (n < 0) return `MENOS ${numeroALetras(-n)}`;

  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;

  const partes: string[] = [];
  if (millones > 0) {
    partes.push(millones === 1 ? "un millón" : `${numeroALetras(millones)} millones`);
  }
  if (miles > 0) partes.push(seccion(miles, "mil", "mil"));
  if (resto > 0) partes.push(menorDeMil(resto));

  return partes.join(" ").replace(/\s+/g, " ").trim().toUpperCase();
}
