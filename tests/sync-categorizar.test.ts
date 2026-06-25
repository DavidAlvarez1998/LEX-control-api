// Tests de la categorización del resultado de "Actualizar con Rama" (P16).
// Es el corazón del resumen accionable: separa lo que NO es error (no publicado /
// reservado) de las dos causas de error reales (radicado inválido vs fuente caída).
import { describe, expect, it } from "vitest";
import { categorizarError, categorizarOk } from "../src/modules/procesos/actuaciones.service";
import { HttpError } from "../src/middleware/error";

describe("categorizarOk", () => {
  it("ACTUALIZADO cuando hay actuaciones nuevas", () => {
    expect(categorizarOk({ encontrado: true, reservado: false, nuevas: 3, total: 10 })).toBe("ACTUALIZADO");
  });
  it("SIN_NOVEDAD cuando se consultó OK pero sin nuevas", () => {
    expect(categorizarOk({ encontrado: true, reservado: false, nuevas: 0, total: 10 })).toBe("SIN_NOVEDAD");
  });
  it("NO_PUBLICADO cuando el radicado no existe / no está publicado (NO es error)", () => {
    expect(categorizarOk({ encontrado: false, reservado: false, nuevas: 0, total: 0 })).toBe("NO_PUBLICADO");
  });
  it("RESERVADO cuando el proceso es privado (NO es error)", () => {
    expect(categorizarOk({ encontrado: false, reservado: true, nuevas: 0, total: 0 })).toBe("RESERVADO");
  });
});

describe("categorizarError", () => {
  it("RADICADO_INVALIDO ante HttpError 400 (dato del usuario)", () => {
    expect(categorizarError(new HttpError(400, "El proceso no tiene un radicado válido de 23 dígitos"))).toBe("RADICADO_INVALIDO");
  });
  it("FUENTE_NO_DISPONIBLE ante HttpError 502 (Rama caída / bloqueó)", () => {
    expect(categorizarError(new HttpError(502, "la Rama Judicial respondió 403. Intenta más tarde."))).toBe("FUENTE_NO_DISPONIBLE");
  });
  it("FUENTE_NO_DISPONIBLE ante un error desconocido (default seguro: reintentable)", () => {
    expect(categorizarError(new Error("boom"))).toBe("FUENTE_NO_DISPONIBLE");
  });
});
