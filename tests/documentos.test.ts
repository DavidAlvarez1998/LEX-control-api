import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env";
import {
  construirUrlDocumento,
  subirDocumento,
} from "../src/modules/documentos/documentos.client";

const BASE = env.documentos.apiUrl;

describe("construirUrlDocumento", () => {
  it("null/undefined → null", () => {
    expect(construirUrlDocumento(null)).toBeNull();
    expect(construirUrlDocumento(undefined)).toBeNull();
  });

  it("URL absoluta → se devuelve tal cual", () => {
    const u = "https://otro.com/x.pdf";
    expect(construirUrlDocumento(u)).toBe(u);
  });

  it("path que empieza con / → base + path", () => {
    expect(construirUrlDocumento("/documentos/a/b.pdf")).toBe(`${BASE}/documentos/a/b.pdf`);
  });

  it("path relativo → base + /documentos/ + path", () => {
    expect(construirUrlDocumento("EMP/contratos/2026/06/x.pdf")).toBe(
      `${BASE}/documentos/EMP/contratos/2026/06/x.pdf`,
    );
  });
});

describe("subirDocumento", () => {
  const ok = {
    path: "LEX/contratos/2026/06/123_contrato.pdf",
    filename: "123_contrato.pdf",
    url: `${BASE}/documentos/LEX/contratos/2026/06/123_contrato.pdf`,
  };

  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("postea a /api/documento/{EMPRESA}/{CARPETA} y devuelve {path,filename,url}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(ok), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await subirDocumento({
      archivo: Buffer.from("pdf-bytes"),
      nombreArchivo: "contrato.pdf",
      documento: "1088327869",
      carpeta: "contratos",
      tipo: "application/pdf",
    });

    expect(res).toEqual(ok);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(`${BASE}/api/documento/${env.documentos.empresa}/contratos`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("absolutiza la url cuando el servicio la devuelve RELATIVA (caso real)", async () => {
    // El microservicio responde url = "/documentos/...". Debe quedar absoluta.
    const rel = "/documentos/DEMO-LEX-CONTROL/CONTRATOS/2026/06/123_c.pdf";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ path: ok.path, filename: ok.filename, url: rel }), { status: 200 }),
      ),
    );
    const res = await subirDocumento({
      archivo: Buffer.from("x"),
      nombreArchivo: "c.pdf",
      documento: "1",
      carpeta: "contratos",
    });
    expect(res.url).toBe(`${BASE}${rel}`);
  });

  it("reconstruye la url si el servicio no la devuelve", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ path: ok.path, filename: ok.filename }), { status: 200 }),
      ),
    );
    const res = await subirDocumento({
      archivo: Buffer.from("x"),
      nombreArchivo: "c.pdf",
      documento: "1",
      carpeta: "contratos",
    });
    expect(res.url).toBe(`${BASE}/documentos/${ok.path}`);
  });

  it("lee `ruta` como alias de `path` (versiones distintas del microservicio)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ruta: ok.path }), { status: 200 })),
    );
    const res = await subirDocumento({
      archivo: Buffer.from("x"),
      nombreArchivo: "c.pdf",
      documento: "1",
      carpeta: "contratos",
    });
    expect(res.path).toBe(ok.path);
  });

  it("502 si el microservicio responde con error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    await expect(
      subirDocumento({ archivo: Buffer.from("x"), nombreArchivo: "c.pdf", documento: "1", carpeta: "contratos" }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("502 si la respuesta no trae ruta", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })));
    await expect(
      subirDocumento({ archivo: Buffer.from("x"), nombreArchivo: "c.pdf", documento: "1", carpeta: "contratos" }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("502 si no se puede conectar (fetch lanza)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    await expect(
      subirDocumento({ archivo: Buffer.from("x"), nombreArchivo: "c.pdf", documento: "1", carpeta: "contratos" }),
    ).rejects.toMatchObject({ status: 502 });
  });
});
