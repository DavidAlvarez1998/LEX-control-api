import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock Prisma. Las rutas pasan por requireAuth (usuario.findUnique) y
// requirePermiso (permiso.findUnique + resolveEntitlements: modulo.findMany +
// suscripcion.findUnique).
vi.mock("../src/index", () => {
  const prisma: any = {
    usuario: { findUnique: vi.fn() },
    cliente: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    litigante: { findUnique: vi.fn(), upsert: vi.fn(), create: vi.fn() },
    tipoProceso: { findUnique: vi.fn() },
    permiso: { findUnique: vi.fn() },
    modulo: { findMany: vi.fn() },
    suscripcion: { findUnique: vi.fn() },
    // /convertir corre dentro de una transacción (lógica compartida con comercial).
    $transaction: vi.fn((cb: any) => cb(prisma)),
  };
  return { prisma };
});

import { createApp } from "../src/app";
import { prisma } from "../src/index";
import { signToken } from "../src/modules/auth/auth.service";

const app = createApp();
const p = prisma as any;
const clienteToken = signToken({ sub: "cli1", rol: "USUARIO" });
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// Cuenta del portador para requireAuth (admin de empresa eA).
const cuenta = {
  activo: true,
  activationToken: null,
  tokenVersion: 0,
  empresaId: "eA",
  esAdminEmpresa: true,
  rolesEmpresa: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  p.usuario.findUnique.mockResolvedValue(cuenta);
  p.permiso.findUnique.mockResolvedValue({
    modulo: { clave: "comercial" },
    roles: [{ rolEmpresa: "COMERCIAL" }],
  });
  p.modulo.findMany.mockResolvedValue([]); // baseline
  // Suscripción ACTIVA con el módulo comercial contratado.
  p.suscripcion.findUnique.mockResolvedValue({
    estado: "ACTIVA",
    plan: { modulos: [{ modulo: { clave: "comercial" } }], cuotas: [] },
    modulos: [],
    cuotas: [],
  });
});

describe("autorización", () => {
  it("401 sin token", async () => {
    const res = await request(app).get("/clientes");
    expect(res.status).toBe(401);
  });

  it("403 si el módulo comercial no está contratado", async () => {
    p.suscripcion.findUnique.mockResolvedValue({
      estado: "ACTIVA",
      plan: { modulos: [], cuotas: [] }, // sin comercial
      modulos: [],
      cuotas: [],
    });
    const res = await request(app).get("/clientes").set(auth(clienteToken));
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("Módulo no contratado");
  });
});

describe("GET /clientes", () => {
  it("200 y acota por empresa del token", async () => {
    p.cliente.findMany.mockResolvedValue([{ id: "c1", nombre: "Juan", estado: "PROSPECTO" }]);
    const res = await request(app).get("/clientes").set(auth(clienteToken));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(p.cliente.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ empresaId: "eA" }) }),
    );
  });
});

describe("POST /clientes", () => {
  it("201 crea un prospecto forzando empresaId + responsable = creador del token", async () => {
    p.cliente.create.mockResolvedValue({ id: "c1", nombre: "Juan", estado: "PROSPECTO" });
    const res = await request(app)
      .post("/clientes")
      .set(auth(clienteToken))
      .send({ nombre: "Juan", canalIngreso: "WHATSAPP" });
    expect(res.status).toBe(201);
    // Sin responsable en el body → se asigna al creador (sub del token).
    expect(p.cliente.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ empresaId: "eA", nombre: "Juan", responsableComercialId: "cli1" }),
      }),
    );
  });

  it("400 con nombre vacío", async () => {
    const res = await request(app).post("/clientes").set(auth(clienteToken)).send({});
    expect(res.status).toBe(400);
  });

  it("400 si el responsable comercial es de otra empresa (FK cross-tenant)", async () => {
    p.usuario.findUnique.mockImplementation(({ where }: any) =>
      where.id === "cli1"
        ? Promise.resolve(cuenta)
        : Promise.resolve({ empresaId: "eB" }), // el responsable es de eB
    );
    const res = await request(app)
      .post("/clientes")
      .set(auth(clienteToken))
      .send({ nombre: "Juan", responsableComercialId: "user-de-eB" });
    expect(res.status).toBe(400);
    expect(p.cliente.create).not.toHaveBeenCalled();
  });
});

describe("GET /clientes/:id", () => {
  it("404 si no existe o es de otra empresa", async () => {
    p.cliente.findFirst.mockResolvedValue(null);
    const res = await request(app).get("/clientes/x").set(auth(clienteToken));
    expect(res.status).toBe(404);
    // El findFirst se acota por empresa (no se expone existencia ajena).
    expect(p.cliente.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "x", empresaId: "eA" } }),
    );
  });
});

describe("POST /clientes/:id/convertir", () => {
  it("vincula (upsert) un Litigante por documento y marca CLIENTE", async () => {
    p.cliente.findFirst.mockResolvedValue({
      id: "c1", empresaId: "eA", litiganteId: null, nombre: "Juan",
      tipoPersona: "NATURAL", tipoDocumento: "CC", numeroDocumento: "123",
      email: null, telefono: null,
    });
    p.litigante.upsert.mockResolvedValue({ id: "l1" });
    p.cliente.update.mockResolvedValue({ id: "c1", estado: "CLIENTE", litiganteId: "l1" });

    const res = await request(app).post("/clientes/c1/convertir").set(auth(clienteToken));
    expect(res.status).toBe(200);
    expect(p.litigante.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { empresaId_tipoDocumento_numeroDocumento: { empresaId: "eA", tipoDocumento: "CC", numeroDocumento: "123" } },
      }),
    );
    expect(p.cliente.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: "CLIENTE", litiganteId: "l1" }) }),
    );
  });

  it("crea un Litigante nuevo si el cliente no tiene documento", async () => {
    p.cliente.findFirst.mockResolvedValue({
      id: "c2", empresaId: "eA", litiganteId: null, nombre: "Sin Doc",
      tipoPersona: "NATURAL", tipoDocumento: null, numeroDocumento: null,
      email: null, telefono: null,
    });
    p.litigante.create.mockResolvedValue({ id: "l2" });
    p.cliente.update.mockResolvedValue({ id: "c2", estado: "CLIENTE", litiganteId: "l2" });

    const res = await request(app).post("/clientes/c2/convertir").set(auth(clienteToken));
    expect(res.status).toBe(200);
    expect(p.litigante.create).toHaveBeenCalled();
    expect(p.litigante.upsert).not.toHaveBeenCalled();
  });

  it("404 si el cliente no es del despacho", async () => {
    p.cliente.findFirst.mockResolvedValue(null);
    const res = await request(app).post("/clientes/x/convertir").set(auth(clienteToken));
    expect(res.status).toBe(404);
  });
});
