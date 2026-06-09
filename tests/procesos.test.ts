import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock del cliente Prisma — los tests no tocan la BD real.
vi.mock("../src/index", () => ({
  prisma: {
    usuario: { findUnique: vi.fn(), findFirst: vi.fn() },
    areaPractica: { findMany: vi.fn() },
    tipoProceso: { findUnique: vi.fn(), findMany: vi.fn() },
    proceso: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    litigante: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    parteProceso: { create: vi.fn() },
    etapaProceso: { create: vi.fn() },
    plantillaDocumento: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    documentoProceso: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/index";
import { signToken } from "../src/modules/auth/auth.service";

const app = createApp();
const m = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const usuario = m.usuario;
const tipoProceso = m.tipoProceso;
const proceso = m.proceso;
const areaPractica = m.areaPractica;
const plantillaDocumento = m.plantillaDocumento;
const documentoProceso = m.documentoProceso;

const token = signToken({ sub: "u1", rol: "USUARIO" });
const adminToken = signToken({ sub: "a1", rol: "ADMIN" });
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeEach(() => {
  vi.clearAllMocks();
  // requireAuth: el portador es un USUARIO del despacho "emp1".
  usuario.findUnique.mockResolvedValue({
    activo: true,
    activationToken: null,
    tokenVersion: 0,
    empresaId: "emp1",
    esAdminEmpresa: false,
  });
});

const tipoCivil = {
  id: "tt1",
  empresaId: null,
  esquemaVersion: 1,
  jurisdiccion: "ORDINARIA_CIVIL",
  esquemaFormulario: [
    { key: "valor", label: "Valor", tipo: "numero", requerido: true },
  ],
  etapas: [
    { key: "demanda", nombre: "Demanda", orden: 1 },
    { key: "fallo", nombre: "Fallo", orden: 2, reglas: { camposRequeridos: ["valor"] } },
  ],
};

describe("auth", () => {
  it("rechaza sin token (401)", async () => {
    const res = await request(app).get("/catalogo/areas");
    expect(res.status).toBe(401);
  });
});

describe("catálogo de áreas", () => {
  it("lista las áreas activas (200)", async () => {
    areaPractica.findMany.mockResolvedValue([{ slug: "civil", nombre: "Civil" }]);
    const res = await request(app).get("/catalogo/areas").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe("POST /procesos — validación del formulario dinámico", () => {
  it("400 cuando falta un campo requerido", async () => {
    tipoProceso.findUnique.mockResolvedValue(tipoCivil);
    const res = await request(app)
      .post("/procesos")
      .set(auth(token))
      .send({ tipoProcesoId: "tt1", titulo: "Caso", datos: {} });
    expect(res.status).toBe(400);
    expect(res.body.error.issues.faltantes).toContain("Valor");
  });

  it("400 cuando hay una clave no declarada en el esquema", async () => {
    tipoProceso.findUnique.mockResolvedValue(tipoCivil);
    const res = await request(app)
      .post("/procesos")
      .set(auth(token))
      .send({ tipoProcesoId: "tt1", titulo: "Caso", datos: { valor: "100", basura: "x" } });
    expect(res.status).toBe(400);
  });

  it("404 cuando el tipo es de otro despacho", async () => {
    tipoProceso.findUnique.mockResolvedValue({ ...tipoCivil, empresaId: "otra" });
    const res = await request(app)
      .post("/procesos")
      .set(auth(token))
      .send({ tipoProcesoId: "tt1", titulo: "Caso", datos: { valor: "100" } });
    expect(res.status).toBe(404);
  });
});

describe("scoping multi-tenant", () => {
  it("GET /procesos/:id de otro despacho devuelve 404", async () => {
    proceso.findFirst.mockResolvedValue(null); // findFirst usa { id, empresaId }
    const res = await request(app).get("/procesos/otro").set(auth(token));
    expect(res.status).toBe(404);
    // La consulta filtró por el empresaId del portador.
    expect(proceso.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ empresaId: "emp1" }) }),
    );
  });

  it("GET /procesos lista paginada del despacho (200)", async () => {
    proceso.count.mockResolvedValue(0);
    proceso.findMany.mockResolvedValue([]);
    const res = await request(app).get("/procesos").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0, page: 1 });
  });
});

describe("PATCH /procesos/:id/etapa — rule-gated", () => {
  it("400 cuando la etapa destino exige un campo ausente", async () => {
    proceso.findFirst.mockResolvedValue({
      id: "tr1",
      estado: "ABIERTO",
      datos: {}, // sin "valor"
      documentos: [],
      tipoProceso: { etapas: tipoCivil.etapas },
    });
    const res = await request(app)
      .patch("/procesos/tr1/etapa")
      .set(auth(token))
      .send({ etapaKey: "fallo" });
    expect(res.status).toBe(400);
    expect(res.body.error.issues.faltantes).toContain("valor");
  });

  it("400 cuando la etapa destino exige un documento ausente", async () => {
    proceso.findFirst.mockResolvedValue({
      id: "tr1",
      estado: "ABIERTO",
      datos: { valor: 100 },
      documentos: [], // no se ha generado/adjuntado "Demanda"
      tipoProceso: {
        etapas: [
          { key: "inicio", nombre: "Inicio", orden: 1 },
          { key: "fallo", nombre: "Fallo", orden: 2, reglas: { documentosRequeridos: ["Demanda"] } },
        ],
      },
    });
    const res = await request(app)
      .patch("/procesos/tr1/etapa")
      .set(auth(token))
      .send({ etapaKey: "fallo" });
    expect(res.status).toBe(400);
    expect(res.body.error.issues.documentosFaltantes).toContain("Demanda");
  });

  it("avanza cuando el documento requerido está presente (insensible a mayúsculas)", async () => {
    proceso.findFirst.mockResolvedValue({
      id: "tr1",
      estado: "ABIERTO",
      datos: {},
      documentos: [{ nombre: "  demanda " }], // coincide con "Demanda"
      tipoProceso: {
        etapas: [
          { key: "inicio", nombre: "Inicio", orden: 1 },
          { key: "fallo", nombre: "Fallo", orden: 2, reglas: { documentosRequeridos: ["Demanda"] } },
        ],
      },
    });
    m.$transaction.mockImplementation(async (cb: (tx: typeof m) => unknown) => cb(m));
    m.etapaProceso.create.mockResolvedValue({});
    proceso.update.mockResolvedValue({ id: "tr1", etapaActual: "fallo" });
    const res = await request(app)
      .patch("/procesos/tr1/etapa")
      .set(auth(token))
      .send({ etapaKey: "fallo" });
    expect(res.status).toBe(200);
  });
});

// Un proceso completo tal como lo carga el endpoint de generación (con partes).
const procesoConPartes = {
  id: "tr1",
  tipoProcesoId: "tt1",
  codigoInterno: "CASO-2026-0001",
  radicado: null,
  titulo: "Demanda ejecutiva",
  despachoJuzgado: "Juzgado 3 Civil",
  jurisdiccion: "ORDINARIA_CIVIL",
  instancia: "PRIMERA",
  cuantiaTipo: "MENOR",
  cuantiaValor: 5_000_000,
  etapaActual: "demanda",
  estado: "ABIERTO",
  proximaAudiencia: null,
  createdAt: new Date("2026-06-06T12:00:00Z"),
  datos: { valor: 5_000_000 },
  partes: [
    { rol: "DEMANDANTE", rolEtiqueta: null, esNuestroCliente: true, litigante: { nombre: "Juan Pérez" } },
  ],
};

describe("documentos — generación desde plantilla", () => {
  it("genera un borrador sustituyendo los placeholders (201)", async () => {
    proceso.findFirst.mockResolvedValue(procesoConPartes);
    plantillaDocumento.findFirst.mockResolvedValue({
      id: "pl1",
      tipoProcesoId: "tt1",
      nombre: "Demanda",
      contenido: "Sr. {{parte.demandante.nombre}}, cuantía {{moneda datos.valor}}.",
    });
    documentoProceso.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: "doc1", ...data }));

    const res = await request(app)
      .post("/procesos/tr1/documentos/generar")
      .set(auth(token))
      .send({ plantillaId: "pl1" });

    expect(res.status).toBe(201);
    expect(res.body.contenido).toBe("Sr. Juan Pérez, cuantía 5.000.000.");
    expect(res.body.generadoDePlantilla).toBe("pl1");
    expect(res.body.nombre).toBe("Demanda");
  });

  it("404 si la plantilla no es del tipo del proceso", async () => {
    proceso.findFirst.mockResolvedValue(procesoConPartes);
    plantillaDocumento.findFirst.mockResolvedValue(null); // filtro tipoProcesoId no encontró
    const res = await request(app)
      .post("/procesos/tr1/documentos/generar")
      .set(auth(token))
      .send({ plantillaId: "ajena" });
    expect(res.status).toBe(404);
  });
});

