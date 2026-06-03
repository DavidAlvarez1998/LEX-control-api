import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  },
}));

import { createApp } from "../src/app";
import { prisma } from "../src/index";
import { signToken } from "../src/modules/auth/auth.service";

const app = createApp();
const servicio = prisma.servicio as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;

const adminToken = signToken({ sub: "admin1", rol: "ADMIN" });
const clienteToken = signToken({ sub: "cli1", rol: "CLIENTE" });
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeEach(() => vi.clearAllMocks());

describe("GET /servicios", () => {
  it("401 sin token", async () => {
    const res = await request(app).get("/servicios");
    expect(res.status).toBe(401);
  });

  it("200 con token (cualquier rol)", async () => {
    servicio.findMany.mockResolvedValue([]);
    const res = await request(app).get("/servicios").set(auth(clienteToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("GET /servicios/:id", () => {
  it("404 si no existe", async () => {
    servicio.findUnique.mockResolvedValue(null);
    const res = await request(app).get("/servicios/nope").set(auth(adminToken));
    expect(res.status).toBe(404);
  });
});

describe("POST /servicios", () => {
  it("401 sin token", async () => {
    const res = await request(app).post("/servicios").send({ nombre: "X", precioBase: 1 });
    expect(res.status).toBe(401);
  });

  it("403 con rol CLIENTE", async () => {
    const res = await request(app)
      .post("/servicios")
      .set(auth(clienteToken))
      .send({ nombre: "X", precioBase: 1 });
    expect(res.status).toBe(403);
  });

  it("400 con body inválido (ADMIN, sin nombre/precio)", async () => {
    const res = await request(app)
      .post("/servicios")
      .set(auth(adminToken))
      .send({ descripcion: "incompleto" });
    expect(res.status).toBe(400);
  });

  it("201 al crear (ADMIN)", async () => {
    servicio.create.mockResolvedValue({ id: "s1", nombre: "Nuevo", precioBase: "0" });
    const res = await request(app)
      .post("/servicios")
      .set(auth(adminToken))
      .send({ nombre: "Nuevo", precioBase: 0 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "s1" });
  });
});
