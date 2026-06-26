import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/index", () => {
  const prisma: any = {
    usuario: { findUnique: vi.fn() },
    cliente: { findFirst: vi.fn() },
    proceso: { findFirst: vi.fn() },
    contratoComercial: { findFirst: vi.fn() },
    cuentaBancaria: { findFirst: vi.fn() },
    factura: {
      findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    facturaItem: { deleteMany: vi.fn() },
    ingreso: { aggregate: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
    permiso: { findUnique: vi.fn() },
    modulo: { findMany: vi.fn() },
    suscripcion: { findUnique: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(), // lock FOR UPDATE en registrarPago (no-op en el mock)
  };
  // La transacción corre el callback con el MISMO prisma mockeado (tx === prisma).
  prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
  return { prisma };
});

import { createApp } from "../src/app";
import { prisma } from "../src/index";
import { signToken } from "../src/modules/auth/auth.service";

const app = createApp();
const p = prisma as any;
const token = signToken({ sub: "u1", rol: "USUARIO" });
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const adminEmpresa = { activo: true, activationToken: null, tokenVersion: 0, empresaId: "eA", esAdminEmpresa: true, rolesEmpresa: [] };
const year = new Date().getFullYear();

function contableContratado(si: boolean) {
  p.suscripcion.findUnique.mockResolvedValue({
    estado: "ACTIVA", plan: { modulos: si ? [{ modulo: { clave: "contable" } }] : [], cuotas: [] }, modulos: [], cuotas: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  p.$transaction.mockImplementation(async (fn: any) => fn(p));
  p.usuario.findUnique.mockResolvedValue(adminEmpresa);
  p.permiso.findUnique.mockResolvedValue({ modulo: { clave: "contable" }, roles: [{ rolEmpresa: "CONTABLE" }] });
  p.modulo.findMany.mockResolvedValue([]);
  p.ingreso.aggregate.mockResolvedValue({ _sum: { valorRecibido: null } });
  contableContratado(true);
});

describe("autorización", () => {
  it("401 sin token", async () => {
    expect((await request(app).get("/facturacion/facturas")).status).toBe(401);
  });
  it("403 si el módulo contable no está contratado", async () => {
    contableContratado(false);
    const res = await request(app).get("/facturacion/facturas").set(auth(token));
    expect(res.status).toBe(403);
  });
  it("403 si el usuario no es admin de empresa ni tiene el rol", async () => {
    p.usuario.findUnique.mockResolvedValue({ ...adminEmpresa, esAdminEmpresa: false, rolesEmpresa: ["JURIDICO"] });
    const res = await request(app).get("/facturacion/facturas").set(auth(token));
    expect(res.status).toBe(403);
  });
});

describe("crear borrador", () => {
  it("201 calcula subtotal/IVA/total y fuerza empresaId", async () => {
    p.cliente.findFirst.mockResolvedValue({ id: "c1" });
    p.factura.create.mockResolvedValue({ id: "f1", empresaId: "eA", estado: "BORRADOR", total: 1190000, fechaVencimiento: null, items: [] });
    const res = await request(app).post("/facturacion/facturas").set(auth(token)).send({
      clienteId: "c1", porcentajeIva: 19,
      items: [{ descripcion: "Asesoría", cantidad: 1, valorUnitario: 800000 }, { descripcion: "Derecho de petición", cantidad: 1, valorUnitario: 200000 }],
    });
    expect(res.status).toBe(201);
    expect(p.factura.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ empresaId: "eA", subtotal: 1000000, valorIva: 190000, total: 1190000, registradoPorId: "u1" }) }),
    );
    expect(res.body.estadoPago).toBe("BORRADOR");
  });

  it("400 si no hay ítems", async () => {
    p.cliente.findFirst.mockResolvedValue({ id: "c1" });
    const res = await request(app).post("/facturacion/facturas").set(auth(token)).send({ clienteId: "c1", items: [] });
    expect(res.status).toBe(400);
    expect(p.factura.create).not.toHaveBeenCalled();
  });

  it("404 si el cliente es de otra empresa", async () => {
    p.cliente.findFirst.mockResolvedValue(null);
    const res = await request(app).post("/facturacion/facturas").set(auth(token)).send({
      clienteId: "ajeno", items: [{ descripcion: "x", valorUnitario: 1000 }],
    });
    expect(res.status).toBe(404);
    expect(p.factura.create).not.toHaveBeenCalled();
  });
});

describe("editar / borrar (solo borrador)", () => {
  it("409 al editar una factura EMITIDA", async () => {
    p.factura.findFirst.mockResolvedValue({ id: "f1", empresaId: "eA", estado: "EMITIDA", items: [], porcentajeIva: 19 });
    const res = await request(app).patch("/facturacion/facturas/f1").set(auth(token)).send({ porcentajeIva: 0 });
    expect(res.status).toBe(409);
  });
  it("409 al borrar una factura EMITIDA", async () => {
    p.factura.findFirst.mockResolvedValue({ id: "f1", estado: "EMITIDA" });
    const res = await request(app).delete("/facturacion/facturas/f1").set(auth(token));
    expect(res.status).toBe(409);
    expect(p.factura.delete).not.toHaveBeenCalled();
  });
});

