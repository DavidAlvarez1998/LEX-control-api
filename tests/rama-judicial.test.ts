// Tests del módulo RAMA JUDICIAL (CPNU) con `fetch` MOCKEADO. NO tocan la API real.
// Verifican: URL/headers, normalización, paginación, "no encontrado" (procesos:[]),
// y traducción de 403/conexión a HttpError 502.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env";
import { consultarRadicado, obtenerActuaciones } from "../src/modules/rama-judicial";

const BASE = env.ramaJudicial.baseUrl;

function mockFetchSeq(...respuestas: Array<{ body: unknown; status?: number }>) {
  const fn = vi.fn();
  for (const r of respuestas) fn.mockResolvedValueOnce(new Response(JSON.stringify(r.body), { status: r.status ?? 200 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("consultarRadicado (Endpoint A)", () => {
  it("radicado válido → encontrado + idProceso/despacho; manda User-Agent de navegador", async () => {
    const fn = mockFetchSeq({
      body: { procesos: [{ idProceso: 1810780324, despacho: "JUZGADO 003", fechaUltimaActuacion: "2026-03-09T00:00:00", esPrivado: false }] },
    });
    const r = await consultarRadicado("66001333300320140049500");

    expect(r).toMatchObject({ encontrado: true, idProceso: 1810780324, despacho: "JUZGADO 003" });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe(`${BASE}/Procesos/Consulta/NumeroRadicacion?numero=66001333300320140049500&SoloActivos=false&pagina=1`);
    expect(init.headers["User-Agent"]).toMatch(/Mozilla/);
  });

  it("procesos:[] → encontrado=false (no es error)", async () => {
    mockFetchSeq({ body: { procesos: [] } });
    const r = await consultarRadicado("66001333100020180001400");
    expect(r.encontrado).toBe(false);
    expect(r.idProceso).toBeNull();
  });

  it("403 (rate-limit) → HttpError 502", async () => {
    mockFetchSeq({ body: {}, status: 403 });
    await expect(consultarRadicado("66001333300320140049500")).rejects.toMatchObject({ status: 502 });
  });
});

describe("obtenerActuaciones (Endpoint B, paginado)", () => {
  it("recorre todas las páginas y concatena", async () => {
    const fn = mockFetchSeq(
      { body: { actuaciones: [{ actuacion: "A1" }, { actuacion: "A2" }], paginacion: { cantidadPaginas: 2 } } },
      { body: { actuaciones: [{ actuacion: "A3" }] } },
    );
    const acts = await obtenerActuaciones(1810780324);

    expect(acts.map((a) => a.actuacion)).toEqual(["A1", "A2", "A3"]);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[0][0]).toBe(`${BASE}/Proceso/Actuaciones/1810780324?pagina=1`);
    expect(fn.mock.calls[1][0]).toBe(`${BASE}/Proceso/Actuaciones/1810780324?pagina=2`);
  });

  it("una sola página → no pide la 2", async () => {
    const fn = mockFetchSeq({ body: { actuaciones: [{ actuacion: "Única" }], paginacion: { cantidadPaginas: 1 } } });
    const acts = await obtenerActuaciones(1);
    expect(acts).toHaveLength(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
