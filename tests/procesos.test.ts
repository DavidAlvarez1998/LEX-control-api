import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock del cliente Prisma — los tests no tocan la BD real.
vi.mock("../src/index", () => ({
  prisma: {
    usuario: { findUnique: vi.fn(), findFirst: vi.fn() },
    areaPractica: { findMany: vi.fn() },
    tipoProceso: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    proceso: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    litigante: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), upsert: vi.fn() },
    cliente: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    parteProceso: { create: vi.fn() },
    etapaProceso: { create: vi.fn() },
    plantillaDocumento: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    documentoProceso: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    // requirePermiso: puerta de módulo (modulo/suscripcion) + RBAC (permiso.roles).
    permiso: { findUnique: vi.fn() },
    modulo: { findMany: vi.fn() },
    suscripcion: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// Mock SOLO de subirDocumento (no red); construirUrlDocumento queda real.
vi.mock("../src/modules/documentos/documentos.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/modules/documentos/documentos.client")>();
  return { ...actual, subirDocumento: vi.fn() };
});

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/index";
import { signToken } from "../src/modules/auth/auth.service";
import { subirDocumento } from "../src/modules/documentos/documentos.client";

const app = createApp();
const m = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const usuario = m.usuario;
const tipoProceso = m.tipoProceso;
const proceso = m.proceso;
const areaPractica = m.areaPractica;
const plantillaDocumento = m.plantillaDocumento;
const documentoProceso = m.documentoProceso;
const permiso = m.permiso;
const subir = subirDocumento as unknown as ReturnType<typeof vi.fn>;

const token = signToken({ sub: "u1", rol: "USUARIO" });
const adminToken = signToken({ sub: "a1", rol: "ADMIN" });
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeEach(() => {
  vi.clearAllMocks();
  // requireAuth: el portador es un USUARIO JURIDICO del despacho "emp1".
  usuario.findUnique.mockResolvedValue({
    activo: true,
    activationToken: null,
    tokenVersion: 0,
    empresaId: "emp1",
    esAdminEmpresa: false,
    rolesEmpresa: [{ rolEmpresa: "JURIDICO" }],
  });
  // requirePermiso: módulo judicial (baseline) habilitado + RBAC concede a JURIDICO.
  m.modulo.findMany.mockResolvedValue([{ clave: "judicial" }]);
  m.suscripcion.findUnique.mockResolvedValue({
    estado: "ACTIVA",
    plan: { modulos: [], cuotas: [] },
    modulos: [],
    cuotas: [],
  });
  permiso.findUnique.mockResolvedValue({
    modulo: { clave: "judicial" },
    roles: [{ rolEmpresa: "JURIDICO" }],
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

describe("POST /procesos — cliente dueño y abogado responsable", () => {
  const datosOk = { tipoProcesoId: "tt1", titulo: "Caso", datos: { valor: "100" } };

  // Prepara el happy-path: tipo válido + transacción que ejecuta el callback.
  function mockCreateOk() {
    tipoProceso.findUnique.mockResolvedValue(tipoCivil);
    proceso.count.mockResolvedValue(0);
    proceso.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: "tr1", ...data }));
    proceso.findUnique.mockResolvedValue({ id: "tr1" });
    m.parteProceso.create.mockResolvedValue({});
    m.cliente.update.mockResolvedValue({});
    m.$transaction.mockImplementation(async (cb: (tx: typeof m) => unknown) => cb(m));
  }

  it("vincula un cliente existente y lo agrega como parte esNuestroCliente (201)", async () => {
    mockCreateOk();
    m.cliente.findFirst.mockResolvedValue({
      id: "cli1", empresaId: "emp1", litiganteId: "lit1", nombre: "Juan",
      tipoPersona: "NATURAL", tipoDocumento: null, numeroDocumento: null, email: null, telefono: null,
    });
    const res = await request(app)
      .post("/procesos")
      .set(auth(token))
      .send({ ...datosOk, cliente: { clienteId: "cli1", rol: "DEMANDANTE" } });
    expect(res.status).toBe(201);
    expect(proceso.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clienteId: "cli1" }) }),
    );
    expect(m.parteProceso.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ litiganteId: "lit1", rol: "DEMANDANTE", esNuestroCliente: true }),
      }),
    );
  });

  it("crea un cliente nuevo inline y lo vincula al proceso (201)", async () => {
    mockCreateOk();
    m.cliente.create.mockResolvedValue({
      id: "cliN", empresaId: "emp1", litiganteId: null, nombre: "Nuevo",
      tipoPersona: "NATURAL", tipoDocumento: null, numeroDocumento: null, email: null, telefono: null,
    });
    m.litigante.create.mockResolvedValue({ id: "litN" });
    const res = await request(app)
      .post("/procesos")
      .set(auth(token))
      .send({ ...datosOk, cliente: { nuevo: { nombre: "Nuevo" }, rol: "ACCIONANTE" } });
    expect(res.status).toBe(201);
    expect(m.cliente.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nombre: "Nuevo", empresaId: "emp1" }) }),
    );
    expect(proceso.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clienteId: "cliN" }) }),
    );
  });

  it("el consecutivo deriva del ÚLTIMO código (no de count)", async () => {
    mockCreateOk();
    const year = new Date().getFullYear();
    proceso.findFirst.mockResolvedValue({ codigoInterno: `EXP-${year}-0042` }); // último existente
    const res = await request(app).post("/procesos").set(auth(token)).send(datosOk);
    expect(res.status).toBe(201);
    expect(proceso.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ codigoInterno: `EXP-${year}-0043` }) }),
    );
  });

  it("400 si el cliente referenciado es de otro despacho", async () => {
    mockCreateOk();
    m.cliente.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .post("/procesos")
      .set(auth(token))
      .send({ ...datosOk, cliente: { clienteId: "ajeno", rol: "DEMANDANTE" } });
    expect(res.status).toBe(400);
  });

  it("400 si el responsable no es del despacho", async () => {
    tipoProceso.findUnique.mockResolvedValue(tipoCivil);
    usuario.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .post("/procesos")
      .set(auth(token))
      .send({ ...datosOk, responsableId: "ajeno" });
    expect(res.status).toBe(400);
  });

  it("autoasigna al creador como responsable cuando es abogado (JURIDICO)", async () => {
    mockCreateOk();
    usuario.findUnique.mockResolvedValue({
      activo: true, activationToken: null, tokenVersion: 0, empresaId: "emp1",
      esAdminEmpresa: false, rolesEmpresa: [{ rolEmpresa: "JURIDICO" }],
    });
    const res = await request(app).post("/procesos").set(auth(token)).send(datosOk);
    expect(res.status).toBe(201);
    expect(proceso.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ responsableId: "u1" }) }),
    );
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

