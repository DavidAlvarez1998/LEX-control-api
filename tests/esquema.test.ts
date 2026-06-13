import { describe, expect, it } from "vitest";
import {
  campoEfectivamenteRequerido,
  campoVisible,
  evaluarCondicion,
  validarDatosContraEsquema,
  type CampoEsquema,
} from "../src/modules/procesos/esquema";
import { createTipoProcesoSchema } from "../src/modules/catalog/catalog.schemas";

describe("evaluarCondicion", () => {
  it("igualdad simple (string)", () => {
    expect(evaluarCondicion({ campo: "estado", igualA: "NO" }, { estado: "NO" })).toBe(true);
    expect(evaluarCondicion({ campo: "estado", igualA: "NO" }, { estado: "SI" })).toBe(false);
  });
  it("igualdad contra lista", () => {
    expect(evaluarCondicion({ campo: "x", igualA: ["A", "B"] }, { x: "B" })).toBe(true);
    expect(evaluarCondicion({ campo: "x", igualA: ["A", "B"] }, { x: "C" })).toBe(false);
  });
  it("coerciona booleanos a texto (igualA: 'true')", () => {
    expect(evaluarCondicion({ campo: "poder", igualA: "true" }, { poder: true })).toBe(true);
    expect(evaluarCondicion({ campo: "poder", igualA: "true" }, { poder: false })).toBe(false);
  });
  it("campo ausente no cumple", () => {
    expect(evaluarCondicion({ campo: "x", igualA: "A" }, {})).toBe(false);
  });
  it("multiselect: se cumple si el array CONTIENE el objetivo", () => {
    expect(evaluarCondicion({ campo: "q", igualA: "Otro" }, { q: ["Información", "Otro"] })).toBe(true);
    expect(evaluarCondicion({ campo: "q", igualA: "Otro" }, { q: ["Información"] })).toBe(false);
    expect(evaluarCondicion({ campo: "q", igualA: ["Queja", "Otro"] }, { q: ["Salud", "Queja"] })).toBe(true);
    expect(evaluarCondicion({ campo: "q", igualA: "Otro" }, { q: [] })).toBe(false);
  });
});

describe("visibilidad y requerido efectivo", () => {
  const poderPdf: CampoEsquema = {
    key: "poderPdf",
    label: "PDF del poder",
    tipo: "texto",
    requerido: false,
    requeridoSi: { campo: "requierePoder", igualA: "true" },
  };
  const reiteracion: CampoEsquema = {
    key: "reiteracion",
    label: "Reiteración",
    tipo: "textoLargo",
    requerido: true,
    mostrarSi: { campo: "contestaron", igualA: "PARCIAL" },
  };

  it("requeridoSi activa el requerido", () => {
    expect(campoEfectivamenteRequerido(poderPdf, { requierePoder: true })).toBe(true);
    expect(campoEfectivamenteRequerido(poderPdf, { requierePoder: false })).toBe(false);
  });
  it("un campo oculto nunca es requerido aunque tenga requerido:true", () => {
    expect(campoVisible(reiteracion, { contestaron: "SI" })).toBe(false);
    expect(campoEfectivamenteRequerido(reiteracion, { contestaron: "SI" })).toBe(false);
    expect(campoEfectivamenteRequerido(reiteracion, { contestaron: "PARCIAL" })).toBe(true);
  });
});