describe("documentos — adjuntar/editar/eliminar", () => {
  it("adjunta un archivo por enlace (201)", async () => {
    proceso.findFirst.mockResolvedValue({ id: "tr1" });
    documentoProceso.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: "doc2", ...data }));
    const res = await request(app)
      .post("/procesos/tr1/documentos")
      .set(auth(token))
      .send({ nombre: "Poder", url: "https://files/poder.pdf" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ nombre: "Poder", url: "https://files/poder.pdf" });
  });

  it("edita el borrador (200)", async () => {
    documentoProceso.findFirst.mockResolvedValue({ id: "doc1" });
    documentoProceso.update.mockResolvedValue({ id: "doc1", contenido: "editado" });
    const res = await request(app)
      .patch("/procesos/tr1/documentos/doc1")
      .set(auth(token))
      .send({ contenido: "editado" });
    expect(res.status).toBe(200);
    expect(res.body.contenido).toBe("editado");
  });

  it("404 al editar un documento de otro despacho", async () => {
    documentoProceso.findFirst.mockResolvedValue(null); // scope por proceso.empresaId no halló
    const res = await request(app)
      .patch("/procesos/tr1/documentos/ajeno")
      .set(auth(token))
      .send({ contenido: "x" });
    expect(res.status).toBe(404);
  });

  it("elimina un documento (204)", async () => {
    documentoProceso.findFirst.mockResolvedValue({ id: "doc1" });
    documentoProceso.delete.mockResolvedValue({ id: "doc1" });
    const res = await request(app).delete("/procesos/tr1/documentos/doc1").set(auth(token));
    expect(res.status).toBe(204);
  });
});

describe("plantillas — CRUD por tipo (autorización)", () => {
  it("ADMIN crea una plantilla en un tipo global (201)", async () => {
    tipoProceso.findUnique.mockResolvedValue({ id: "tt1", empresaId: null });
    plantillaDocumento.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: "pl1", ...data }));
    const res = await request(app)
      .post("/catalogo/tipos-proceso/tt1/plantillas")
      .set(auth(adminToken))
      .send({ nombre: "Demanda", contenido: "{{datos.valor}}" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tipoProcesoId: "tt1", nombre: "Demanda" });
  });

  it("USUARIO no-admin no puede crear plantilla en un tipo global (403)", async () => {
    tipoProceso.findUnique.mockResolvedValue({ id: "tt1", empresaId: null });
    const res = await request(app)
      .post("/catalogo/tipos-proceso/tt1/plantillas")
      .set(auth(token))
      .send({ nombre: "X", contenido: "y" });
    expect(res.status).toBe(403);
  });
});
