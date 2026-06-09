import { describe, expect, it } from "vitest";
import { construirContexto, renderPlantilla } from "../src/modules/procesos/plantilla";
import { PLANTILLAS_SEED } from "../src/modules/procesos/plantillas-seed";

// Proceso de ejemplo con un accionante (nuestro cliente) para alimentar el contexto.
const procesoBase = {
  codigoInterno: "DDP-2026-0001",
  radicado: null,
  titulo: "Derecho de petición ante la DIAN",
  despachoJuzgado: null,
  jurisdiccion: "CONSTITUCIONAL",
  instancia: "UNICA",
  cuantiaTipo: null,
  cuantiaValor: null,
  etapaActual: "borrador",
  estado: "ABIERTO",
  proximaAudiencia: null,
  createdAt: new Date("2026-02-02T00:00:00Z"),
  partes: [
    {
      rol: "ACCIONANTE",
      rolEtiqueta: null,
      esNuestroCliente: true,
      litigante: { nombre: "Juan Pérez", tipoPersona: "NATURAL", tipoDocumento: "CC", numeroDocumento: "79123456", email: null, telefono: null },
    },
  ],
};

const render = (nombre: string, datos: Record<string, unknown>) => {
  const plantilla = PLANTILLAS_SEED.find((p) => p.nombre === nombre)!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderPlantilla(plantilla.contenido, construirContexto({ ...procesoBase, datos } as any));
};

describe("plantillas-seed", () => {
  it("hay plantillas para DdP (petición + reiteración) y tutela", () => {
    const nombres = PLANTILLAS_SEED.map((p) => p.nombre);
    expect(nombres).toContain("Derecho de petición");
    expect(nombres).toContain("Reiteración de la petición");
    expect(nombres).toContain("Demanda de tutela");
  });

  it("la petición se renderiza con accionante, entidad y la lista (#each queSolicita)", () => {
    const out = render("Derecho de petición", {
      entidad: "DIAN",
      correo: "notificaciones@dian.gov.co",
      tipoPeticion: "Documental",
      queSolicita: ["Información", "Copia de documentos"],
      detalle: "Requiero el estado de mi trámite.",
    });
    expect(out).toContain("Juan Pérez");
    expect(out).toContain("DIAN");
    expect(out).toContain("- Información");
    expect(out).toContain("- Copia de documentos");
    expect(out).toContain("notificaciones@dian.gov.co");
    expect(out).not.toContain("[[falta"); // todos los campos resueltos
  });

  it("la demanda de tutela renderiza los derechos fundamentales y el juramento", () => {
    const out = render("Demanda de tutela", {
      entidadAccionada: "Nueva EPS",
      derechosFundamentales: ["Salud", "Vida"],
      hechos: "Negaron la autorización.",
      pretension: "Ordenar la autorización del procedimiento.",
      perjuicioIrremediable: true,
      medidaProvisional: true,
    });
    expect(out).toContain("Nueva EPS");
    expect(out).toContain("- Salud");
    expect(out).toContain("- Vida");
    expect(out).toContain("perjuicio irremediable");
    expect(out).toContain("MEDIDA PROVISIONAL");
    expect(out).toContain("juramento");
  });

  it("un campo ausente queda como marcador [[falta: ...]] (no rompe)", () => {
    const out = render("Reiteración de la petición", { queSolicita: ["Certificación"] });
    expect(out).toContain("- Certificación");
    expect(out).toContain("[[falta:"); // entidad/nroRadicado ausentes
  });
});