describe("GET /procesos — búsqueda y filtros (change procesos-ux-ddp-tutela)", () => {
  beforeEach(() => {
    proceso.count.mockResolvedValue(0);
    proceso.findMany.mockResolvedValue([]);
  });
  const whereDe = () => proceso.findMany.mock.calls.at(-1)![0].where as Record<string, unknown>;

  it("q busca por código/título/radicado/cliente y queda scoped al despacho", async () => {
    const res = await request(app).get("/procesos?q=salud").set(auth(token));
    expect(res.status).toBe(200);
    const where = whereDe();
    expect(where.empresaId).toBe("emp1");
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { codigoInterno: { contains: "salud" } },
        { titulo: { contains: "salud" } },
        { radicado: { contains: "salud" } },
        { cliente: { is: { nombre: { contains: "salud" } } } },
      ]),
    );
  });

  it("responsableId filtra por abogado, scoped al despacho", async () => {
    const res = await request(app).get("/procesos?responsableId=ab1").set(auth(token));
    expect(res.status).toBe(200);
    expect(whereDe()).toMatchObject({ empresaId: "emp1", responsableId: "ab1" });
  });

  it("sin q no agrega cláusula OR (lista normal)", async () => {
    await request(app).get("/procesos").set(auth(token));
    const where = whereDe();
    expect(where.empresaId).toBe("emp1");
    expect(where.OR).toBeUndefined();
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

// ===================== FASE 3: motor de vencimientos + ramas + derivar =====================

// Etapas estilo derecho de petición para los tests de Fase 3.
const etapasDdP = [
  { key: "borrador", nombre: "Borrador", orden: 0 },
  {
    key: "radicada",
    nombre: "Radicada",
    orden: 1,
    reglas: {
      plazoDesdeCampo: "fechaRadicacion",
      plazoTipoDias: "habiles",
      plazoDiasPorValorDe: { campo: "tipoPeticion", mapa: { General: 15, Documental: 10, Consulta: 30 } },
      requeridosSi: [{ si: { campo: "requierePoder", igualA: "true" }, documentosRequeridos: ["poder.pdf"] }],
    },
  },
  { key: "respondida", nombre: "Respondida", orden: 2, terminal: true, disponibleSi: { campo: "contestaron", igualA: "SI" } },
  { key: "escala_tutela", nombre: "Escala a tutela", orden: 3, disponibleSi: { campo: "contestaron", igualA: "NO" }, accion: { tipo: "crearDerivado", tipoDestinoNombre: "Acción de Tutela" } },
];

describe("PATCH /procesos/:id/etapa — ramas condicionales + plazo (Fase 3)", () => {
  it("422 cuando la etapa destino no está disponible (disponibleSi no se cumple)", async () => {
    proceso.findFirst.mockResolvedValue({
      id: "tr1", estado: "EN_PROCESO", etapaActual: "radicada",
      datos: { contestaron: "SI" }, documentos: [],
      tipoProceso: { etapas: etapasDdP },
    });
    const res = await request(app).patch("/procesos/tr1/etapa").set(auth(token)).send({ etapaKey: "escala_tutela" });
    expect(res.status).toBe(422);
  });

  it("400 cuando un requerido condicional (requeridosSi) falta", async () => {
    proceso.findFirst.mockResolvedValue({
      id: "tr1", estado: "ABIERTO", etapaActual: "borrador",
      datos: { fechaRadicacion: "2026-02-02", tipoPeticion: "Documental", requierePoder: true },
      documentos: [], // falta poder.pdf
      tipoProceso: { etapas: etapasDdP },
    });
    const res = await request(app).patch("/procesos/tr1/etapa").set(auth(token)).send({ etapaKey: "radicada" });
    expect(res.status).toBe(400);
    expect(res.body.error.issues.documentosFaltantes).toContain("poder.pdf");
  });

  it("deriva fechaLimite = radicación + 10 días hábiles (DdP documental)", async () => {
    proceso.findFirst.mockResolvedValue({
      id: "tr1", estado: "ABIERTO", etapaActual: "borrador",
      datos: { fechaRadicacion: "2026-02-02", tipoPeticion: "Documental", requierePoder: false },
      documentos: [],
      tipoProceso: { etapas: etapasDdP },
    });
    m.$transaction.mockImplementation(async (cb: (tx: typeof m) => unknown) => cb(m));
    m.etapaProceso.create.mockResolvedValue({});
    proceso.update.mockResolvedValue({ id: "tr1", etapaActual: "radicada" });

    const res = await request(app).patch("/procesos/tr1/etapa").set(auth(token)).send({ etapaKey: "radicada" });
    expect(res.status).toBe(200);
    const fechaLimite = proceso.update.mock.calls[0][0].data.fechaLimite as Date;
    expect(fechaLimite.toISOString().slice(0, 10)).toBe("2026-02-16");
  });
});

describe("POST /procesos/:id/derivar — escalar a tutela (Fase 3)", () => {
  const tutela = { id: "tt-tutela", empresaId: null, esquemaVersion: 1, jurisdiccion: "CONSTITUCIONAL", nombre: "Acción de Tutela", etapas: [{ key: "presentada", nombre: "Presentada", orden: 0 }] };
  const ddpEnEscala = { id: "tr1", titulo: "DdP ante DIAN", etapaActual: "escala_tutela", tipoProceso: { etapas: etapasDdP } };

  it("201 crea el derivado ligado por casoRelacionadoId", async () => {
    proceso.findFirst.mockResolvedValueOnce(ddpEnEscala).mockResolvedValueOnce(null); // proceso, luego "sin derivado previo"
    tipoProceso.findFirst.mockResolvedValue(tutela);
    proceso.count.mockResolvedValue(0);
    m.$transaction.mockImplementation(async (cb: (tx: typeof m) => unknown) => cb(m));
    proceso.create.mockResolvedValue({ id: "deriv1" });
    proceso.findUnique.mockResolvedValue({ id: "deriv1", casoRelacionadoId: "tr1" });

    const res = await request(app).post("/procesos/tr1/derivar").set(auth(token));
    expect(res.status).toBe(201);
    expect(proceso.create.mock.calls[0][0].data).toMatchObject({ casoRelacionadoId: "tr1", tipoProcesoId: "tt-tutela" });
  });

  it("409 si ya existe un derivado de ese tipo (idempotente)", async () => {
    proceso.findFirst.mockResolvedValueOnce(ddpEnEscala).mockResolvedValueOnce({ id: "deriv1", codigoInterno: "TUT-2026-0001" });
    tipoProceso.findFirst.mockResolvedValue(tutela);
    const res = await request(app).post("/procesos/tr1/derivar").set(auth(token));
    expect(res.status).toBe(409);
    expect(res.body.error.issues.procesoId).toBe("deriv1");
  });

  it("400 si la etapa actual no define acción de derivación", async () => {
    proceso.findFirst.mockResolvedValueOnce({ id: "tr1", titulo: "X", etapaActual: "borrador", tipoProceso: { etapas: etapasDdP } });
    const res = await request(app).post("/procesos/tr1/derivar").set(auth(token));
    expect(res.status).toBe(400);
  });
});

describe("POST /procesos/:id/derivar — carry-over (reiteración)", () => {
  const baseEtapas = [
    { key: "reiteracion", nombre: "Reiteración", orden: 2, accion: { tipo: "crearDerivado", tipoDestinoNombre: "Derecho de Petición", copiarDatos: ["entidad", "tipoPeticion"], copiarCliente: true } },
  ];
  const ddpDestino = { id: "tt-ddp", empresaId: null, esJudicial: false, esquemaVersion: 3, jurisdiccion: "CONSTITUCIONAL", nombre: "Derecho de Petición", etapas: [{ key: "borrador", orden: 0 }] };

  it("copia solo los datos declarados + el mismo cliente como parte (rol Peticionario)", async () => {
    proceso.findFirst
      .mockResolvedValueOnce({ id: "tr1", titulo: "DdP Uno", etapaActual: "reiteracion", clienteId: "cli1", datos: { entidad: "Alcaldía", tipoPeticion: "General", contestaron: "PARCIAL" }, tipoProceso: { etapas: baseEtapas } })
      .mockResolvedValueOnce(null); // sin derivado previo
    tipoProceso.findFirst.mockResolvedValue(ddpDestino);
    proceso.count.mockResolvedValue(0);
    m.cliente.findFirst.mockResolvedValue({ id: "cli1", litiganteId: "lit1" });
    m.$transaction.mockImplementation(async (cb: (tx: typeof m) => unknown) => cb(m));
    proceso.create.mockResolvedValue({ id: "deriv1" });
    m.parteProceso.create.mockResolvedValue({});
    proceso.findUnique.mockResolvedValue({ id: "deriv1", casoRelacionadoId: "tr1" });

    const res = await request(app).post("/procesos/tr1/derivar").set(auth(token));
    expect(res.status).toBe(201);
    // datos: solo las keys de copiarDatos (NO contestaron).
    expect(proceso.create.mock.calls[0][0].data.datos).toEqual({ entidad: "Alcaldía", tipoPeticion: "General" });
    expect(proceso.create.mock.calls[0][0].data).toMatchObject({ clienteId: "cli1", casoRelacionadoId: "tr1" });
    // el cliente entra como parte; rol no-judicial = OTRO/Peticionario.
    expect(m.parteProceso.create.mock.calls[0][0].data).toMatchObject({ litiganteId: "lit1", esNuestroCliente: true, rol: "OTRO", rolEtiqueta: "Peticionario" });
  });
});

describe("GET /procesos/:id/caso — cadena del caso", () => {
  it("devuelve la cadena raíz→hojas (DdP → reiteración)", async () => {
    const tp = { nombre: "Derecho de Petición", esJudicial: false };
    const A = { id: "A", codigoInterno: "DP-1", titulo: "Uno", estado: "ABIERTO", etapaActual: "respondida", fechaLimite: null, casoRelacionadoId: null, createdAt: new Date(), tipoProceso: tp };
    const B = { id: "B", codigoInterno: "DP-2", titulo: "Dos", estado: "ABIERTO", etapaActual: "borrador", fechaLimite: null, casoRelacionadoId: "A", createdAt: new Date(), tipoProceso: tp };
    proceso.findFirst.mockResolvedValueOnce(B).mockResolvedValueOnce(A); // inicial=B, luego padre=A
    proceso.findMany.mockResolvedValueOnce([B]).mockResolvedValueOnce([]); // hijos de A, luego de B
    const res = await request(app).get("/procesos/B/caso").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.map((n: { codigoInterno: string }) => n.codigoInterno)).toEqual(["DP-1", "DP-2"]);
    expect(res.body[0].tipoProcesoNombre).toBe("Derecho de Petición");
  });
});

describe("GET /procesos/vencimientos — semáforo (Fase 3)", () => {
  it("clasifica en vencido / por_vencer / al_dia y aísla por despacho", async () => {
    const ahora = new Date();
    const hoy = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate());
    const dia = 86_400_000;
    proceso.findMany.mockResolvedValue([
      { id: "v", codigoInterno: "A", titulo: "vencido", fechaLimite: new Date(hoy - 5 * dia) },
      { id: "p", codigoInterno: "B", titulo: "por vencer", fechaLimite: new Date(hoy + dia) },
      { id: "a", codigoInterno: "C", titulo: "lejano", fechaLimite: new Date(hoy + 60 * dia) },
      { id: "n", codigoInterno: "D", titulo: "sin plazo", fechaLimite: null },
    ]);
    const res = await request(app).get("/procesos/vencimientos").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.vencido.map((x: { id: string }) => x.id)).toEqual(["v"]);
    expect(res.body.por_vencer.map((x: { id: string }) => x.id)).toEqual(["p"]);
    expect(res.body.al_dia.map((x: { id: string }) => x.id).sort()).toEqual(["a", "n"]);
    expect(proceso.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ empresaId: "emp1" }) }),
    );
  });
});

