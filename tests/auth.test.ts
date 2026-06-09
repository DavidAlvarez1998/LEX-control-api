import bcrypt from "bcryptjs";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock del cliente Prisma — los tests no tocan la BD real.
vi.mock("../src/index", () => ({
  prisma: {
    usuario: { findUnique: vi.fn(), update: vi.fn() },
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
  update: ReturnType<typeof vi.fn>;
};

/** Token raw y su hash sha256 tal como los guardaría el backend. */
import { hashActivationToken } from "../src/modules/auth/auth.service";
const RAW_TOKEN = "a".repeat(64);
const pendingUser = (expires: Date) => ({
  id: "u1",
  activationToken: hashActivationToken(RAW_TOKEN),
  activationExpires: expires,
});

async function activeAdmin() {
  return {
    id: "u1",
    email: "admin@lex.com",
    nombre: "Admin",
    password: await bcrypt.hash("secret", 10),
    rol: "ADMIN",
    activo: true,
    rolesEmpresa: [],
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

  it("401 si la cuenta está pendiente (reset emitido) aunque la clave vieja sea correcta", async () => {
    // Tras un reset, el usuario tiene activationToken → la contraseña vieja ya
    // no debe servir para entrar.
    usuarios.findUnique.mockResolvedValue({
      ...(await activeAdmin()),
      activationToken: "hash-pendiente",
    });
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "admin@lex.com", password: "secret" });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
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

  it("401 si la empresa del usuario está inactiva (bloquea a todos sus usuarios)", async () => {
    usuarios.findUnique.mockResolvedValue({
      id: "u2",
      email: "user@empresa.com",
      nombre: "Cliente",
      password: await bcrypt.hash("secret", 10),
      rol: "USUARIO",
      activo: true,
      esAdminEmpresa: false,
      empresa: { nombre: "Acme", activo: false },
    });
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "user@empresa.com", password: "secret" });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it("200 si la empresa del usuario está activa (y devuelve el nombre de empresa)", async () => {
    usuarios.findUnique.mockResolvedValue({
      id: "u2",
      email: "user@empresa.com",
      nombre: "Cliente",
      password: await bcrypt.hash("secret", 10),
      rol: "USUARIO",
      activo: true,
      esAdminEmpresa: false,
      empresa: { nombre: "Acme", activo: true },
      rolesEmpresa: [{ rolEmpresa: "JURIDICO" }, { rolEmpresa: "COMERCIAL" }],
    });
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "user@empresa.com", password: "secret" });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ rol: "USUARIO", empresa: "Acme" });
    expect(res.body.user.roles).toEqual(["JURIDICO", "COMERCIAL"]);
  });

  it("401 si el portal (audience) no coincide con el rol", async () => {
    // Un ADMIN intentando entrar por el portal del USUARIO → rechazado.
    usuarios.findUnique.mockResolvedValue(await activeAdmin());
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "admin@lex.com", password: "secret", audience: "USUARIO" });
    expect(res.status).toBe(401);
  });

  it("200 si el portal (audience) coincide con el rol", async () => {
    usuarios.findUnique.mockResolvedValue(await activeAdmin());
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "admin@lex.com", password: "secret", audience: "ADMIN" });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
  });
});

describe("POST /auth/set-password", () => {
  it("400 si el body es inválido (sin token)", async () => {
    const res = await request(app)
      .post("/auth/set-password")
      .send({ password: "supersecret" });
    expect(res.status).toBe(400);
  });

  it("400 si la contraseña es débil (< 8)", async () => {
    const res = await request(app)
      .post("/auth/set-password")
      .send({ token: RAW_TOKEN, password: "short" });
    expect(res.status).toBe(400);
  });

  it("400 si el token no existe", async () => {
    usuarios.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post("/auth/set-password")
      .send({ token: RAW_TOKEN, password: "supersecret" });
    expect(res.status).toBe(400);
  });

  it("400 si el token expiró", async () => {
    usuarios.findUnique.mockResolvedValue(pendingUser(new Date(Date.now() - 1000)));
    const res = await request(app)
      .post("/auth/set-password")
      .send({ token: RAW_TOKEN, password: "supersecret" });
    expect(res.status).toBe(400);
  });

  it("200 fija la contraseña y limpia el token (happy path)", async () => {
    usuarios.findUnique.mockResolvedValue(
      pendingUser(new Date(Date.now() + 60_000)),
    );
    usuarios.update.mockResolvedValue({ id: "u1" });
    const res = await request(app)
      .post("/auth/set-password")
      .send({ token: RAW_TOKEN, password: "supersecret" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(usuarios.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activationToken: null, activo: true }),
      }),
    );
  });
});
