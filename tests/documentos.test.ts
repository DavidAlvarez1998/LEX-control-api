import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env";
import {
  carpetaModulo,
  construirUrlDocumento,
  subirDocumento,
} from "../src/modules/documentos/documentos.client";

const BASE = env.documentos.apiUrl;
const PREFIJO = env.documentos.raizPrefijo; // raíz paraguas única (DEMO-LEXCONTROL)

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
    expect(construirUrlDocumento("EMP/CONTRATOS/2026/06/x.pdf")).toBe(
      `${BASE}/documentos/EMP/CONTRATOS/2026/06/x.pdf`,
    );
  });
});

describe("carpetaModulo", () => {
  it("empresa = null → ADMIN_{modulo} (plataforma)", () => {
    expect(carpetaModulo(null, "USUARIOS")).toBe("ADMIN_USUARIOS");
  });

  it("empresa → {slug}-{id}_{modulo} (sin acentos, mayúscula)", () => {
    expect(carpetaModulo({ id: "cl9a", nombre: "Bufete Pérez & Asociados" }, "PROCESOS")).toBe(
      "BUFETE-PEREZ-ASOCIADOS-cl9a_PROCESOS",
    );
  });

  it("nombre vacío/raro → fallback SIN-NOMBRE", () => {
    expect(carpetaModulo({ id: "x1", nombre: "  ***  " }, "CONTRATOS")).toBe("SIN-NOMBRE-x1_CONTRATOS");
  });
});

describe("subirDocumento", () => {
  const ok = {
    path: "DEMO-LEXCONTROL/ACME-CL9A_CONTRATOS/2026/06/123_contrato.pdf",
    filename: "123_contrato.pdf",
    url: `${BASE}/documentos/DEMO-LEXCONTROL/ACME-CL9A_CONTRATOS/2026/06/123_contrato.pdf`,
  };
  const carpeta = "ACME-CL9A_CONTRATOS";
  const base = { archivo: Buffer.from("x"), nombreArchivo: "c.pdf", documento: "1", carpeta };

  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("postea a /api/documento/{PREFIJO}/{CARPETA} y devuelve {path,filename,url}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(ok), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await subirDocumento({
      archivo: Buffer.from("pdf-bytes"),
      nombreArchivo: "contrato.pdf",
      documento: "1088327869",
      carpeta,
      tipo: "application/pdf",
    });

    expect(res).toEqual(ok);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(`${BASE}/api/documento/${PREFIJO}/${carpeta}`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("absolutiza la url cuando el servicio la devuelve RELATIVA (caso real)", async () => {
    const rel = "/documentos/DEMO-LEXCONTROL/ACME-CL9A_CONTRATOS/2026/06/123_c.pdf";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ path: ok.path, filename: ok.filename, url: rel }), { status: 200 }),
      ),
    );
    const res = await subirDocumento({ ...base });
    expect(res.url).toBe(`${BASE}${rel}`);
  });

  it("reconstruye la url si el servicio no la devuelve", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ path: ok.path, filename: ok.filename }), { status: 200 })),
    );
    const res = await subirDocumento({ ...base });
    expect(res.url).toBe(`${BASE}/documentos/${ok.path}`);
  });

  it("lee `ruta` como alias de `path` (versiones distintas del microservicio)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ruta: ok.path }), { status: 200 })),
    );
    const res = await subirDocumento({ ...base });
    expect(res.path).toBe(ok.path);
  });

  it("502 si el microservicio responde con error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    await expect(subirDocumento({ ...base })).rejects.toMatchObject({ status: 502 });
  });

  it("502 si la respuesta no trae ruta", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })));
    await expect(subirDocumento({ ...base })).rejects.toMatchObject({ status: 502 });
  });

  it("502 si no se puede conectar (fetch lanza)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    await expect(subirDocumento({ ...base })).rejects.toMatchObject({ status: 502 });
  });
});
