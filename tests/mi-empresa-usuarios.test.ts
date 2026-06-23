import { Prisma } from "@prisma/client";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock del cliente Prisma — los tests no tocan la BD real. Incluye lo que usa la
// puerta de cupos: $transaction (ejecuta el callback con el mismo prisma),
// usuarioRolEmpresa, suscripcion, modulo y $queryRaw (lock FOR UPDATE).
vi.mock("../src/index", () => {
  const prisma: any = {
    usuario: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    usuarioRolEmpresa: {
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      groupBy: vi.fn(),
    },
    suscripcion: { findUnique: vi.fn() },
    modulo: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn((cb: any) => cb(prisma)),
  };
  return { prisma };
});

// El envío de correo (invitación/reenvío) es best-effort y NO debe tocar la red en tests.
vi.mock("../src/modules/notificaciones/correo.client", () => ({
  enviarCorreo: vi.fn().mockResolvedValue({ enviado: true, messageId: "test" }),
}));

import { createApp } from "../src/app";
import { prisma } from "../src/index";
import { signToken } from "../src/modules/auth/auth.service";
import { enviarCorreo } from "../src/modules/notificaciones/correo.client";
const correoMock = vi.mocked(enviarCorreo);

const app = createApp();
const usuario = prisma.usuario as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;
// Alias al cliente Prisma mockeado para tocar otras tablas (roles, cupos).
const p = prisma as any;

// Tokens: el JWT solo lleva { sub, rol }; esAdminEmpresa/empresaId los resuelve
// `requireAuth` por BD (ver el mock de findUnique).
const adminEmpresaToken = signToken({ sub: "admin-emp", rol: "USUARIO" });
const clienteToken = signToken({ sub: "cli1", rol: "USUARIO" });
const adminPlataformaToken = signToken({ sub: "admin1", rol: "ADMIN" });
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError("mock", {
    code,
    clientVersion: "test",
  });

beforeEach(() => {
  vi.clearAllMocks();
  // Por defecto el portador es un administrador de la empresa "eA": cuenta
  // activa, no pendiente, tokenVersion 0, esAdminEmpresa true.
  usuario.findUnique.mockResolvedValue({
    activo: true,
    activationToken: null,
    tokenVersion: 0,
    empresaId: "eA",
    esAdminEmpresa: true,
  });
  // Defaults para la puerta de cupos: suscripción ACTIVA con cupos amplios, 0
  // sillas usadas → assertSeatAvailable pasa. (Tests de cupo agotado lo pisan.)
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
  p.usuarioRolEmpresa.findMany.mockResolvedValue([]);
  p.usuarioRolEmpresa.deleteMany.mockResolvedValue({ count: 0 });
  p.usuarioRolEmpresa.groupBy.mockResolvedValue([]);
  p.usuario.findFirst.mockResolvedValue({ id: "u1" });
  p.usuario.update.mockResolvedValue({});
  p.$queryRaw.mockResolvedValue([]);
});

describe("GET /mi-empresa/usuarios (autorización)", () => {
  it("401 sin token", async () => {
    const res = await request(app).get("/mi-empresa/usuarios");
    expect(res.status).toBe(401);
  });

  it("403 con USUARIO que no es admin de empresa", async () => {
    usuario.findUnique.mockResolvedValue({
      activo: true,
      activationToken: null,
      tokenVersion: 0,
      empresaId: "eA",
      esAdminEmpresa: false,
    });
    const res = await request(app)
      .get("/mi-empresa/usuarios")
      .set(auth(clienteToken));
    expect(res.status).toBe(403);
  });

  it("403 con ADMIN de plataforma (usa /usuarios, no este portal)", async () => {
    const res = await request(app)
      .get("/mi-empresa/usuarios")
      .set(auth(adminPlataformaToken));
    expect(res.status).toBe(403);
  });
});

describe("GET /mi-empresa/usuarios (listado scoped)", () => {
  it("200: solo la propia empresa, con estado, roles y sin filtrar activationToken", async () => {
    usuario.findMany.mockResolvedValue([
      {
        id: "u1",
        activo: true,
        activationToken: "hash",
        empresaId: "eA",
        rolesEmpresa: [{ rolEmpresa: "JURIDICO" }, { rolEmpresa: "COMERCIAL" }],
      },
      { id: "u2", activo: true, activationToken: null, empresaId: "eA", rolesEmpresa: [] },
      { id: "u3", activo: false, activationToken: null, empresaId: "eA", rolesEmpresa: [] },
    ]);
    const res = await request(app)
      .get("/mi-empresa/usuarios")
      .set(auth(adminEmpresaToken));

    expect(res.status).toBe(200);
    expect(res.body.map((u: { estado: string }) => u.estado)).toEqual([
      "PENDIENTE",
      "ACTIVO",
      "INACTIVO",
    ]);
    expect(res.body[0].roles).toEqual(["JURIDICO", "COMERCIAL"]);
    expect(res.body[0]).not.toHaveProperty("activationToken");
    expect(res.body[0]).not.toHaveProperty("rolesEmpresa");
    // El listado se acota a la empresa del token, nunca a un id del cliente.
    expect(usuario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { empresaId: "eA" } }),
    );
  });
});

