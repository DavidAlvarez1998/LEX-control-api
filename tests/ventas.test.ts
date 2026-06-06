import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/index", () => {
  const prisma: any = {
    usuario: { findUnique: vi.fn(), findFirst: vi.fn() },
    prospecto: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    comision: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    plan: { findUnique: vi.fn() },
    empresa: { create: vi.fn() },
    suscripcion: { create: vi.fn() },
    $transaction: vi.fn((cb: any) => cb(prisma)),
  };
  return { prisma };
});

import { createApp } from "../src/app";
import { prisma } from "../src/index";
import { signToken } from "../src/modules/auth/auth.service";

const app = createApp();
const p = prisma as any;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const adminTok = signToken({ sub: "adm1", rol: "ADMIN" });
const comTok = signToken({ sub: "com1", rol: "COMERCIAL" });

// Cuenta que ve requireAuth (y, para COMERCIAL, también el lookup del % en /ganar).
const cuentaPlataforma = (porcentajeComision: number | null) => ({
  activo: true, activationToken: null, tokenVersion: 0, empresaId: null,
  esAdminEmpresa: false, empresa: null, rolesEmpresa: [], porcentajeComision,
});

beforeEach(() => {
  vi.clearAllMocks();
  p.usuario.findUnique.mockResolvedValue(cuentaPlataforma(10));
  p.usuario.findFirst.mockResolvedValue({ id: "com1" }); // assertComercial OK por defecto
});

describe("autorización", () => {
  it("401 sin token", async () => {
    expect((await request(app).get("/prospectos")).status).toBe(401);
  });
});

describe("prospectos — alcance por rol", () => {
  it("COMERCIAL lista solo los suyos (where comercialId = sub)", async () => {
    p.prospecto.findMany.mockResolvedValue([]);
    await request(app).get("/prospectos").set(auth(comTok));
    expect(p.prospecto.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ comercialId: "com1" }) }),
    );
  });

  it("ADMIN lista todo (sin comercialId forzado)", async () => {
    p.prospecto.findMany.mockResolvedValue([]);
    await request(app).get("/prospectos").set(auth(adminTok));
    const arg = p.prospecto.findMany.mock.calls[0][0];
    expect(arg.where.comercialId).toBeUndefined();
  });

  it("COMERCIAL al crear fuerza comercialId = sí mismo (ignora el del body)", async () => {
    p.prospecto.create.mockResolvedValue({ id: "pr1" });
    const res = await request(app).post("/prospectos").set(auth(comTok))
      .send({ nombreEmpresa: "Despacho X", nombreContacto: "Ana", comercialId: "otro" });
    expect(res.status).toBe(201);
    expect(p.prospecto.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ comercialId: "com1" }) }),
    );
  });

  it("400 si el plan de interés no existe", async () => {
    p.plan.findUnique.mockResolvedValue(null);
    const res = await request(app).post("/prospectos").set(auth(adminTok))
      .send({ nombreEmpresa: "X", nombreContacto: "Ana", planInteresId: "noexiste" });
    expect(res.status).toBe(400);
  });

  it("PATCH no puede saltar a GANADO directo (400 de validación)", async () => {
    const res = await request(app).patch("/prospectos/pr1").set(auth(adminTok)).send({ estado: "GANADO" });
    expect(res.status).toBe(400);
  });

  it("COMERCIAL no puede reasignar (comercialId se ignora en el update)", async () => {
    p.prospecto.findFirst.mockResolvedValue({ id: "pr1", comercialId: "com1" });
    p.prospecto.updateMany.mockResolvedValue({ count: 1 });
    p.prospecto.findUnique.mockResolvedValue({ id: "pr1" });
    await request(app).patch("/prospectos/pr1").set(auth(comTok)).send({ comercialId: "otro", cargo: "CEO" });
    const arg = p.prospecto.updateMany.mock.calls[0][0];
    expect(arg.data.comercialId).toBeUndefined();
    expect(arg.data.cargo).toBe("CEO");
  });
});