describe("validarDatosContraEsquema", () => {
  it("back-compat: esquema sin claves condicionales se comporta igual", () => {
    const esquema: CampoEsquema[] = [
      { key: "entidad", label: "Entidad", tipo: "texto", requerido: true },
      { key: "nota", label: "Nota", tipo: "texto", requerido: false },
    ];
    expect(validarDatosContraEsquema(esquema, { entidad: "DIAN" }).ok).toBe(true);
    const r = validarDatosContraEsquema(esquema, {});
    expect(r.ok).toBe(false);
    expect(r.faltantes).toContain("Entidad");
  });

  it("requeridoSi bloquea cuando la condición se cumple", () => {
    const esquema: CampoEsquema[] = [
      { key: "requierePoder", label: "Requiere poder", tipo: "boolean", requerido: false },
      { key: "poderPdf", label: "PDF del poder", tipo: "texto", requerido: false, requeridoSi: { campo: "requierePoder", igualA: "true" } },
    ];
    expect(validarDatosContraEsquema(esquema, { requierePoder: true }).faltantes).toContain("PDF del poder");
    expect(validarDatosContraEsquema(esquema, { requierePoder: false }).ok).toBe(true);
    expect(validarDatosContraEsquema(esquema, { requierePoder: true, poderPdf: "url" }).ok).toBe(true);
  });

  it("campo oculto requerido no se reporta como faltante", () => {
    const esquema: CampoEsquema[] = [
      { key: "contestaron", label: "Contestaron", tipo: "select", requerido: true, opciones: ["SI", "PARCIAL", "NO"] },
      { key: "reiteracion", label: "Reiteración", tipo: "textoLargo", requerido: true, mostrarSi: { campo: "contestaron", igualA: "PARCIAL" } },
    ];
    expect(validarDatosContraEsquema(esquema, { contestaron: "SI" }).ok).toBe(true);
    expect(validarDatosContraEsquema(esquema, { contestaron: "PARCIAL" }).faltantes).toContain("Reiteración");
  });

  it("no valida opciones de un campo oculto (valor viejo en datos)", () => {
    const esquema: CampoEsquema[] = [
      { key: "modo", label: "Modo", tipo: "select", requerido: true, opciones: ["A", "B"] },
      { key: "extra", label: "Extra", tipo: "select", requerido: false, opciones: ["X"], mostrarSi: { campo: "modo", igualA: "A" } },
    ];
    // extra trae un valor inválido pero está oculto (modo=B) → se ignora.
    expect(validarDatosContraEsquema(esquema, { modo: "B", extra: "ZZZ" }).ok).toBe(true);
  });
});

describe("createTipoProcesoSchema — validación de referencias condicionales", () => {
  const base = {
    nombre: "Tipo X",
    jurisdiccion: "CONSTITUCIONAL",
    areaSlugs: ["constitucional"],
    esquemaFormulario: [
      { key: "tipoPeticion", label: "Tipo", tipo: "select", requerido: true, opciones: ["General", "Documental"] },
      { key: "fechaRadicacion", label: "Radicación", tipo: "fecha", requerido: false },
    ],
    etapas: [{ key: "inicio", nombre: "Inicio", orden: 0 }],
  };

  it("acepta un esquema con condiciones/plazo que referencian campos existentes", () => {
    const r = createTipoProcesoSchema.safeParse({
      ...base,
      etapas: [
        {
          key: "radicada",
          nombre: "Radicada",
          orden: 1,
          reglas: {
            plazoDesdeCampo: "fechaRadicacion",
            plazoTipoDias: "habiles",
            plazoDiasPorValorDe: { campo: "tipoPeticion", mapa: { General: 15, Documental: 10 } },
          },
          disponibleSi: { campo: "tipoPeticion", igualA: "General" },
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rechaza plazoDesdeCampo que apunta a un campo inexistente", () => {
    const r = createTipoProcesoSchema.safeParse({
      ...base,
      etapas: [{ key: "x", nombre: "X", orden: 1, reglas: { plazoDesdeCampo: "noExiste" } }],
    });
    expect(r.success).toBe(false);
  });

  it("rechaza mostrarSi que apunta a un campo inexistente", () => {
    const r = createTipoProcesoSchema.safeParse({
      ...base,
      esquemaFormulario: [
        ...base.esquemaFormulario,
        { key: "extra", label: "Extra", tipo: "texto", requerido: false, mostrarSi: { campo: "fantasma", igualA: "x" } },
      ],
    });
    expect(r.success).toBe(false);
  });
});