describe("PATCH /procesos/:id — editar datos del formulario (gap datos)", () => {
  const esquemaDdP = [
    { key: "entidad", label: "Entidad", tipo: "texto", requerido: true },
    { key: "tipoPeticion", label: "Tipo", tipo: "select", requerido: true, opciones: ["General", "Documental"] },
  ];

  it("200 guarda datos parciales (no exige requeridos al editar borrador)", async () => {
    proceso.findFirst.mockResolvedValue({ id: "tr1", tipoProceso: { esquemaFormulario: esquemaDdP } });
    proceso.update.mockResolvedValue({ id: "tr1" });
    const res = await request(app).patch("/procesos/tr1").set(auth(token)).send({ datos: { entidad: "DIAN" } });
    expect(res.status).toBe(200);
    expect(proceso.update.mock.calls[0][0].data.datos).toEqual({ entidad: "DIAN" });
  });

  it("descarta claves obsoletas (drift de esquema) en vez de bloquear", async () => {
    proceso.findFirst.mockResolvedValue({ id: "tr1", tipoProceso: { esquemaFormulario: esquemaDdP } });
    proceso.update.mockResolvedValue({ id: "tr1" });
    const res = await request(app).patch("/procesos/tr1").set(auth(token)).send({ datos: { entidad: "DIAN", claseObligacion: "x" } });
    expect(res.status).toBe(200);
    // La clave obsoleta no se persiste; el campo vigente sí.
    expect(proceso.update.mock.calls[0][0].data.datos).toEqual({ entidad: "DIAN" });
  });

  it("400 si un select trae una opción inválida", async () => {
    proceso.findFirst.mockResolvedValue({ id: "tr1", tipoProceso: { esquemaFormulario: esquemaDdP } });
    const res = await request(app).patch("/procesos/tr1").set(auth(token)).send({ datos: { tipoPeticion: "Zzz" } });
    expect(res.status).toBe(400);
  });
});