describe("POST /mi-empresa/usuarios", () => {
  it("403 con USUARIO que no es admin de empresa", async () => {
    usuario.findUnique.mockResolvedValue({
      activo: true,
      activationToken: null,
      tokenVersion: 0,
      empresaId: "eA",
      esAdminEmpresa: false,
    });
    const res = await request(app)
      .post("/mi-empresa/usuarios")
      .set(auth(clienteToken))
      .send({ email: "a@b.com", nombre: "Ana" });
    expect(res.status).toBe(403);
  });

  it("400 con body inválido (sin nombre)", async () => {
    const res = await request(app)
      .post("/mi-empresa/usuarios")
      .set(auth(adminEmpresaToken))
      .send({ email: "a@b.com", roles: ["JURIDICO"] });
    expect(res.status).toBe(400);
  });

  it("400 si no se envían roles (al menos uno)", async () => {
    const res = await request(app)
      .post("/mi-empresa/usuarios")
      .set(auth(adminEmpresaToken))
      .send({ email: "a@b.com", nombre: "Ana", roles: [] });
    expect(res.status).toBe(400);
    expect(usuario.create).not.toHaveBeenCalled();
  });

  it("201: crea con varios roles, rol USUARIO y empresaId del token", async () => {
    usuario.create.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      nombre: "Ana",
      rol: "USUARIO",
    });
    const res = await request(app)
      .post("/mi-empresa/usuarios")
      .set(auth(adminEmpresaToken))
      .send({ email: "a@b.com", nombre: "Ana", roles: ["JURIDICO", "COMERCIAL"] });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ id: "u1", roles: ["JURIDICO", "COMERCIAL"] });
    expect(res.body.activationUrl).toContain("/activar?token=");
    expect(res.body.activationUrl).toContain("localhost:3001"); // portal cliente
    // Sin ADMINISTRADOR ⇒ no es admin de empresa.
    expect(usuario.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rol: "USUARIO", empresaId: "eA", esAdminEmpresa: false }),
      }),
    );
    // Una silla por cada rol.
    expect(p.usuarioRolEmpresa.create).toHaveBeenCalledTimes(2);
  });

  it("ADMINISTRADOR en roles ⇒ esAdminEmpresa true (espejo)", async () => {
    usuario.create.mockResolvedValue({ id: "u1", rol: "USUARIO" });
    await request(app)
      .post("/mi-empresa/usuarios")
      .set(auth(adminEmpresaToken))
      .send({ email: "a@b.com", nombre: "Ana", roles: ["ADMINISTRADOR"] });

    expect(usuario.create.mock.calls[0][0].data.esAdminEmpresa).toBe(true);
  });

  it("ignora rol y empresaId del body (sin escalada ni cruce de empresa)", async () => {
    usuario.create.mockResolvedValue({ id: "u1", rol: "USUARIO" });
    await request(app)
      .post("/mi-empresa/usuarios")
      .set(auth(adminEmpresaToken))
      .send({ email: "a@b.com", nombre: "Ana", roles: ["JURIDICO"], rol: "ADMIN", empresaId: "eB" });

    const data = usuario.create.mock.calls[0][0].data;
    expect(data.rol).toBe("USUARIO");
    expect(data.empresaId).toBe("eA");
  });

  it("409 sin cupo para un rol (plan no lo incluye) y no crea el usuario", async () => {
    // Plan sin silla COMERCIAL (límite 0) ⇒ assertSeatAvailable lanza 409.
    p.suscripcion.findUnique.mockResolvedValue({
      estado: "ACTIVA",
      plan: {
        modulos: [],
        cuotas: [
          { rolEmpresa: "ADMINISTRADOR", limite: 1 },
          { rolEmpresa: "JURIDICO", limite: 1 },
        ],
      },
      modulos: [],
      cuotas: [],
    });
    const res = await request(app)
      .post("/mi-empresa/usuarios")
      .set(auth(adminEmpresaToken))
      .send({ email: "a@b.com", nombre: "Ana", roles: ["COMERCIAL"] });

    expect(res.status).toBe(409);
    expect(usuario.create).not.toHaveBeenCalled();
  });

  it("409 si el correo ya existe (P2002)", async () => {
    usuario.create.mockRejectedValue(prismaError("P2002"));
    const res = await request(app)
      .post("/mi-empresa/usuarios")
      .set(auth(adminEmpresaToken))
      .send({ email: "dup@b.com", nombre: "Ana", roles: ["JURIDICO"] });
    expect(res.status).toBe(409);
  });
});