describe("emitir (consecutivo)", () => {
  it("FAC-YYYY-0001 en la primera del año", async () => {
    p.factura.findFirst
      .mockResolvedValueOnce({ id: "f1", empresaId: "eA", estado: "BORRADOR", items: [{ id: "it1", total: 1190000 }] })
      .mockResolvedValueOnce(null); // no hay consecutivo previo
    p.factura.update.mockResolvedValue({ id: "f1", empresaId: "eA", estado: "EMITIDA", total: 1190000, fechaVencimiento: null, numero: `FAC-${year}-0001`, items: [] });
    const res = await request(app).post("/facturacion/facturas/f1/emitir").set(auth(token));
    expect(res.status).toBe(200);
    expect(p.factura.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ numero: `FAC-${year}-0001`, estado: "EMITIDA" }) }),
    );
  });
  it("incrementa el consecutivo previo", async () => {
    p.factura.findFirst
      .mockResolvedValueOnce({ id: "f2", empresaId: "eA", estado: "BORRADOR", items: [{ id: "it", total: 500000 }] })
      .mockResolvedValueOnce({ numero: `FAC-${year}-0003` });
    p.factura.update.mockResolvedValue({ id: "f2", empresaId: "eA", estado: "EMITIDA", total: 500000, fechaVencimiento: null, items: [] });
    await request(app).post("/facturacion/facturas/f2/emitir").set(auth(token));
    expect(p.factura.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ numero: `FAC-${year}-0004` }) }),
    );
  });
  it("409 si ya está emitida", async () => {
    p.factura.findFirst.mockResolvedValueOnce({ id: "f1", estado: "EMITIDA", items: [{ id: "x", total: 1 }] });
    const res = await request(app).post("/facturacion/facturas/f1/emitir").set(auth(token));
    expect(res.status).toBe(409);
  });
  it("409 si no tiene ítems", async () => {
    p.factura.findFirst.mockResolvedValueOnce({ id: "f1", estado: "BORRADOR", items: [] });
    const res = await request(app).post("/facturacion/facturas/f1/emitir").set(auth(token));
    expect(res.status).toBe(409);
  });
});

