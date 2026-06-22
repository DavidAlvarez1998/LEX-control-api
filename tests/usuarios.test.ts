import { Prisma } from "@prisma/client";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock del cliente Prisma — los tests no tocan la BD real. Incluye lo que usa la
// puerta de cupos (B2): $transaction, usuarioRolEmpresa, suscripcion, modulo,
// $queryRaw.
vi.mock("../src/index", () => {
  const prisma: any = {
    usuario: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    empresa: { findUnique: vi.fn() },
    usuarioRolEmpresa: {
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
    suscripcion: { findUnique: vi.fn() },
    modulo: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn((cb: any) => cb(prisma)),
  };
  return { prisma };
});

// El envío de correo (invitación/reset) es best-effort y NO debe tocar la red en tests.
vi.mock("../src/modules/notificaciones/correo.client", () => ({
  enviarCorreo: vi.fn().mockResolvedValue({ enviado: true, messageId: "test" }),
}));

import { createApp } from "../src/app";
import { prisma } from "../src/index";
import { signToken } from "../src/modules/auth/auth.service";

const app = createApp();
const usuario = prisma.usuario as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;

const adminToken = signToken({ sub: "admin1", rol: "ADMIN" });
const clienteToken = signToken({ sub: "cli1", rol: "USUARIO" });
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError("mock", {
    code,
    clientVersion: "test",
  });

beforeEach(() => {
  vi.clearAllMocks();
  // `requireAuth` ahora consulta la BD: por defecto, el portador del token es
  // una cuenta activa, no pendiente y con tokenVersion 0 (igual que el `tv` de
  // los tokens de prueba, que se firman sin `tv` → se tratan como 0).
  usuario.findUnique.mockResolvedValue({
    activo: true,
    activationToken: null,
    tokenVersion: 0,
  });
  // Defaults para la puerta de cupos (B2): suscripción ACTIVA con cupos amplios,
  // 0 sillas usadas → assertSeatAvailable pasa.
  const p = prisma as any;
  p.modulo.findMany.mockResolvedValue([]);
  p.suscripcion.findUnique.mockResolvedValue({
    estado: "ACTIVA",
    plan: {
      modulos: [],
      cuotas: [
        { rolEmpresa: "ADMINISTRADOR", limite: 100 },
        { rolEmpresa: "JURIDICO", limite: 100 },
        { rolEmpresa: "CONTABLE", limite: 100 },
        { rolEmpresa: "COMERCIAL", limite: 100 },
      ],
    },
    modulos: [],
    cuotas: [],
  });
  p.usuarioRolEmpresa.count.mockResolvedValue(0);
  p.usuarioRolEmpresa.create.mockResolvedValue({});
  p.$queryRaw.mockResolvedValue([]);
});

describe("GET /usuarios", () => {
  it("401 sin token", async () => {
    const res = await request(app).get("/usuarios");
    expect(res.status).toBe(401);
  });

  it("403 con rol USUARIO", async () => {
    const res = await request(app).get("/usuarios").set(auth(clienteToken));
    expect(res.status).toBe(403);
  });

  it("200 con estado derivado y sin exponer activationToken", async () => {
    usuario.findMany.mockResolvedValue([
      { id: "u1", activo: true, activationToken: "hash", empresa: { nombre: "ACME" } },
      { id: "u2", activo: true, activationToken: null, empresa: null },
      { id: "u3", activo: false, activationToken: null, empresa: null },
    ]);
    const res = await request(app).get("/usuarios").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.map((u: { estado: string }) => u.estado)).toEqual([
      "PENDIENTE",
      "ACTIVO",
      "INACTIVO",
    ]);
    // El hash del token de activación nunca debe filtrarse al cliente.
    expect(res.body[0]).not.toHaveProperty("activationToken");
  });
});