describe("ganar — convierte a Empresa + Suscripcion + Comision", () => {
  const prospectoGanable = { id: "pr1", estado: "NEGOCIACION", comercialId: "com1", nombreEmpresa: "Despacho X", email: "x@x.co", telefono: null, planInteresId: "planPro" };

  beforeEach(() => {
    p.prospecto.findFirst.mockResolvedValue(prospectoGanable);
    p.plan.findUnique.mockResolvedValue({ id: "planPro", precioMensual: 100000 });
    p.empresa.create.mockResolvedValue({ id: "emp1" });
    p.suscripcion.create.mockResolvedValue({ id: "sus1" });
    p.prospecto.update.mockResolvedValue({ id: "pr1", estado: "GANADO", empresaId: "emp1" });
    p.comision.create.mockImplementation((args: any) => Promise.resolve({ id: "co1", ...args.data }));
  });

  it("201 crea empresa, suscripción y comisión con % del comercial", async () => {
    const res = await request(app).post("/prospectos/pr1/ganar").set(auth(adminTok)).send({});
    expect(res.status).toBe(201);
    expect(p.empresa.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ nombre: "Despacho X" }) }));
    expect(p.suscripcion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ empresaId: "emp1", planId: "planPro", estado: "ACTIVA" }) }));
    const com = p.comision.create.mock.calls[0][0].data;
    expect(com.baseCalculo).toBe(100000);
    expect(Number(com.porcentaje)).toBe(10);
    expect(com.monto).toBe(10000); // 100000 * 10%
    expect(com.estado).toBe("PENDIENTE");
  });

  it("monto fijo sobreescribe el porcentaje", async () => {
    const res = await request(app).post("/prospectos/pr1/ganar").set(auth(adminTok)).send({ montoComisionFijo: 25000 });
    expect(res.status).toBe(201);
    const com = p.comision.create.mock.calls[0][0].data;
    expect(com.monto).toBe(25000);
    expect(com.porcentaje).toBeNull();
  });

  it("precio negociado cambia la base de la comisión", async () => {
    await request(app).post("/prospectos/pr1/ganar").set(auth(adminTok)).send({ precioVenta: 200000 });
    const com = p.comision.create.mock.calls[0][0].data;
    expect(com.baseCalculo).toBe(200000);
    expect(com.monto).toBe(20000);
  });

  it("409 si ya fue ganado", async () => {
    p.prospecto.findFirst.mockResolvedValue({ ...prospectoGanable, estado: "GANADO" });
    const res = await request(app).post("/prospectos/pr1/ganar").set(auth(adminTok)).send({});
    expect(res.status).toBe(409);
    expect(p.empresa.create).not.toHaveBeenCalled();
  });

  it("400 si no hay comercial asignado", async () => {
    p.prospecto.findFirst.mockResolvedValue({ ...prospectoGanable, comercialId: null });
    const res = await request(app).post("/prospectos/pr1/ganar").set(auth(adminTok)).send({});
    expect(res.status).toBe(400);
  });
});

describe("perder", () => {
  it("marca PERDIDO con motivo", async () => {
    p.prospecto.findFirst.mockResolvedValue({ id: "pr1", estado: "CONTACTADO", comercialId: "com1" });
    p.prospecto.update.mockResolvedValue({ id: "pr1", estado: "PERDIDO" });
    const res = await request(app).post("/prospectos/pr1/perder").set(auth(comTok)).send({ motivoPerdida: "Precio" });
    expect(res.status).toBe(200);
    expect(p.prospecto.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ estado: "PERDIDO", motivoPerdida: "Precio" }) }));
  });
});

describe("comisiones", () => {
  it("COMERCIAL solo ve las suyas", async () => {
    p.comision.findMany.mockResolvedValue([]);
    await request(app).get("/comisiones").set(auth(comTok));
    expect(p.comision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ comercialId: "com1" }) }),
    );
  });

  it("403 si un COMERCIAL intenta marcar pagada", async () => {
    const res = await request(app).patch("/comisiones/co1").set(auth(comTok)).send({ estado: "PAGADA" });
    expect(res.status).toBe(403);
  });

  it("ADMIN marca PAGADA y fija fechaPago", async () => {
    p.comision.findUnique.mockResolvedValue({ id: "co1" });
    p.comision.update.mockResolvedValue({ id: "co1", estado: "PAGADA" });
    const res = await request(app).patch("/comisiones/co1").set(auth(adminTok)).send({ estado: "PAGADA" });
    expect(res.status).toBe(200);
    const arg = p.comision.update.mock.calls[0][0];
    expect(arg.data.estado).toBe("PAGADA");
    expect(arg.data.fechaPago).toBeInstanceOf(Date);
  });
});
