import { Prisma } from "@prisma/client";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock del cliente Prisma — los tests no tocan la BD real.
vi.mock("../src/index", () => ({
  prisma: {
    usuario: { findUnique: vi.fn() },
    servicio: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    empresa: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    empresaServicio: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { createApp } from "../src/app";
import { prisma } from "../src/index";
import { signToken } from "../src/modules/auth/auth.service";

const app = createApp();
const empresa = prisma.empresa as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;
const servicio = prisma.servicio as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;
const empresaServicio = prisma.empresaServicio as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;
const usuario = prisma.usuario as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;
// La forma interactiva de $transaction: ejecuta el callback con el mismo cliente mock.
const $transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

const adminToken = signToken({ sub: "admin1", rol: "ADMIN" });
const clienteToken = signToken({ sub: "cli1", rol: "USUARIO" });
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Construye un error conocido de Prisma con el código indicado. */
const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError("mock", {
    code,
    clientVersion: "test",
  });

beforeEach(() => {
  vi.clearAllMocks();
  // Por defecto $transaction ejecuta su callback contra el cliente mock.
  $transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma),
  );
  // `requireAuth` consulta la cuenta del portador del token en BD.
  usuario.findUnique.mockResolvedValue({
    activo: true,
    activationToken: null,
    tokenVersion: 0,
  });
});

describe("GET /empresas", () => {
  it("401 sin token", async () => {
    const res = await request(app).get("/empresas");
    expect(res.status).toBe(401);
  });

  it("403 con rol USUARIO", async () => {
    const res = await request(app).get("/empresas").set(auth(clienteToken));
    expect(res.status).toBe(403);
  });

  it("200 con rol ADMIN", async () => {
    empresa.findMany.mockResolvedValue([]);
    const res = await request(app).get("/empresas").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("GET /empresas/:id", () => {
  it("404 si no existe", async () => {
    empresa.findUnique.mockResolvedValue(null);
    const res = await request(app).get("/empresas/nope").set(auth(adminToken));
    expect(res.status).toBe(404);
  });

  it("200 si existe", async () => {
    empresa.findUnique.mockResolvedValue({ id: "e1", nombre: "ACME" });
    const res = await request(app).get("/empresas/e1").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "e1" });
  });
});

describe("POST /empresas", () => {
  it("401 sin token", async () => {
    const res = await request(app).post("/empresas").send({ nombre: "ACME" });
    expect(res.status).toBe(401);
  });

  it("403 con rol USUARIO", async () => {
    const res = await request(app)
      .post("/empresas")
      .set(auth(clienteToken))
      .send({ nombre: "ACME" });
    expect(res.status).toBe(403);
  });

  it("400 con body inválido (sin nombre)", async () => {
    const res = await request(app)
      .post("/empresas")
      .set(auth(adminToken))
      .send({ telefono: "123" });
    expect(res.status).toBe(400);
  });

  it("201 al crear (ADMIN)", async () => {
    empresa.create.mockResolvedValue({ id: "e1", nombre: "ACME" });
    empresa.findUnique.mockResolvedValue({ id: "e1", nombre: "ACME" });
    const res = await request(app)
      .post("/empresas")
      .set(auth(adminToken))
      .send({ nombre: "ACME" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "e1" });
  });

  it("409 si el RFC/NIT ya existe (P2002)", async () => {
    empresa.create.mockRejectedValue(prismaError("P2002"));
    const res = await request(app)
      .post("/empresas")
      .set(auth(adminToken))
      .send({ nombre: "ACME", rfc: "DUP" });
    expect(res.status).toBe(409);
  });
});

describe("PATCH /empresas/:id", () => {
  it("200 al actualizar (ADMIN)", async () => {
    empresa.update.mockResolvedValue({ id: "e1", nombre: "ACME 2" });
    empresa.findUnique.mockResolvedValue({ id: "e1", nombre: "ACME 2" });
    const res = await request(app)
      .patch("/empresas/e1")
      .set(auth(adminToken))
      .send({ nombre: "ACME 2" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ nombre: "ACME 2" });
  });

  it("404 si no existe (P2025)", async () => {
    empresa.update.mockRejectedValue(prismaError("P2025"));
    const res = await request(app)
      .patch("/empresas/nope")
      .set(auth(adminToken))
      .send({ nombre: "X" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /empresas/:id", () => {
  it("204 al eliminar (ADMIN)", async () => {
    empresa.delete.mockResolvedValue({ id: "e1" });
    const res = await request(app).delete("/empresas/e1").set(auth(adminToken));
    expect(res.status).toBe(204);
  });

  it("404 si no existe (P2025)", async () => {
    empresa.delete.mockRejectedValue(prismaError("P2025"));
    const res = await request(app)
      .delete("/empresas/nope")
      .set(auth(adminToken));
    expect(res.status).toBe(404);
  });

  it("403 con rol USUARIO", async () => {
    const res = await request(app).delete("/empresas/e1").set(auth(clienteToken));
    expect(res.status).toBe(403);
  });
});

describe("POST /empresas con servicios", () => {
  it("201 crea empresa + asignaciones, con defaults del catálogo", async () => {
    // Catálogo de referencia: solo se envía servicioId de s1 → toma defaults.
    servicio.findMany.mockResolvedValue([
      {
        id: "s1",
        precioBase: "100.00",
        precioPorUnidad: "5.00",
        incluidos: 10,
      },
      {
        id: "s2",
        precioBase: "200.00",
        precioPorUnidad: "0.00",
        incluidos: 0,
      },
    ]);
    empresa.create.mockResolvedValue({ id: "e1", nombre: "ACME" });
    empresa.findUnique.mockResolvedValue({ id: "e1", nombre: "ACME" });

    const res = await request(app)
      .post("/empresas")
      .set(auth(adminToken))
      .send({
        nombre: "ACME",
        servicios: [{ servicioId: "s1" }, { servicioId: "s2", precioBase: 150 }],
      });

    expect(res.status).toBe(201);
    expect(empresaServicio.createMany).toHaveBeenCalledTimes(1);
    const filas = empresaServicio.createMany.mock.calls[0][0].data;
    // s1 hereda los valores de referencia del catálogo…
    expect(filas).toContainEqual({
      empresaId: "e1",
      servicioId: "s1",
      precioBase: "100.00",
      precioPorUnidad: "5.00",
      incluidos: 10,
      activo: true,
    });
    // …y s2 conserva el precioBase negociado.
    expect(filas).toContainEqual(
      expect.objectContaining({ servicioId: "s2", precioBase: 150 }),
    );
  });

  it("400 y sin crear si un servicioId no existe", async () => {
    servicio.findMany.mockResolvedValue([]); // ninguno encontrado
    const res = await request(app)
      .post("/empresas")
      .set(auth(adminToken))
      .send({ nombre: "ACME", servicios: [{ servicioId: "fantasma" }] });

    expect(res.status).toBe(400);
    expect(empresa.create).not.toHaveBeenCalled();
    expect(empresaServicio.createMany).not.toHaveBeenCalled();
  });

  it("400 si hay servicioId duplicados", async () => {
    const res = await request(app)
      .post("/empresas")
      .set(auth(adminToken))
      .send({
        nombre: "ACME",
        servicios: [{ servicioId: "s1" }, { servicioId: "s1" }],
      });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /empresas/:id con servicios (replace-set)", () => {
  it("reconcilia: upsert de los indicados y borra los omitidos", async () => {
    servicio.findMany.mockResolvedValue([
      { id: "sA", precioBase: "10.00", precioPorUnidad: "0.00", incluidos: 0 },
    ]);
    empresa.update.mockResolvedValue({ id: "e1" });
    empresa.findUnique.mockResolvedValue({ id: "e1", servicios: [] });

    const res = await request(app)
      .patch("/empresas/e1")
      .set(auth(adminToken))
      .send({ servicios: [{ servicioId: "sA", precioBase: 9 }] });

    expect(res.status).toBe(200);
    // Borra todo lo que no esté en la lista deseada…
    expect(empresaServicio.deleteMany).toHaveBeenCalledWith({
      where: { empresaId: "e1", servicioId: { notIn: ["sA"] } },
    });
    // …y hace upsert de la asignación enviada.
    expect(empresaServicio.upsert).toHaveBeenCalledTimes(1);
  });

  it("no toca asignaciones si el body no trae 'servicios'", async () => {
    empresa.update.mockResolvedValue({ id: "e1", nombre: "X" });
    empresa.findUnique.mockResolvedValue({ id: "e1", nombre: "X" });

    const res = await request(app)
      .patch("/empresas/e1")
      .set(auth(adminToken))
      .send({ nombre: "X" });

    expect(res.status).toBe(200);
    expect(empresaServicio.deleteMany).not.toHaveBeenCalled();
    expect(empresaServicio.upsert).not.toHaveBeenCalled();
  });
});