describe("POST /usuarios", () => {
  it("403 con rol USUARIO", async () => {
    const res = await request(app)
      .post("/usuarios")
      .set(auth(clienteToken))
      .send({ email: "a@b.com", nombre: "Ana", empresaId: "e1" });
    expect(res.status).toBe(403);
  });

  it("400 con body inválido (sin empresaId)", async () => {
    const res = await request(app)
      .post("/usuarios")
      .set(auth(adminToken))
      .send({ email: "a@b.com", nombre: "Ana" });
    expect(res.status).toBe(400);
  });

  it("201 al crear y devuelve el link de activación", async () => {
    usuario.create.mockResolvedValue({ id: "u1", email: "a@b.com", nombre: "Ana" });
    const res = await request(app)
      .post("/usuarios")
      .set(auth(adminToken))
      .send({ email: "a@b.com", nombre: "Ana", empresaId: "e1" });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ id: "u1" });
    expect(res.body.activationUrl).toContain("/activar?token=");
  });

  it("409 si el correo ya existe (P2002)", async () => {
    usuario.create.mockRejectedValue(prismaError("P2002"));
    const res = await request(app)
      .post("/usuarios")
      .set(auth(adminToken))
      .send({ email: "dup@b.com", nombre: "Ana", empresaId: "e1" });
    expect(res.status).toBe(409);
  });

  it("400 si la empresa no existe (P2003)", async () => {
    usuario.create.mockRejectedValue(prismaError("P2003"));
    const res = await request(app)
      .post("/usuarios")
      .set(auth(adminToken))
      .send({ email: "a@b.com", nombre: "Ana", empresaId: "nope" });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /usuarios/:id", () => {
  it("200 al actualizar", async () => {
    usuario.update.mockResolvedValue({ id: "u1", nombre: "Ana B", activo: false });
    const res = await request(app)
      .patch("/usuarios/u1")
      .set(auth(adminToken))
      .send({ nombre: "Ana B", activo: false });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ nombre: "Ana B", activo: false });
  });

  it("404 si no existe (P2025)", async () => {
    usuario.update.mockRejectedValue(prismaError("P2025"));
    const res = await request(app)
      .patch("/usuarios/nope")
      .set(auth(adminToken))
      .send({ nombre: "X" });
    expect(res.status).toBe(404);
  });

  it("al desactivar (activo:false) sube tokenVersion para revocar sesiones", async () => {
    usuario.update.mockResolvedValue({ id: "u1", activo: false });
    await request(app)
      .patch("/usuarios/u1")
      .set(auth(adminToken))
      .send({ activo: false });
    expect(usuario.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          activo: false,
          tokenVersion: { increment: 1 },
        }),
      }),
    );
  });

  it("al editar sin desactivar NO toca tokenVersion", async () => {
    usuario.update.mockResolvedValue({ id: "u1", nombre: "Ana B" });
    await request(app)
      .patch("/usuarios/u1")
      .set(auth(adminToken))
      .send({ nombre: "Ana B" });
    const data = usuario.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("tokenVersion");
  });
});

describe("POST /usuarios/:id/reset-password", () => {
  it("200 → link del portal del cliente para un USUARIO", async () => {
    usuario.update.mockResolvedValue({ rol: "USUARIO" });
    const res = await request(app)
      .post("/usuarios/u1/reset-password")
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.activationUrl).toContain("/activar?token=");
    expect(res.body.activationUrl).toContain("localhost:3001"); // client
  });

  it("200 → link del panel admin para un ADMIN", async () => {
    usuario.update.mockResolvedValue({ rol: "ADMIN" });
    const res = await request(app)
      .post("/usuarios/admin1/reset-password")
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.activationUrl).toContain("localhost:3000"); // admin
  });

  it("sube tokenVersion para revocar las sesiones vivas del usuario", async () => {
    usuario.update.mockResolvedValue({ rol: "USUARIO" });
    await request(app)
      .post("/usuarios/u1/reset-password")
      .set(auth(adminToken));
    expect(usuario.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tokenVersion: { increment: 1 } }),
      }),
    );
  });

  it("404 si no existe (P2025)", async () => {
    usuario.update.mockRejectedValue(prismaError("P2025"));
    const res = await request(app)
      .post("/usuarios/nope/reset-password")
      .set(auth(adminToken));
    expect(res.status).toBe(404);
  });

  it("403 con rol USUARIO", async () => {
    const res = await request(app)
      .post("/usuarios/u1/reset-password")
      .set(auth(clienteToken));
    expect(res.status).toBe(403);
  });
});

describe("DELETE /usuarios/:id", () => {
  it("204 al eliminar", async () => {
    usuario.delete.mockResolvedValue({ id: "u1" });
    const res = await request(app)
      .delete("/usuarios/u1")
      .set(auth(adminToken));
    expect(res.status).toBe(204);
    expect(usuario.delete).toHaveBeenCalledWith({ where: { id: "u1" } });
  });

  it("400 si el admin intenta borrarse a sí mismo", async () => {
    // adminToken tiene sub = "admin1"
    const res = await request(app)
      .delete("/usuarios/admin1")
      .set(auth(adminToken));
    expect(res.status).toBe(400);
    expect(usuario.delete).not.toHaveBeenCalled();
  });

  it("404 si no existe (P2025)", async () => {
    usuario.delete.mockRejectedValue(prismaError("P2025"));
    const res = await request(app)
      .delete("/usuarios/nope")
      .set(auth(adminToken));
    expect(res.status).toBe(404);
  });

  it("403 con rol USUARIO", async () => {
    const res = await request(app)
      .delete("/usuarios/u1")
      .set(auth(clienteToken));
    expect(res.status).toBe(403);
  });
});