describe("PATCH /mi-empresa/usuarios/:id (activar/desactivar)", () => {
  it("200 al desactivar: sube tokenVersion y acota por empresa", async () => {
    usuario.updateMany.mockResolvedValue({ count: 1 });
    const res = await request(app)
      .patch("/mi-empresa/usuarios/u1")
      .set(auth(adminEmpresaToken))
      .send({ activo: false });

    expect(res.status).toBe(200);
    expect(usuario.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1", empresaId: "eA" },
        data: expect.objectContaining({
          activo: false,
          tokenVersion: { increment: 1 },
        }),
      }),
    );
  });

  it("200 al reactivar: no toca tokenVersion", async () => {
    usuario.updateMany.mockResolvedValue({ count: 1 });
    await request(app)
      .patch("/mi-empresa/usuarios/u1")
      .set(auth(adminEmpresaToken))
      .send({ activo: true });
    const data = usuario.updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("tokenVersion");
  });

  it("400 si el admin intenta desactivarse a sí mismo", async () => {
    const res = await request(app)
      .patch("/mi-empresa/usuarios/admin-emp")
      .set(auth(adminEmpresaToken))
      .send({ activo: false });
    expect(res.status).toBe(400);
    expect(usuario.updateMany).not.toHaveBeenCalled();
  });

  it("404 si el usuario es de otra empresa (count 0)", async () => {
    usuario.updateMany.mockResolvedValue({ count: 0 });
    const res = await request(app)
      .patch("/mi-empresa/usuarios/ajeno")
      .set(auth(adminEmpresaToken))
      .send({ activo: false });
    expect(res.status).toBe(404);
  });
});

describe("POST /mi-empresa/usuarios/:id/activation (reenviar enlace)", () => {
  it("200: devuelve un enlace nuevo y revoca la sesión (tokenVersion)", async () => {
    usuario.updateMany.mockResolvedValue({ count: 1 });
    const res = await request(app)
      .post("/mi-empresa/usuarios/u1/activation")
      .set(auth(adminEmpresaToken));

    expect(res.status).toBe(200);
    expect(res.body.activationUrl).toContain("/activar?token=");
    expect(res.body.activationUrl).toContain("localhost:3001");
    expect(usuario.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1", empresaId: "eA" },
        data: expect.objectContaining({ tokenVersion: { increment: 1 } }),
      }),
    );
  });

  it("404 si el usuario es de otra empresa (count 0)", async () => {
    usuario.updateMany.mockResolvedValue({ count: 0 });
    const res = await request(app)
      .post("/mi-empresa/usuarios/ajeno/activation")
      .set(auth(adminEmpresaToken));
    expect(res.status).toBe(404);
  });

  it("miembro PENDIENTE (con token) → correo de INVITACIÓN", async () => {
    correoMock.mockClear();
    usuario.findFirst.mockResolvedValue({ email: "x@y.com", nombre: "X", activationToken: "hash" });
    usuario.updateMany.mockResolvedValue({ count: 1 });
    await request(app).post("/mi-empresa/usuarios/u1/activation").set(auth(adminEmpresaToken));
    expect(correoMock).toHaveBeenCalledWith(expect.objectContaining({ subject: "Activa tu cuenta de LEX Control" }));
  });

  it("miembro ya ACTIVADO (sin token) → correo de RESTABLECIMIENTO", async () => {
    correoMock.mockClear();
    usuario.findFirst.mockResolvedValue({ email: "x@y.com", nombre: "X", activationToken: null });
    usuario.updateMany.mockResolvedValue({ count: 1 });
    await request(app).post("/mi-empresa/usuarios/u1/activation").set(auth(adminEmpresaToken));
    expect(correoMock).toHaveBeenCalledWith(expect.objectContaining({ subject: "Restablece tu contraseña de LEX Control" }));
  });
});