describe("RBAC — COMERCIAL solo lectura, acotado a sus clientes", () => {
  // Un COMERCIAL (sin JURIDICO ni admin de empresa) del despacho "emp1".
  const comercial = {
    activo: true, activationToken: null, tokenVersion: 0,
    empresaId: "emp1", esAdminEmpresa: false,
    rolesEmpresa: [{ rolEmpresa: "COMERCIAL" }],
  };

  it("GET / 200 y acota a sus clientes (responsable o responsableComercial)", async () => {
    usuario.findUnique.mockResolvedValue(comercial);
    permiso.findUnique.mockResolvedValue({ modulo: { clave: "judicial" }, roles: [{ rolEmpresa: "JURIDICO" }, { rolEmpresa: "COMERCIAL" }] });
    proceso.count.mockResolvedValue(0);
    proceso.findMany.mockResolvedValue([]);
    const res = await request(app).get("/procesos").set(auth(token));
    expect(res.status).toBe(200);
    expect(proceso.findMany.mock.calls[0][0].where).toHaveProperty("OR");
  });

  it("POST / 403 (no puede crear procesos)", async () => {
    usuario.findUnique.mockResolvedValue(comercial);
    permiso.findUnique.mockResolvedValue({ modulo: { clave: "judicial" }, roles: [{ rolEmpresa: "JURIDICO" }] });
    const res = await request(app).post("/procesos").set(auth(token)).send({ titulo: "x", tipoProcesoId: "tt1" });
    expect(res.status).toBe(403);
    expect(proceso.create).not.toHaveBeenCalled();
  });

  it("PATCH /:id/etapa 403 (no puede mover etapas)", async () => {
    usuario.findUnique.mockResolvedValue(comercial);
    permiso.findUnique.mockResolvedValue({ modulo: { clave: "judicial" }, roles: [{ rolEmpresa: "JURIDICO" }] });
    const res = await request(app).patch("/procesos/tr1/etapa").set(auth(token)).send({ etapaKey: "fallo" });
    expect(res.status).toBe(403);
  });
});