describe("pagos (= Ingreso vinculado)", () => {
  const emitida = { id: "f1", empresaId: "eA", estado: "EMITIDA", clienteId: "c1", contratoId: null, configuracionCobroId: null, procesoId: null, radicado: null, numero: `FAC-${year}-0001`, total: 1000000, fechaVencimiento: null };

  it("pago parcial: crea Ingreso con facturaId y deriva PARCIAL", async () => {
    p.factura.findFirst.mockResolvedValue(emitida);
    p.ingreso.aggregate
      .mockResolvedValueOnce({ _sum: { valorRecibido: 0 } })       // saldo previo
      .mockResolvedValueOnce({ _sum: { valorRecibido: 400000 } }); // tras el pago
    p.ingreso.create.mockResolvedValue({ id: "i1" });
    p.factura.findUniqueOrThrow.mockResolvedValue({ ...emitida, items: [] });
    const res = await request(app).post("/facturacion/facturas/f1/pagos").set(auth(token))
      .send({ valorRecibido: 400000, metodoPago: "TRANSFERENCIA" });
    expect(res.status).toBe(201);
    expect(p.ingreso.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ facturaId: "f1", clienteId: "c1", valorRecibido: 400000, empresaId: "eA" }) }),
    );
    expect(res.body.estadoPago).toBe("PARCIAL");
    expect(res.body.saldo).toBe(600000);
  });

  it("pago total deriva PAGADA", async () => {
    p.factura.findFirst.mockResolvedValue(emitida);
    p.ingreso.aggregate
      .mockResolvedValueOnce({ _sum: { valorRecibido: 0 } })
      .mockResolvedValueOnce({ _sum: { valorRecibido: 1000000 } });
    p.ingreso.create.mockResolvedValue({ id: "i1" });
    p.factura.findUniqueOrThrow.mockResolvedValue({ ...emitida, items: [] });
    const res = await request(app).post("/facturacion/facturas/f1/pagos").set(auth(token))
      .send({ valorRecibido: 1000000, metodoPago: "EFECTIVO" });
    expect(res.body.estadoPago).toBe("PAGADA");
    expect(res.body.saldo).toBe(0);
  });

  it("400 si el pago excede el saldo", async () => {
    p.factura.findFirst.mockResolvedValue(emitida);
    p.ingreso.aggregate.mockResolvedValueOnce({ _sum: { valorRecibido: 400000 } }); // saldo 600000
    const res = await request(app).post("/facturacion/facturas/f1/pagos").set(auth(token))
      .send({ valorRecibido: 800000, metodoPago: "EFECTIVO" });
    expect(res.status).toBe(400);
    expect(p.ingreso.create).not.toHaveBeenCalled();
  });

  it("409 al pagar un borrador", async () => {
    p.factura.findFirst.mockResolvedValue({ ...emitida, estado: "BORRADOR" });
    const res = await request(app).post("/facturacion/facturas/f1/pagos").set(auth(token))
      .send({ valorRecibido: 100, metodoPago: "EFECTIVO" });
    expect(res.status).toBe(409);
  });

  it("toma lock FOR UPDATE sobre la factura (anti doble-abono concurrente)", async () => {
    p.factura.findFirst.mockResolvedValue(emitida);
    p.ingreso.aggregate
      .mockResolvedValueOnce({ _sum: { valorRecibido: 0 } })
      .mockResolvedValueOnce({ _sum: { valorRecibido: 100000 } });
    p.ingreso.create.mockResolvedValue({ id: "i1" });
    p.factura.findUniqueOrThrow.mockResolvedValue({ ...emitida, items: [] });
    await request(app).post("/facturacion/facturas/f1/pagos").set(auth(token))
      .send({ valorRecibido: 100000, metodoPago: "EFECTIVO" });
    expect(p.$queryRaw).toHaveBeenCalled();
    const [strings, ...valores] = p.$queryRaw.mock.calls[0];
    expect((strings as string[]).join("?")).toContain("FOR UPDATE");
    expect(valores).toContain("f1"); // la factura bloqueada
  });

  it("idempotente: reintento con el mismo numeroComprobante no duplica el Ingreso", async () => {
    p.factura.findFirst.mockResolvedValue(emitida);
    p.ingreso.findFirst.mockResolvedValue({ id: "iya", numeroComprobante: "REC-001" }); // ya existe
    p.ingreso.aggregate.mockResolvedValue({ _sum: { valorRecibido: 400000 } });
    p.factura.findUniqueOrThrow.mockResolvedValue({ ...emitida, items: [] });
    const res = await request(app).post("/facturacion/facturas/f1/pagos").set(auth(token))
      .send({ valorRecibido: 400000, metodoPago: "TRANSFERENCIA", numeroComprobante: "REC-001" });
    expect(res.status).toBe(201);
    expect(p.ingreso.create).not.toHaveBeenCalled(); // no se duplica
  });
});

describe("estado derivado", () => {
  it("VENCIDA: emitida, vencida y con saldo", async () => {
    const pasado = new Date(Date.now() - 86400000);
    p.factura.findMany.mockResolvedValue([
      { id: "f1", empresaId: "eA", estado: "EMITIDA", total: 1000000, fechaVencimiento: pasado, cliente: { nombre: "ACME" } },
    ]);
    p.ingreso.aggregate.mockResolvedValue({ _sum: { valorRecibido: 0 } });
    const res = await request(app).get("/facturacion/facturas").set(auth(token));
    expect(res.body[0].estadoPago).toBe("VENCIDA");
  });
  it("PAGADA nunca aparece como VENCIDA", async () => {
    const pasado = new Date(Date.now() - 86400000);
    p.factura.findMany.mockResolvedValue([
      { id: "f1", empresaId: "eA", estado: "EMITIDA", total: 1000000, fechaVencimiento: pasado, cliente: { nombre: "ACME" } },
    ]);
    p.ingreso.aggregate.mockResolvedValue({ _sum: { valorRecibido: 1000000 } });
    const res = await request(app).get("/facturacion/facturas").set(auth(token));
    expect(res.body[0].estadoPago).toBe("PAGADA");
  });
});

describe("anular", () => {
  it("EMITIDA → ANULADA con motivo", async () => {
    p.factura.findFirst.mockResolvedValue({ id: "f1", estado: "EMITIDA" });
    p.factura.update.mockResolvedValue({ id: "f1", empresaId: "eA", estado: "ANULADA", total: 1000000, fechaVencimiento: null, items: [] });
    const res = await request(app).post("/facturacion/facturas/f1/anular").set(auth(token)).send({ motivo: "Error de digitación" });
    expect(res.status).toBe(200);
    expect(p.factura.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: "ANULADA", motivoAnulacion: "Error de digitación" }) }),
    );
    expect(res.body.estadoPago).toBe("ANULADA");
  });
  it("409 si no está emitida", async () => {
    p.factura.findFirst.mockResolvedValue({ id: "f1", estado: "BORRADOR" });
    const res = await request(app).post("/facturacion/facturas/f1/anular").set(auth(token)).send({ motivo: "x" });
    expect(res.status).toBe(409);
  });
});