describe("PATCH /mi-empresa/usuarios/:id (reconciliar roles)", () => {
  it("añade un rol nuevo (con cupo) sin tocar los existentes", async () => {
    p.usuario.findFirst.mockResolvedValue({ id: "u1" });
    p.usuarioRolEmpresa.findMany.mockResolvedValue([{ rolEmpresa: "JURIDICO" }]);
    const res = await request(app)
      .patch("/mi-empresa/usuarios/u1")
      .set(auth(adminEmpresaToken))
      .send({ roles: ["JURIDICO", "COMERCIAL"] });

    expect(res.status).toBe(200);
    // Solo crea el que faltaba (COMERCIAL); no re-crea JURIDICO ni borra nada.
    expect(p.usuarioRolEmpresa.create).toHaveBeenCalledTimes(1);
    expect(p.usuarioRolEmpresa.create.mock.calls[0][0].data.rolEmpresa).toBe("COMERCIAL");
    expect(p.usuarioRolEmpresa.deleteMany).not.toHaveBeenCalled();
  });

  it("quita un rol y sincroniza esAdminEmpresa (ADMINISTRADOR fuera ⇒ false)", async () => {
    p.usuario.findFirst.mockResolvedValue({ id: "u1" });
    p.usuarioRolEmpresa.findMany.mockResolvedValue([
      { rolEmpresa: "ADMINISTRADOR" },
      { rolEmpresa: "JURIDICO" },
    ]);
    const res = await request(app)
      .patch("/mi-empresa/usuarios/u1")
      .set(auth(adminEmpresaToken))
      .send({ roles: ["JURIDICO"] });

    expect(res.status).toBe(200);
    expect(p.usuarioRolEmpresa.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { usuarioId: "u1", rolEmpresa: { in: ["ADMINISTRADOR"] } },
      }),
    );
    expect(p.usuario.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { esAdminEmpresa: false } }),
    );
  });

  it("400 si el admin intenta quitarse su propio rol ADMINISTRADOR", async () => {
    const res = await request(app)
      .patch("/mi-empresa/usuarios/admin-emp")
      .set(auth(adminEmpresaToken))
      .send({ roles: ["JURIDICO"] });

    expect(res.status).toBe(400);
    expect(p.usuarioRolEmpresa.deleteMany).not.toHaveBeenCalled();
  });

  it("409 al añadir un rol sin cupo, sin cambios parciales", async () => {
    p.usuario.findFirst.mockResolvedValue({ id: "u1" });
    p.usuarioRolEmpresa.findMany.mockResolvedValue([{ rolEmpresa: "JURIDICO" }]);
    // CONTABLE lleno: cap 1 y 1 usada.
    p.suscripcion.findUnique.mockResolvedValue({
      estado: "ACTIVA",
      plan: { modulos: [], cuotas: [{ rolEmpresa: "CONTABLE", limite: 1 }] },
      modulos: [],
      cuotas: [],
    });
    p.usuarioRolEmpresa.count.mockResolvedValue(1);

    const res = await request(app)
      .patch("/mi-empresa/usuarios/u1")
      .set(auth(adminEmpresaToken))
      .send({ roles: ["JURIDICO", "CONTABLE"] });

    expect(res.status).toBe(409);
  });

  it("404 si el usuario es de otra empresa", async () => {
    p.usuario.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .patch("/mi-empresa/usuarios/ajeno")
      .set(auth(adminEmpresaToken))
      .send({ roles: ["JURIDICO"] });
    expect(res.status).toBe(404);
  });
});

describe("GET /mi-empresa/cupos", () => {
  it("devuelve cap (null=ilimitado, 0=no incluido) y usados por rol", async () => {
    p.suscripcion.findUnique.mockResolvedValue({
      estado: "ACTIVA",
      plan: {
        modulos: [],
        cuotas: [
          { rolEmpresa: "ADMINISTRADOR", limite: 1 },
          { rolEmpresa: "JURIDICO", limite: null }, // ilimitado
          { rolEmpresa: "COMERCIAL", limite: 1 },
          // CONTABLE ausente ⇒ cap 0 (no incluido)
        ],
      },
      modulos: [],
      cuotas: [],
    });
    p.usuarioRolEmpresa.groupBy.mockResolvedValue([
      { rolEmpresa: "COMERCIAL", _count: { rolEmpresa: 1 } },
    ]);

    const res = await request(app)
      .get("/mi-empresa/cupos")
      .set(auth(adminEmpresaToken));

    expect(res.status).toBe(200);
    const byRol = Object.fromEntries(
      res.body.map((c: { rol: string }) => [c.rol, c]),
    );
    expect(byRol.JURIDICO).toMatchObject({ cap: null, usados: 0 });
    expect(byRol.COMERCIAL).toMatchObject({ cap: 1, usados: 1 });
    expect(byRol.CONTABLE).toMatchObject({ cap: 0, usados: 0 });
  });

  it("403 a un USUARIO que no es admin de empresa", async () => {
    usuario.findUnique.mockResolvedValue({
      activo: true,
      activationToken: null,
      tokenVersion: 0,
      empresaId: "eA",
      esAdminEmpresa: false,
    });
    const res = await request(app)
      .get("/mi-empresa/cupos")
      .set(auth(clienteToken));
    expect(res.status).toBe(403);
  });
});
