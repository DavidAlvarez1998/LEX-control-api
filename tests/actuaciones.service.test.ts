// Tests del servicio de ACTUACIONES (sync Rama Judicial) con prisma y el cliente
// de la Rama MOCKEADOS. Verifican: validación del radicado, sync idempotente
// (inserta solo nuevas), cacheo de idProcesoRama y autollenado de ultimaActuacion.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/index", () => ({
  prisma: {
    proceso: { findFirst: vi.fn(), update: vi.fn() },
    actuacionProceso: { findMany: vi.fn(), createMany: vi.fn() },
  },
}));
vi.mock("../src/modules/rama-judicial", () => ({
  consultarRadicado: vi.fn(),
  obtenerActuaciones: vi.fn(),
}));

import { prisma } from "../src/index";
import { consultarRadicado, obtenerActuaciones } from "../src/modules/rama-judicial";
import { normalizarRadicado, sincronizarActuaciones, validarRadicado } from "../src/modules/procesos/actuaciones.service";

const p = prisma as any;
const mockConsultar = consultarRadicado as unknown as ReturnType<typeof vi.fn>;
const mockActuaciones = obtenerActuaciones as unknown as ReturnType<typeof vi.fn>;
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

  it("inserta solo las nuevas, cachea idProcesoRama y autollena ultimaActuacion", async () => {
    p.proceso.findFirst.mockResolvedValue({ id: "pr1", radicado: RAD, idProcesoRama: null, datos: { foo: "bar" } });
    mockConsultar.mockResolvedValue({ encontrado: true, idProceso: 1810780324, esPrivado: false });
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
    // la más reciente (2026-03-09) alimenta ultimaActuacion, conservando datos previos
    expect(update.data.datos).toMatchObject({ foo: "bar", ultimaActuacion: "RECIBE MEMORIALES" });
  });

  it("idempotente: si todas ya existen, no inserta", async () => {
    p.proceso.findFirst.mockResolvedValue({ id: "pr1", radicado: RAD, idProcesoRama: "1810780324", datos: {} });
    mockActuaciones.mockResolvedValue([{ fechaActuacion: "2026-03-09T00:00:00", actuacion: "RECIBE MEMORIALES", anotacion: "x" }]);
    // findMany devuelve la huella ya existente → 0 nuevas. Reproducimos el hash:
    const { createHash } = await import("crypto");
    const huella = createHash("sha256").update("2026-03-09T00:00:00|RECIBE MEMORIALES|x").digest("hex");
    p.actuacionProceso.findMany.mockResolvedValue([{ huella }]);
    p.proceso.update.mockResolvedValue({});

    const r = await sincronizarActuaciones(t, "pr1");

    expect(r).toMatchObject({ nuevas: 0, total: 1 });
    expect(p.actuacionProceso.createMany).not.toHaveBeenCalled();
    expect(mockConsultar).not.toHaveBeenCalled(); // idProcesoRama cacheado → no llama Endpoint A
  });
});
