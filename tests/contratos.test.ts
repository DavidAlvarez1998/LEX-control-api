import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock de Prisma — sin BD real.
vi.mock("../src/index", () => ({
  prisma: {
    usuario: { findUnique: vi.fn() },
    contrato: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    documentoContrato: { create: vi.fn(), deleteMany: vi.fn() },
  },
}));

// Mock SOLO de subirDocumento (no red); construirUrlDocumento queda real.
vi.mock("../src/modules/documentos/documentos.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/modules/documentos/documentos.client")>();
  return { ...actual, subirDocumento: vi.fn() };
});

import { createApp } from "../src/app";
import { prisma } from "../src/index";
import { signToken } from "../src/modules/auth/auth.service";
import { subirDocumento } from "../src/modules/documentos/documentos.client";

const app = createApp();
const usuario = prisma.usuario as unknown as Record<string, ReturnType<typeof vi.fn>>;
const contrato = prisma.contrato as unknown as Record<string, ReturnType<typeof vi.fn>>;
const documento = prisma.documentoContrato as unknown as Record<string, ReturnType<typeof vi.fn>>;
const subir = subirDocumento as unknown as ReturnType<typeof vi.fn>;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const ADMIN = signToken({ sub: "admin1", rol: "ADMIN", tv: 0 });
const EMPADMIN = signToken({ sub: "ea1", rol: "USUARIO", tv: 0 });
const USER = signToken({ sub: "u1", rol: "USUARIO", tv: 0 });

// Estado de cuenta que devuelve requireAuth. Por defecto: ADMIN de plataforma.
function authUser(over: Record<string, unknown> = {}) {
  return {
    activo: true,
    activationToken: null,
    tokenVersion: 0,
    empresaId: null,
    esAdminEmpresa: false,
    empresa: null,
    rolesEmpresa: [],
    ...over,
  };
}
const asEmpresaAdmin = () =>
  authUser({ empresaId: "e1", esAdminEmpresa: true, empresa: { activo: true } });
const asRegularUser = () =>
  authUser({ empresaId: "e1", esAdminEmpresa: false, empresa: { activo: true } });

beforeEach(() => vi.clearAllMocks());

describe("GET /contratos (gestión por ámbito)", () => {
  it("403 si es un USUARIO común (no admin de empresa)", async () => {
    usuario.findUnique.mockResolvedValue(asRegularUser());
    const res = await request(app).get("/contratos").set(auth(USER));
    expect(res.status).toBe(403);
  });

  it("admin de empresa → lista SOLO los de su empresa", async () => {
    usuario.findUnique.mockResolvedValue(asEmpresaAdmin());
    contrato.findMany.mockResolvedValue([]);
    const res = await request(app).get("/contratos").set(auth(EMPADMIN));
    expect(res.status).toBe(200);
    expect(contrato.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { empresaId: "e1" } }),
    );
  });

  it("ADMIN de plataforma → lista los de la plataforma (empresaId null)", async () => {
    usuario.findUnique.mockResolvedValue(authUser());
    contrato.findMany.mockResolvedValue([]);
    const res = await request(app).get("/contratos").set(auth(ADMIN));
    expect(res.status).toBe(200);
    expect(contrato.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { empresaId: null } }),
    );
  });
});

describe("GET /contratos/mio", () => {
  it("devuelve los contratos del propio usuario con url en sus documentos", async () => {
    usuario.findUnique.mockResolvedValue(asRegularUser());
    contrato.findMany.mockResolvedValue([
      { id: "c1", usuarioId: "u1", documentos: [{ id: "d1", path: "DEMO/CONTRATOS/x.pdf" }] },
    ]);
    const res = await request(app).get("/contratos/mio").set(auth(USER));
    expect(res.status).toBe(200);
    expect(contrato.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { usuarioId: "u1" } }),
    );
    expect(res.body[0].documentos[0].url).toContain("/documentos/DEMO/CONTRATOS/x.pdf");
  });
});

describe("POST /contratos", () => {
  it("403 si no es gestor", async () => {
    usuario.findUnique.mockResolvedValue(asRegularUser());
    const res = await request(app)
      .post("/contratos")
      .set(auth(USER))
      .send({ nombreCompleto: "Juan" });
    expect(res.status).toBe(403);
  });

  it("admin de empresa crea con empresaId del token (no del body)", async () => {
    usuario.findUnique.mockResolvedValue(asEmpresaAdmin());
    contrato.create.mockResolvedValue({ id: "c1", documentos: [] });
    const res = await request(app)
      .post("/contratos")
      .set(auth(EMPADMIN))
      .send({ nombreCompleto: "Juan Pérez", cargo: "Abogado" });
    expect(res.status).toBe(201);
    expect(contrato.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ empresaId: "e1", nombreCompleto: "Juan Pérez" }) }),
    );
  });

  it("ADMIN crea con empresaId null (personal de plataforma)", async () => {
    usuario.findUnique.mockResolvedValue(authUser());
    contrato.create.mockResolvedValue({ id: "c2", documentos: [] });
    const res = await request(app)
      .post("/contratos")
      .set(auth(ADMIN))
      .send({ nombreCompleto: "Vendedor LEX" });
    expect(res.status).toBe(201);
    expect(contrato.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ empresaId: null }) }),
    );
  });

  it("400 si falta nombreCompleto", async () => {
    usuario.findUnique.mockResolvedValue(asEmpresaAdmin());
    const res = await request(app).post("/contratos").set(auth(EMPADMIN)).send({ cargo: "x" });
    expect(res.status).toBe(400);
  });
});

