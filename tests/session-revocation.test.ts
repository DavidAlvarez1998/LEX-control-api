import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock del cliente Prisma — los tests no tocan la BD real.
vi.mock("../src/index", () => ({
  prisma: {
    usuario: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

import { createApp } from "../src/app";
import { prisma } from "../src/index";
import { signToken } from "../src/modules/auth/auth.service";

const app = createApp();
const usuario = prisma.usuario as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// Ruta protegida usada para ejercitar `requireAuth` (ADMIN).
const get = (token: string) => request(app).get("/usuarios").set(auth(token));

beforeEach(() => vi.clearAllMocks());

describe("requireAuth — revocación por estado/versión de sesión", () => {
  it("200 si la cuenta está activa, no pendiente y el tv coincide", async () => {
    usuario.findUnique.mockResolvedValue({
      activo: true,
      activationToken: null,
      tokenVersion: 3,
    });
    usuario.findMany.mockResolvedValue([]);
    const token = signToken({ sub: "u1", rol: "ADMIN", tv: 3 });
    const res = await get(token);
    expect(res.status).toBe(200);
  });

  it("401 si el tokenVersion del token quedó atrás (reset/desactivación posterior)", async () => {
    usuario.findUnique.mockResolvedValue({
      activo: true,
      activationToken: null,
      tokenVersion: 4, // la cuenta avanzó; el token viejo lleva tv=3
    });
    const token = signToken({ sub: "u1", rol: "ADMIN", tv: 3 });
    const res = await get(token);
    expect(res.status).toBe(401);
  });

  it("401 si la cuenta quedó pendiente (activationToken presente)", async () => {
    usuario.findUnique.mockResolvedValue({
      activo: true,
      activationToken: "hash-pendiente",
      tokenVersion: 3,
    });
    const token = signToken({ sub: "u1", rol: "ADMIN", tv: 3 });
    const res = await get(token);
    expect(res.status).toBe(401);
  });

  it("401 si la cuenta fue desactivada", async () => {
    usuario.findUnique.mockResolvedValue({
      activo: false,
      activationToken: null,
      tokenVersion: 3,
    });
    const token = signToken({ sub: "u1", rol: "ADMIN", tv: 3 });
    const res = await get(token);
    expect(res.status).toBe(401);
  });

  it("401 si la empresa del usuario fue desactivada (revoca sesiones vivas)", async () => {
    usuario.findUnique.mockResolvedValue({
      activo: true,
      activationToken: null,
      tokenVersion: 3,
      empresaId: "e1",
      esAdminEmpresa: false,
      empresa: { activo: false },
    });
    const token = signToken({ sub: "u2", rol: "USUARIO", tv: 3 });
    const res = await get(token);
    expect(res.status).toBe(401);
  });

  it("200 si trae empresa pero está activa (no bloquea)", async () => {
    usuario.findUnique.mockResolvedValue({
      activo: true,
      activationToken: null,
      tokenVersion: 3,
      empresaId: "e1",
      esAdminEmpresa: false,
      empresa: { activo: true },
    });
    usuario.findMany.mockResolvedValue([]);
    const token = signToken({ sub: "u1", rol: "ADMIN", tv: 3 });
    const res = await get(token);
    expect(res.status).toBe(200);
  });

  it("401 si el usuario ya no existe", async () => {
    usuario.findUnique.mockResolvedValue(null);
    const token = signToken({ sub: "u1", rol: "ADMIN", tv: 0 });
    const res = await get(token);
    expect(res.status).toBe(401);
  });

  it("token legado sin claim tv (se trata como versión 0) sigue válido si la cuenta está en v0", async () => {
    usuario.findUnique.mockResolvedValue({
      activo: true,
      activationToken: null,
      tokenVersion: 0,
    });
    usuario.findMany.mockResolvedValue([]);
    const token = signToken({ sub: "u1", rol: "ADMIN" }); // sin tv
    const res = await get(token);
    expect(res.status).toBe(200);
  });
});
