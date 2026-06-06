import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/index", () => {
  const m = () => ({ findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), aggregate: vi.fn() });
  const prisma: any = {
    usuario: { findUnique: vi.fn() },
    cliente: { findFirst: vi.fn() },
    proceso: { findFirst: vi.fn() },
    ingreso: m(),
    egreso: m(),
    nomina: m(),
    cajaMenor: m(),
    cajaMenorMovimiento: m(),
    servicioFijo: m(),
    cuentaBancaria: m(),
    cartera: { ...m(), update: vi.fn() },
    contratoComercial: m(),
    configuracionCobro: { findUnique: vi.fn() },
    permiso: { findUnique: vi.fn() },
    modulo: { findMany: vi.fn() },
    suscripcion: { findUnique: vi.fn() },
  };
  return { prisma };
});

import { createApp } from "../src/app";
import { prisma } from "../src/index";
import { signToken } from "../src/modules/auth/auth.service";

const app = createApp();
const p = prisma as any;
const token = signToken({ sub: "cli1", rol: "USUARIO" });
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const cuenta = { activo: true, activationToken: null, tokenVersion: 0, empresaId: "eA", esAdminEmpresa: true, rolesEmpresa: [] };

function contableContratado(si: boolean) {
  p.suscripcion.findUnique.mockResolvedValue({
    estado: "ACTIVA", plan: { modulos: si ? [{ modulo: { clave: "contable" } }] : [], cuotas: [] }, modulos: [], cuotas: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  p.usuario.findUnique.mockResolvedValue(cuenta);
  p.permiso.findUnique.mockResolvedValue({ modulo: { clave: "contable" }, roles: [{ rolEmpresa: "CONTABLE" }] });
  p.modulo.findMany.mockResolvedValue([]);
  contableContratado(true);
});

describe("autorización", () => {
  it("401 sin token", async () => {
    expect((await request(app).get("/contable/ingresos")).status).toBe(401);
  });
  it("403 si el módulo contable no está contratado", async () => {
    contableContratado(false);
    const res = await request(app).get("/contable/ingresos").set(auth(token));
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("Módulo no contratado");
  });
});

describe("ingresos", () => {
  it("201 fuerza empresaId + registradoPorId del token", async () => {
    p.cliente.findFirst.mockResolvedValue({ id: "c1" });
    p.ingreso.create.mockResolvedValue({ id: "i1" });
    const res = await request(app).post("/contable/ingresos").set(auth(token))
      .send({ clienteId: "c1", conceptoPago: "Anticipo", tipoCobro: "ANTICIPO", valorRecibido: 500000, metodoPago: "TRANSFERENCIA" });
    expect(res.status).toBe(201);
    expect(p.ingreso.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ empresaId: "eA", registradoPorId: "cli1" }) }),
    );
  });
  it("400 si el cliente es de otra empresa", async () => {
    p.cliente.findFirst.mockResolvedValue(null);
    const res = await request(app).post("/contable/ingresos").set(auth(token))
      .send({ clienteId: "ajeno", conceptoPago: "x", tipoCobro: "ABONO", valorRecibido: 1, metodoPago: "EFECTIVO" });
    expect(res.status).toBe(400);
    expect(p.ingreso.create).not.toHaveBeenCalled();
  });
});

describe("derivaciones de saldo", () => {
  it("cuenta: saldoActual = saldoInicial + ingresos PAGADO − egresos PAGADO", async () => {
    p.cuentaBancaria.findFirst.mockResolvedValue({ id: "cu1", saldoInicial: 1000000, nombreBolsa: "Principal" });
    p.ingreso.aggregate.mockResolvedValue({ _sum: { valorRecibido: 500000 } });
    p.egreso.aggregate.mockResolvedValue({ _sum: { valorGasto: 200000 } });
    const res = await request(app).get("/contable/cuentas/cu1").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.saldoActual).toBe(1300000); // 1.000.000 + 500.000 − 200.000
  });

  it("caja menor: saldoActual = montoInicial − salidas + reposiciones", async () => {
    p.cajaMenor.findFirst.mockResolvedValue({ id: "ca1", montoInicial: 100000, nombre: "Caja 1" });
    p.cajaMenorMovimiento.findMany.mockResolvedValue([
      { id: "m1", tipoMovimiento: "SALIDA", valor: 30000 },
      { id: "m2", tipoMovimiento: "REPOSICION", valor: 50000 },
    ]);
    const res = await request(app).get("/contable/cajas/ca1").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.saldoActual).toBe(120000); // 100.000 − 30.000 + 50.000
    expect(res.body.movimientos).toHaveLength(2);
  });
});

describe("cartera", () => {
  it("abre desde un contrato: snapshot del total (FIJO) + saldo derivado", async () => {
    p.contratoComercial.findFirst.mockResolvedValue({ id: "k1", clienteId: "c1", tipoCobroAcordado: "FIJO", valorAcordado: null });
    p.configuracionCobro.findUnique.mockResolvedValue({ id: "cfg1", modalidadCobro: "FIJO", valorFijo: 3000000, fechaPrimerPago: null });
    p.cartera.create.mockResolvedValue({
      id: "car1", empresaId: "eA", clienteId: "c1", procesoId: null,
      contratoId: "k1", configuracionCobroId: "cfg1", valorTotalAcordado: 3000000,
    });
    p.ingreso.aggregate.mockResolvedValue({ _sum: { valorRecibido: 1000000 } }); // ya pagado
    const res = await request(app).post("/contable/cartera").set(auth(token)).send({ contratoId: "k1" });
    expect(res.status).toBe(201);
    expect(p.cartera.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ valorTotalAcordado: 3000000, configuracionCobroId: "cfg1" }) }),
    );
    expect(res.body.valorPagado).toBe(1000000);
    expect(res.body.saldoPendiente).toBe(2000000); // 3.000.000 − 1.000.000
  });
});

describe("reportes", () => {
  it("P&L mensual = ingresos − (egresos + nómina + servicios + caja)", async () => {
    p.ingreso.aggregate.mockResolvedValue({ _sum: { valorRecibido: 5000000 } });
    p.egreso.aggregate.mockResolvedValue({ _sum: { valorGasto: 800000 } });
    p.nomina.aggregate.mockResolvedValue({ _sum: { valorNetoPagar: 2000000 } });
    p.servicioFijo.aggregate.mockResolvedValue({ _sum: { valorFacturado: 500000 } });
    p.cajaMenorMovimiento.aggregate.mockResolvedValue({ _sum: { valor: 100000 } });
    const res = await request(app).get("/contable/reportes?periodo=2026-06").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.totalIngresos).toBe(5000000);
    expect(res.body.totalEgresos).toBe(3400000); // 800k+2M+500k+100k
    expect(res.body.utilidadNeta).toBe(1600000);
  });

  it("400 sin periodo válido", async () => {
    const res = await request(app).get("/contable/reportes?periodo=junio").set(auth(token));
    expect(res.status).toBe(400);
  });
});