describe("GET /contratos/:id (gestor o dueño)", () => {
  it("el dueño ve su contrato", async () => {
    usuario.findUnique.mockResolvedValue(asRegularUser());
    contrato.findUnique.mockResolvedValue({ id: "c1", empresaId: "e1", usuarioId: "u1", documentos: [] });
    const res = await request(app).get("/contratos/c1").set(auth(USER));
    expect(res.status).toBe(200);
  });

  it("admin de OTRA empresa no puede verlo (403)", async () => {
    usuario.findUnique.mockResolvedValue(asEmpresaAdmin()); // empresa e1
    contrato.findUnique.mockResolvedValue({ id: "c9", empresaId: "e2", usuarioId: "x", documentos: [] });
    const res = await request(app).get("/contratos/c9").set(auth(EMPADMIN));
    expect(res.status).toBe(403);
  });

  it("404 si no existe", async () => {
    usuario.findUnique.mockResolvedValue(asEmpresaAdmin());
    contrato.findUnique.mockResolvedValue(null);
    const res = await request(app).get("/contratos/nope").set(auth(EMPADMIN));
    expect(res.status).toBe(404);
  });
});

describe("PATCH /contratos/:id", () => {
  it("el dueño NO puede editar su contrato (solo el gestor)", async () => {
    usuario.findUnique.mockResolvedValue(asRegularUser());
    contrato.findUnique.mockResolvedValue({ empresaId: "e1" }); // sin match de manager para USER
    const res = await request(app).patch("/contratos/c1").set(auth(USER)).send({ cargo: "Senior" });
    expect(res.status).toBe(403);
  });

  it("el admin de empresa edita", async () => {
    usuario.findUnique.mockResolvedValue(asEmpresaAdmin());
    contrato.findUnique.mockResolvedValue({ empresaId: "e1" });
    contrato.update.mockResolvedValue({ id: "c1", documentos: [] });
    const res = await request(app).patch("/contratos/c1").set(auth(EMPADMIN)).send({ cargo: "Senior" });
    expect(res.status).toBe(200);
    expect(contrato.update).toHaveBeenCalled();
  });
});

describe("POST /contratos/:id/documentos (subida)", () => {
  it("el dueño sube un documento de su contrato", async () => {
    usuario.findUnique.mockResolvedValue(asRegularUser());
    contrato.findUnique.mockResolvedValue({
      id: "c1",
      empresaId: "e1",
      usuarioId: "u1",
      numeroDocumento: "1088",
    });
    subir.mockResolvedValue({ path: "DEMO/CONTRATOS/2026/06/1_c.pdf", filename: "1_c.pdf", url: "x" });
    documento.create.mockResolvedValue({ id: "d1", path: "DEMO/CONTRATOS/2026/06/1_c.pdf" });

    const res = await request(app)
      .post("/contratos/c1/documentos")
      .set(auth(USER))
      .field("categoria", "PERSONAL")
      .field("nombre", "Cédula")
      .attach("file", Buffer.from("%PDF"), "cedula.pdf");

    expect(res.status).toBe(201);
    expect(subir).toHaveBeenCalledWith(
      expect.objectContaining({ carpeta: expect.stringContaining("_CONTRATOS"), documento: "1088" }),
    );
    expect(res.body.url).toContain("/documentos/DEMO/CONTRATOS/2026/06/1_c.pdf");
  });

  it("un extraño (ni gestor ni dueño) recibe 403", async () => {
    usuario.findUnique.mockResolvedValue(asRegularUser()); // u1
    contrato.findUnique.mockResolvedValue({ id: "c1", empresaId: "e2", usuarioId: "otro", numeroDocumento: null });
    const res = await request(app)
      .post("/contratos/c1/documentos")
      .set(auth(USER))
      .field("categoria", "PERSONAL")
      .field("nombre", "Cédula")
      .attach("file", Buffer.from("x"), "c.pdf");
    expect(res.status).toBe(403);
    expect(subir).not.toHaveBeenCalled();
  });
});
