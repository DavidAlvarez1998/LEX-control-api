import { Prisma } from "@prisma/client";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/index", () => {
  const prisma: any = {
    usuario: { findUnique: vi.fn() },
    plan: { findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
    planModulo: { create: vi.fn(), deleteMany: vi.fn() },
    planCuota: { create: vi.fn(), deleteMany: vi.fn() },
    modulo: { findMany: vi.fn() },
    empresa: { findMany: vi.fn(), findUnique: vi.fn() },
    suscripcion: { upsert: vi.fn() },
    $transaction: vi.fn((cb: any) => cb(prisma)),
  };
  return { prisma };
});

import { createApp } from "../src/app";
import { prisma } from "../src/index";
import { signToken } from "../src/modules/auth/auth.service";

const app = createApp();
const p = prisma as any;
const adminToken = signToken({ sub: "admin1", rol: "ADMIN" });
const clienteToken = signToken({ sub: "cli1", rol: "USUARIO" });
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const prismaError = (code: string) => new Prisma.PrismaClientKnownRequestError("mock", { code, clientVersion: "test" });

const planRow = (over = {}) => ({
  id: "p1", clave: "firma", nombre: "Firma", precioMensual: 500000, activo: true, orden: 3,
  modulos: [{ modulo: { clave: "contable" } }], cuotas: [{ rolEmpresa: "JURIDICO", limite: 5 }], ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  p.usuario.findUnique.mockResolvedValue({ activo: true, activationToken: null, tokenVersion: 0 });
});

describe("autorización", () => {
  it("401 sin token", async () => {
    expect((await request(app).get("/planes")).status).toBe(401);
  });
  it("403 con rol USUARIO (solo ADMIN de plataforma)", async () => {
    expect((await request(app).get("/planes").set(auth(clienteToken))).status).toBe(403);
  });
});

describe("GET /planes", () => {
  it("200 con planes shaped (modulos como claves, cuotas como mapa)", async () => {
    p.plan.findMany.mockResolvedValue([planRow()]);
    const res = await request(app).get("/planes").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ clave: "firma", precioMensual: 500000, modulos: ["contable"], cuotas: { JURIDICO: 5 } });
  });
  it("GET /planes/modulos lista módulos", async () => {
    p.modulo.findMany.mockResolvedValue([{ id: "m1", clave: "contable", nombre: "Contable", esBaseline: false }]);
    const res = await request(app).get("/planes/modulos").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe("POST /planes", () => {
  it("201 crea plan + módulos + cupos", async () => {
    p.modulo.findMany.mockResolvedValue([{ id: "m1" }]);
    p.plan.create.mockResolvedValue({ id: "p9" });
    p.planModulo.create.mockResolvedValue({});
    p.planCuota.create.mockResolvedValue({});
    p.plan.findUniqueOrThrow.mockResolvedValue(planRow({ id: "p9", clave: "nuevo" }));
    const res = await request(app).post("/planes").set(auth(adminToken))
      .send({ clave: "nuevo", nombre: "Nuevo", precioMensual: 100000, modulos: ["contable"], cuotas: { JURIDICO: 3, ADMINISTRADOR: null } });
    expect(res.status).toBe(201);
    expect(p.plan.create).toHaveBeenCalled();
    expect(p.planModulo.create).toHaveBeenCalledWith(expect.objectContaining({ data: { planId: "p9", moduloId: "m1" } }));
    expect(p.planCuota.create).toHaveBeenCalled();
  });
  it("409 si la clave ya existe (P2002)", async () => {
    p.modulo.findMany.mockResolvedValue([]);
    p.plan.create.mockRejectedValue(prismaError("P2002"));
    const res = await request(app).post("/planes").set(auth(adminToken))
      .send({ clave: "firma", nombre: "Dup", precioMensual: 1, modulos: [], cuotas: {} });
    expect(res.status).toBe(409);
  });
  it("400 con clave inválida (mayúsculas)", async () => {
    const res = await request(app).post("/planes").set(auth(adminToken))
      .send({ clave: "Firma PRO", nombre: "X", precioMensual: 1 });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /planes/:id", () => {
  it("200 reemplaza módulos y cupos cuando vienen", async () => {
    p.plan.update.mockResolvedValue({});
    p.modulo.findMany.mockResolvedValue([{ id: "m2" }]);
    p.planModulo.deleteMany.mockResolvedValue({ count: 1 });
    p.planModulo.create.mockResolvedValue({});
    p.planCuota.deleteMany.mockResolvedValue({ count: 1 });
    p.planCuota.create.mockResolvedValue({});
    p.plan.findUniqueOrThrow.mockResolvedValue(planRow());
    const res = await request(app).patch("/planes/p1").set(auth(adminToken))
      .send({ precioMensual: 600000, modulos: ["comercial"], cuotas: { JURIDICO: 8 } });
    expect(res.status).toBe(200);
    expect(p.planModulo.deleteMany).toHaveBeenCalledWith({ where: { planId: "p1" } });
    expect(p.planCuota.deleteMany).toHaveBeenCalledWith({ where: { planId: "p1" } });
  });
  it("404 si el plan no existe (P2025)", async () => {
    p.plan.update.mockRejectedValue(prismaError("P2025"));
    const res = await request(app).patch("/planes/nope").set(auth(adminToken)).send({ nombre: "X" });
    expect(res.status).toBe(404);
  });
});

describe("asignación de plan a despacho", () => {
  it("GET /planes/suscripciones lista despachos con su plan", async () => {
    p.empresa.findMany.mockResolvedValue([{ id: "e1", nombre: "ACME", activo: true, suscripcion: { estado: "ACTIVA", plan: { clave: "firma", nombre: "Firma" } } }]);
    const res = await request(app).get("/planes/suscripciones").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ nombre: "ACME", plan: "Firma", planClave: "firma" });
  });
  it("PUT /planes/suscripciones/:id asigna (upsert)", async () => {
    p.plan.findUnique.mockResolvedValue({ id: "p1" });
    p.empresa.findUnique.mockResolvedValue({ id: "e1" });
    p.suscripcion.upsert.mockResolvedValue({});
    const res = await request(app).put("/planes/suscripciones/e1").set(auth(adminToken)).send({ planId: "p1" });
    expect(res.status).toBe(200);
    expect(p.suscripcion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { empresaId: "e1" }, create: expect.objectContaining({ planId: "p1", estado: "ACTIVA" }) }),
    );
  });
  it("400 si el plan no existe", async () => {
    p.plan.findUnique.mockResolvedValue(null);
    const res = await request(app).put("/planes/suscripciones/e1").set(auth(adminToken)).send({ planId: "nope" });
    expect(res.status).toBe(400);
  });
});
