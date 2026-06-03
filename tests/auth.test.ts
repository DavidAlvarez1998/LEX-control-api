import bcrypt from "bcryptjs";
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
  },
}));

import { createApp } from "../src/app";
import { prisma } from "../src/index";

const app = createApp();
const usuarios = prisma.usuario as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
};

async function activeAdmin() {
  return {
    id: "u1",
    email: "admin@lex.com",
    nombre: "Admin",
    password: await bcrypt.hash("secret", 10),
    rol: "ADMIN",
    activo: true,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("POST /auth/login", () => {
  it("400 si el body es inválido (sin email)", async () => {
    const res = await request(app).post("/auth/login").send({ password: "x" });
    expect(res.status).toBe(400);
  });

  it("401 si el usuario no existe", async () => {
    usuarios.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "no@lex.com", password: "x" });
    expect(res.status).toBe(401);
  });

  it("401 si el usuario está inactivo", async () => {
    usuarios.findUnique.mockResolvedValue({ ...(await activeAdmin()), activo: false });
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "admin@lex.com", password: "secret" });
    expect(res.status).toBe(401);
  });

  it("401 con contraseña incorrecta", async () => {
    usuarios.findUnique.mockResolvedValue(await activeAdmin());
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "admin@lex.com", password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("200 + token con credenciales válidas", async () => {
    usuarios.findUnique.mockResolvedValue(await activeAdmin());
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "admin@lex.com", password: "secret" });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user).toMatchObject({ email: "admin@lex.com", rol: "ADMIN" });
  });
});
