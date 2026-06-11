import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/index", () => ({
  prisma: {
    usuario: { findUnique: vi.fn() },
  },
}));

import { createApp } from "../src/app";
import { prisma } from "../src/index";
import { signToken } from "../src/modules/auth/auth.service";

const app = createApp();
const usuario = prisma.usuario as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
};

const clienteToken = signToken({ sub: "cli1", rol: "USUARIO" });
const adminToken = signToken({ sub: "admin1", rol: "ADMIN" });
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeEach(() => {
  vi.clearAllMocks();
  // `requireAuth` consulta la cuenta en BD antes de llegar al handler: por
  // defecto el portador del token es una cuenta activa/no pendiente en v0.
  usuario.findUnique.mockResolvedValue({
    activo: true,
    activationToken: null,
    tokenVersion: 0,
  });
});

describe("GET /mi-empresa", () => {
  it("401 sin token", async () => {
    const res = await request(app).get("/mi-empresa");
    expect(res.status).toBe(401);
  });

  it("403 con rol ADMIN (no es portal de cliente)", async () => {
    const res = await request(app).get("/mi-empresa").set(auth(adminToken));
    expect(res.status).toBe(403);
  });

  it("404 si el usuario no tiene empresa asociada", async () => {
    // Objeto válido para el middleware (activo/no pendiente) y para el handler
    // (empresa: null) — el mock ignora el `select`, así que sirve a ambas llamadas.
    usuario.findUnique.mockResolvedValue({
      activo: true,
      activationToken: null,
      tokenVersion: 0,
      empresa: null,
    });
    const res = await request(app).get("/mi-empresa").set(auth(clienteToken));
    expect(res.status).toBe(404);
  });

  it("200 con la empresa y sus servicios contratados (admin de empresa)", async () => {
    usuario.findUnique.mockResolvedValue({
      activo: true,
      activationToken: null,
      tokenVersion: 0,
      esAdminEmpresa: true, // requireAuth lee esto → el handler SÍ incluye servicios
      empresa: {
        id: "e1",
        nombre: "ACME",
        activo: true, // requireAuth comparte este mock: la empresa debe estar activa
        servicios: [
          { id: "es1", precioBase: "100.00", servicio: { nombre: "Chatbot" } },
        ],
      },
    });
    const res = await request(app).get("/mi-empresa").set(auth(clienteToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "e1", nombre: "ACME" });
    expect(res.body.servicios).toHaveLength(1);
    // El admin de empresa SÍ solicita los servicios contratados.
    expect(usuario.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cli1" },
        select: { empresa: { include: expect.objectContaining({ servicios: expect.anything() }) } },
      }),
    );
  });

  it("200 SIN servicios contratados para un usuario que no es admin de empresa", async () => {
    usuario.findUnique.mockResolvedValue({
      activo: true,
      activationToken: null,
      tokenVersion: 0,
      esAdminEmpresa: false,
      empresa: { id: "e1", nombre: "ACME", activo: true },
    });
    const res = await request(app).get("/mi-empresa").set(auth(clienteToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "e1", nombre: "ACME" });
    // El handler NO pide los servicios (precios) cuando el usuario no es admin.
    expect(usuario.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ select: { empresa: { include: {} } } }),
    );
  });
});