describe("POST /procesos/:id/documentos/subir (subida de archivo a tecnovapp)", () => {
  it("201 sube el archivo y lo registra guardando la path en `url`", async () => {
    proceso.findFirst.mockResolvedValue({ id: "p1", codigoInterno: "DP-2026-0001" });
    subir.mockResolvedValue({ path: "DEMO/PROCESOS/2026/06/poder.pdf", filename: "poder.pdf", url: "ignored" });
    documentoProceso.create.mockResolvedValue({ id: "d1", nombre: "poder.pdf", url: "DEMO/PROCESOS/2026/06/poder.pdf" });
    const res = await request(app)
      .post("/procesos/p1/documentos/subir")
      .set(auth(token))
      .field("nombre", "poder.pdf")
      .attach("file", Buffer.from("%PDF"), "mi_poder.pdf");
    expect(res.status).toBe(201);
    // carpeta del módulo + identificador del dueño (codigoInterno) van a tecnovapp.
    expect(subir).toHaveBeenCalledWith(
      expect.objectContaining({ carpeta: expect.stringContaining("_PROCESOS"), documento: "DP-2026-0001" }),
    );
    expect(documentoProceso.create.mock.calls[0][0].data).toMatchObject({
      procesoId: "p1",
      nombre: "poder.pdf",
      url: "DEMO/PROCESOS/2026/06/poder.pdf",
    });
    // La respuesta trae la URL pública resuelta desde la path.
    expect(res.body.url).toContain("/documentos/DEMO/PROCESOS/2026/06/poder.pdf");
  });

  it("404 si el proceso no es del despacho (no sube nada)", async () => {
    proceso.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .post("/procesos/p9/documentos/subir")
      .set(auth(token))
      .attach("file", Buffer.from("x"), "p.pdf");
    expect(res.status).toBe(404);
    expect(subir).not.toHaveBeenCalled();
  });

  it("400 si no se adjunta archivo", async () => {
    proceso.findFirst.mockResolvedValue({ id: "p1", codigoInterno: "DP-1" });
    const res = await request(app).post("/procesos/p1/documentos/subir").set(auth(token));
    expect(res.status).toBe(400);
    expect(subir).not.toHaveBeenCalled();
  });

  it("403 si el rol no tiene proceso.editar (p. ej. COMERCIAL)", async () => {
    usuario.findUnique.mockResolvedValue({
      activo: true, activationToken: null, tokenVersion: 0,
      empresaId: "emp1", esAdminEmpresa: false, rolesEmpresa: [{ rolEmpresa: "COMERCIAL" }],
    });
    permiso.findUnique.mockResolvedValue({ modulo: { clave: "judicial" }, roles: [{ rolEmpresa: "JURIDICO" }] });
    const res = await request(app)
      .post("/procesos/p1/documentos/subir")
      .set(auth(token))
      .attach("file", Buffer.from("x"), "p.pdf");
    expect(res.status).toBe(403);
    expect(subir).not.toHaveBeenCalled();
  });
});
