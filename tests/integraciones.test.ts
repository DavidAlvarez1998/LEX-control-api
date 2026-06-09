import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { corteConstitucionalAdapter } from "../src/modules/integraciones/corteConstitucional.client";

// Respuesta SODA de ejemplo (los datasets nombran las columnas distinto; el
// adapter normaliza defensivamente).
const sodaOk = [
  { providencia: "T-760/08", tema: "Derecho a la salud", fecha: "2008-07-31", url: "https://x/T-760-08" },
  { sentencia: "C-355/06", descriptor: "Despenalización", fecha_sentencia: "2006-05-10" },
];

describe("corteConstitucionalAdapter.buscarJurisprudencia", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("consulta SODA con $q y normaliza los resultados", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(sodaOk), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await corteConstitucionalAdapter.buscarJurisprudencia("tutela salud", 10);

    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({ providencia: "T-760/08", tema: "Derecho a la salud", fuente: "Corte Constitucional" });
    // Segundo registro usa alias distintos (sentencia/descriptor/fecha_sentencia).
    expect(res[1]).toMatchObject({ providencia: "C-355/06", titulo: "Despenalización", fecha: "2006-05-10" });

    const [calledUrl] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain("/resource/");
    expect(String(calledUrl)).toContain("$q=tutela%20salud");
    expect(String(calledUrl)).toContain("$limit=10");
  });

  it("acota el límite a [1,50]", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await corteConstitucionalAdapter.buscarJurisprudencia("x", 999);
    expect(String(fetchMock.mock.calls[0][0])).toContain("$limit=50");
  });

  it("502 si la API responde con error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    await expect(corteConstitucionalAdapter.buscarJurisprudencia("x")).rejects.toMatchObject({ status: 502 });
  });

  it("502 si no se puede conectar (fetch lanza)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    await expect(corteConstitucionalAdapter.buscarJurisprudencia("x")).rejects.toMatchObject({ status: 502 });
  });

  it("502 si la respuesta no es una lista", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "x" }), { status: 200 })));
    await expect(corteConstitucionalAdapter.buscarJurisprudencia("x")).rejects.toMatchObject({ status: 502 });
  });
});
