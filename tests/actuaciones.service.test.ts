// Tests del servicio de ACTUACIONES (sync Rama Judicial) con prisma y el cliente
// de la Rama MOCKEADOS. Verifican: validación del radicado, sync idempotente
// (inserta solo nuevas), cacheo de idProcesoRama y autollenado de ultimaActuacion.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/index", () => ({
  prisma: {
    proceso: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    actuacionProceso: { findMany: vi.fn(), createMany: vi.fn(), count: vi.fn() },
    documentoProceso: { findMany: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("../src/modules/rama-judicial", () => ({
  consultarRadicado: vi.fn(),
  obtenerActuaciones: vi.fn(),
  obtenerDocumentos: vi.fn(),
  descargarDocumento: vi.fn(),
}));
// No tocar la red al notificar novedades (best-effort).
vi.mock("../src/modules/notificaciones", () => ({
  enviarNovedadActuaciones: vi.fn().mockResolvedValue(true),
}));
// Evitar la subida real a tecnovapp y la dependencia pesada de procesos.service.
vi.mock("../src/modules/documentos/documentos.client", () => ({
  subirDocumento: vi.fn().mockResolvedValue({ path: "ruta/doc.pdf" }),
  carpetaModulo: vi.fn().mockReturnValue("EMP_PROCESOS"),
}));
vi.mock("../src/modules/procesos/procesos.service", () => ({ categoriaDoc: vi.fn().mockReturnValue("OTRO") }));

import { prisma } from "../src/index";
import { consultarRadicado, obtenerActuaciones, obtenerDocumentos, descargarDocumento } from "../src/modules/rama-judicial";
import { importarDocumentosRama, normalizarRadicado, sincronizarActuaciones, sincronizarTodas, validarRadicado } from "../src/modules/procesos/actuaciones.service";

const p = prisma as any;
const mockConsultar = consultarRadicado as unknown as ReturnType<typeof vi.fn>;
const mockActuaciones = obtenerActuaciones as unknown as ReturnType<typeof vi.fn>;
const mockDocs = obtenerDocumentos as unknown as ReturnType<typeof vi.fn>;
const mockDescarga = descargarDocumento as unknown as ReturnType<typeof vi.fn>;
const t = { empresaId: "e1", userId: "u1" } as any;
const RAD = "66001333300320140049500"; // 23 dígitos

beforeEach(() => vi.clearAllMocks());

describe("normalizarRadicado", () => {
  it("acepta 23 dígitos (limpia separadores) y rechaza otras longitudes", () => {
    expect(normalizarRadicado(RAD)).toBe(RAD);
    expect(normalizarRadicado("6600-1333-3003-2014-00495-00")).toBe(RAD);
    expect(normalizarRadicado("123")).toBeNull();
    expect(normalizarRadicado(null)).toBeNull();
  });
});

describe("validarRadicado", () => {
  it("radicado inválido → 400 sin tocar la Rama", async () => {
    await expect(validarRadicado("123")).rejects.toMatchObject({ status: 400 });
    expect(mockConsultar).not.toHaveBeenCalled();
  });
  it("radicado válido → consulta la Rama", async () => {
    mockConsultar.mockResolvedValue({ encontrado: true, idProceso: 111 });
    await validarRadicado(RAD);
    expect(mockConsultar).toHaveBeenCalledWith(RAD);
  });
});

describe("sincronizarActuaciones", () => {
  it("proceso sin radicado válido → 400", async () => {
    p.proceso.findFirst.mockResolvedValue({ id: "pr1", radicado: null, idProcesoRama: null, datos: {} });
    await expect(sincronizarActuaciones(t, "pr1")).rejects.toMatchObject({ status: 400 });
  });

  it("inserta nuevas, cachea idProcesoRama y autollena ultimaActuacion + juzgado + fechaRadicacion", async () => {
    p.proceso.findFirst.mockResolvedValue({
      id: "pr1", radicado: RAD, idProcesoRama: null, datos: { foo: "bar" }, despachoJuzgado: null,
      actuacionesVistasAt: new Date("2026-01-01"),
      tipoProceso: { esquemaFormulario: [{ key: "ultimaActuacion" }, { key: "juzgado" }, { key: "fechaRadicacion" }] },
    });
    p.actuacionProceso.count.mockResolvedValue(2); // 2 no-leídas desde vistasAt (P1)
    mockConsultar.mockResolvedValue({
      encontrado: true, idProceso: 1810780324, esPrivado: false,
      despacho: "JUZGADO 003 ADMINISTRATIVO DE PEREIRA", fechaProceso: "2014-06-06T00:00:00",
    });
    mockActuaciones.mockResolvedValue([
      { fechaActuacion: "2026-03-09T00:00:00", actuacion: "RECIBE MEMORIALES", anotacion: "x" },
      { fechaActuacion: "2025-11-14T00:00:00", actuacion: "MANDAMIENTO", anotacion: null },
    ]);
    p.actuacionProceso.findMany.mockResolvedValue([]); // ninguna guardada aún
    p.actuacionProceso.createMany.mockResolvedValue({ count: 2 });
    p.proceso.update.mockResolvedValue({});

    const r = await sincronizarActuaciones(t, "pr1");

    expect(r).toMatchObject({ encontrado: true, nuevas: 2, total: 2 });
    expect(p.actuacionProceso.createMany).toHaveBeenCalledTimes(1);
    const update = p.proceso.update.mock.calls[0][0];
    expect(update.data.idProcesoRama).toBe("1810780324");
    // #4: juzgado + fecha de radicación + última actuación (conservando datos previos)
    expect(update.data.datos).toMatchObject({
      foo: "bar",
      ultimaActuacion: "RECIBE MEMORIALES",
      juzgado: "JUZGADO 003 ADMINISTRATIVO DE PEREIRA",
      fechaRadicacion: "2014-06-06",
    });
    expect(update.data.despachoJuzgado).toBe("JUZGADO 003 ADMINISTRATIVO DE PEREIRA");
    expect(update.data.actuacionesNuevas).toBe(2); // P1: contador de no-leídas recalculado
  });

  it("no autollena campos que el tipo no tiene (sin claves desconocidas)", async () => {
    p.proceso.findFirst.mockResolvedValue({
      id: "pr1", radicado: RAD, idProcesoRama: null, datos: {}, despachoJuzgado: null,
      tipoProceso: { esquemaFormulario: [] }, // tipo sin esos campos
    });
    mockConsultar.mockResolvedValue({ encontrado: true, idProceso: 1, esPrivado: false, despacho: "JUZGADO X", fechaProceso: "2020-01-01T00:00:00" });
    mockActuaciones.mockResolvedValue([{ fechaActuacion: "2026-01-01T00:00:00", actuacion: "A", anotacion: null }]);
    p.actuacionProceso.findMany.mockResolvedValue([]);
    p.actuacionProceso.createMany.mockResolvedValue({ count: 1 });
    p.proceso.update.mockResolvedValue({});

    await sincronizarActuaciones(t, "pr1");
    const update = p.proceso.update.mock.calls[0][0];
    // No mete juzgado/fechaRadicacion/ultimaActuacion en datos; sí espeja la columna.
    expect(update.data.datos).toBeUndefined();
    expect(update.data.despachoJuzgado).toBe("JUZGADO X");
  });

  it("idempotente: si todas ya existen, no inserta", async () => {
    // Proceso YA completo (juzgado + fecha + despacho) → con idProcesoRama cacheado no hay
    // ni nuevas actuaciones ni básicos por backfillear: no debe tocar el Endpoint A.
    p.proceso.findFirst.mockResolvedValue({ id: "pr1", radicado: RAD, idProcesoRama: "1810780324", datos: { juzgado: "J", fechaRadicacion: "2014-01-01" }, despachoJuzgado: "J" });
    mockActuaciones.mockResolvedValue([{ fechaActuacion: "2026-03-09T00:00:00", actuacion: "RECIBE MEMORIALES", anotacion: "x" }]);
    // findMany devuelve la huella ya existente → 0 nuevas. Reproducimos el hash:
    const { createHash } = await import("crypto");
    const huella = createHash("sha256").update("2026-03-09T00:00:00|RECIBE MEMORIALES|x").digest("hex");
    p.actuacionProceso.findMany.mockResolvedValue([{ huella }]);
    p.proceso.update.mockResolvedValue({});

    const r = await sincronizarActuaciones(t, "pr1");

    expect(r).toMatchObject({ nuevas: 0, total: 1 });
    expect(p.actuacionProceso.createMany).not.toHaveBeenCalled();
    expect(mockConsultar).not.toHaveBeenCalled(); // caché + básicos llenos → no llama Endpoint A
  });

  it("backfillea juzgado/fecha de radicación con idProcesoRama cacheado si están vacíos", async () => {
    // idProceso cacheado PERO juzgado/fecha vacíos → debe consultar el Endpoint A igual y
    // rellenarlos (antes solo se hacía en el primer sync, así que no se recuperaban nunca).
    p.proceso.findFirst.mockResolvedValue({
      id: "pr1", radicado: RAD, idProcesoRama: "1810780324", datos: {}, despachoJuzgado: null,
      tipoProceso: { esquemaFormulario: [{ key: "juzgado" }, { key: "fechaRadicacion" }] },
    });
    mockConsultar.mockResolvedValue({ encontrado: true, idProceso: 999, esPrivado: false, despacho: "JUZGADO 5", fechaProceso: "2021-05-27T00:00:00" });
    mockActuaciones.mockResolvedValue([{ fechaActuacion: "2026-01-01T00:00:00", actuacion: "A", anotacion: null }]);
    p.actuacionProceso.findMany.mockResolvedValue([]);
    p.actuacionProceso.createMany.mockResolvedValue({ count: 1 });
    p.proceso.update.mockResolvedValue({});

    await sincronizarActuaciones(t, "pr1");

    expect(mockConsultar).toHaveBeenCalled(); // básicos vacíos → consulta el Endpoint A pese a la caché
    const update = p.proceso.update.mock.calls[0][0];
    expect(update.data.datos).toMatchObject({ juzgado: "JUZGADO 5", fechaRadicacion: "2021-05-27" });
    expect(update.data.despachoJuzgado).toBe("JUZGADO 5");
  });
});

describe("sincronizarTodas (cron masivo)", () => {
  it("recorre los procesos con radicado, tolera fallos y totaliza", async () => {
    p.proceso.findMany.mockResolvedValue([
      { id: "pr1", radicado: RAD, idProcesoRama: "111", datos: {} },
      { id: "pr2", radicado: RAD, idProcesoRama: "222", datos: {} },
      { id: "pr3", radicado: RAD, idProcesoRama: "333", datos: {} },
    ]);
    // pr1: 1 nueva · pr2: la Rama falla (502) · pr3: sin novedades
    mockActuaciones
      .mockResolvedValueOnce([{ fechaActuacion: "2026-03-09T00:00:00", actuacion: "A", anotacion: null }])
      .mockRejectedValueOnce(new Error("502"))
      .mockResolvedValueOnce([{ fechaActuacion: "2026-03-09T00:00:00", actuacion: "B", anotacion: null }]);
    p.actuacionProceso.findMany
      .mockResolvedValueOnce([]) // pr1: ninguna existente → 1 nueva
      .mockResolvedValueOnce([{ huella: "x" }]); // pr3: ya existe (huella coincide abajo no importa)
    p.actuacionProceso.createMany.mockResolvedValue({ count: 1 });
    p.proceso.update.mockResolvedValue({});

    const r = await sincronizarTodas();

    expect(r.procesos).toBe(3);
    expect(r.errores).toBe(1);
    expect(r.conNovedad).toBeGreaterThanOrEqual(1);
    expect(mockActuaciones).toHaveBeenCalledTimes(3);
  });
});

describe("importarDocumentosRama (P9)", () => {
  it("importa solo los no importados (idempotente) y descarga+guarda el PDF", async () => {
    p.proceso.findFirst.mockResolvedValue({
      id: "pr1", radicado: RAD, idProcesoRama: "111", codigoInterno: "EXP-1", empresa: { id: "e1", nombre: "Bufete" },
    });
    mockDocs.mockResolvedValue([
      { idRegDocumento: 100, descripcion: "Auto admisorio", fechaCarga: "2026-01-01", consActuacion: null },
      { idRegDocumento: 200, descripcion: "Certificación", fechaCarga: "2026-02-01", consActuacion: null },
    ]);
    p.documentoProceso.findMany.mockResolvedValue([{ origenRamaIdReg: "100" }]); // 100 ya importado
    mockDescarga.mockResolvedValue({ buffer: Buffer.from("%PDF-..."), tipo: "application/pdf" });
    p.documentoProceso.create.mockResolvedValue({});

    const r = await importarDocumentosRama(t, "pr1");

    expect(r).toMatchObject({ importados: 1, omitidos: 1, fallidos: 0 });
    expect(mockDescarga).toHaveBeenCalledTimes(1); // solo el 200
    expect(mockDescarga).toHaveBeenCalledWith(200);
    const creado = p.documentoProceso.create.mock.calls[0][0].data;
    expect(creado).toMatchObject({ procesoId: "pr1", origenRamaIdReg: "200", tipo: "application/pdf" });
  });

  it("un documento no-PDF/grande (descarga null) se cuenta como fallido, no rompe", async () => {
    p.proceso.findFirst.mockResolvedValue({ id: "pr1", radicado: RAD, idProcesoRama: "111", codigoInterno: "EXP-1", empresa: { id: "e1", nombre: "B" } });
    mockDocs.mockResolvedValue([{ idRegDocumento: 300, descripcion: "X", fechaCarga: null, consActuacion: null }]);
    p.documentoProceso.findMany.mockResolvedValue([]);
    mockDescarga.mockResolvedValue(null); // no es PDF / excede tamaño
    const r = await importarDocumentosRama(t, "pr1");
    expect(r).toMatchObject({ importados: 0, fallidos: 1 });
    expect(p.documentoProceso.create).not.toHaveBeenCalled();
  });
});
