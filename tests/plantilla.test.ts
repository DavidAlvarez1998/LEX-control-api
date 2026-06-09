import { describe, expect, it } from "vitest";
import {
  construirContexto,
  numeroALetras,
  renderPlantilla,
} from "../src/modules/procesos/plantilla";

const procesoBase = {
  codigoInterno: "CASO-2026-0001",
  radicado: null,
  titulo: "Demanda ejecutiva",
  despachoJuzgado: "Juzgado 3 Civil",
  jurisdiccion: "CIVIL",
  instancia: "PRIMERA",
  cuantiaTipo: "MENOR",
  cuantiaValor: 5_000_000,
  etapaActual: "presentacion",
  estado: "ABIERTO",
  proximaAudiencia: null,
  createdAt: new Date("2026-06-06T12:00:00Z"),
  datos: { monto: 5_000_000, hechos: ["Primer hecho", "Segundo hecho"], tieneApoderado: true },
  partes: [
    {
      rol: "DEMANDANTE",
      rolEtiqueta: null,
      esNuestroCliente: true,
      litigante: { nombre: "Juan Pérez", tipoDocumento: "CC", numeroDocumento: "123", tipoPersona: "NATURAL" },
    },
    {
      rol: "DEMANDADO",
      rolEtiqueta: null,
      esNuestroCliente: false,
      litigante: { nombre: "ACME S.A.S.", tipoDocumento: "NIT", numeroDocumento: "900", tipoPersona: "JURIDICA" },
    },
  ],
};

describe("renderPlantilla — variables", () => {
  const ctx = construirContexto(procesoBase);

  it("sustituye datos.* y proceso.*", () => {
    expect(renderPlantilla("{{proceso.codigoInterno}} / {{datos.monto}}", ctx)).toBe(
      "CASO-2026-0001 / 5000000",
    );
  });

  it("alias tramite.* equivale a proceso.*", () => {
    expect(renderPlantilla("{{tramite.titulo}}", ctx)).toBe("Demanda ejecutiva");
  });

  it("parte.<rol>.<field> toma la primera parte de ese rol", () => {
    expect(renderPlantilla("{{parte.demandante.nombre}} vs {{parte.demandado.nombre}}", ctx)).toBe(
      "Juan Pérez vs ACME S.A.S.",
    );
  });

  it("placeholder sin resolver → marcador visible, no falla ni queda en blanco", () => {
    expect(renderPlantilla("X{{datos.inexistente}}Y", ctx)).toBe("X[[falta: datos.inexistente]]Y");
  });
});

describe("renderPlantilla — helpers", () => {
  const ctx = construirContexto(procesoBase);

  it("moneda formatea con punto de miles", () => {
    expect(renderPlantilla("{{moneda datos.monto}}", ctx)).toBe("5.000.000");
  });

  it("enLetras convierte la cuantía a palabras", () => {
    expect(renderPlantilla("{{enLetras datos.monto}}", ctx)).toBe("CINCO MILLONES");
  });

  it("fecha formatea en español", () => {
    expect(renderPlantilla("{{fecha proceso.createdAt}}", ctx)).toBe("6 de junio de 2026");
  });

  it("mayus pasa a mayúsculas", () => {
    expect(renderPlantilla("{{mayus parte.demandante.nombre}}", ctx)).toBe("JUAN PÉREZ");
  });
});

describe("renderPlantilla — bloques", () => {
  const ctx = construirContexto(procesoBase);

  it("#if veraz/falso con else", () => {
    expect(renderPlantilla("{{#if datos.tieneApoderado}}sí{{else}}no{{/if}}", ctx)).toBe("sí");
    expect(renderPlantilla("{{#if datos.noExiste}}sí{{else}}no{{/if}}", ctx)).toBe("no");
  });

  it("#each sobre arreglo de objetos (partes) con this.<field>", () => {
    expect(renderPlantilla("{{#each partes}}{{this.nombre}}; {{/each}}", ctx)).toBe(
      "Juan Pérez; ACME S.A.S.; ",
    );
  });

  it("#each sobre arreglo de strings con @index", () => {
    expect(renderPlantilla("{{#each datos.hechos}}{{@index}}. {{this}}\n{{/each}}", ctx)).toBe(
      "1. Primer hecho\n2. Segundo hecho\n",
    );
  });

  it("plantilla sintácticamente rota lanza", () => {
    expect(() => renderPlantilla("{{#if x}}sin cierre", ctx)).toThrow();
  });
});

describe("numeroALetras", () => {
  it.each([
    [0, "cero"],
    [1, "uno"],
    [15, "quince"],
    [21, "veintiuno"],
    [100, "cien"],
    [101, "ciento uno"],
    [1000, "mil"],
    [2026, "dos mil veintiseis".toUpperCase()],
    [1_000_000, "un millón".toUpperCase()],
    [5_000_000, "cinco millones".toUpperCase()],
  ])("%i → %s", (n, esperado) => {
    expect(numeroALetras(n)).toBe(esperado.toUpperCase());
  });
});
