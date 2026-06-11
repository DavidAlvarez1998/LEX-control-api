/** Smoke e2e: editar el DdP vía API (el mismo PATCH que manda el form admin
 *  arreglado) y verificar que NO se rompen keys ni reglas avanzadas. */
import request from "supertest";
import { prisma } from "../src/index";
import { createApp } from "../src/app";
import { signToken } from "../src/modules/auth/auth.service";

const app = createApp();
function toKey(label: string, used: Set<string>): string {
  let base = label.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9 ]/g, "").trim()
    .split(/\s+/).map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join("");
  if (!base) base = "campo"; let key = base, n = 2; while (used.has(key)) key = base + n++; used.add(key); return key;
}

async function main() {
  const admin = await prisma.usuario.findFirstOrThrow({ where: { rol: "ADMIN", activo: true, activationToken: null }, select: { id: true, tokenVersion: true } });
  const token = signToken({ sub: admin.id, rol: "ADMIN", tv: admin.tokenVersion });
  const auth = { Authorization: `Bearer ${token}` };

  const t0 = await prisma.tipoProceso.findFirstOrThrow({
    where: { empresaId: null, nombre: { contains: "etici" } },
    include: { areas: { include: { area: true } } },
  });
  const esquema = t0.esquemaFormulario as any[];
  const etapasOrig = t0.etapas as any[];
  const areaSlugs = t0.areas.map((a) => a.area.slug);

  // --- transform idéntico al form arreglado (editar sin cambios del usuario) ---
  const camposRows = esquema.map((c) => ({ key: c.key, label: c.label, tipo: c.tipo, requerido: c.requerido, opciones: (c.opciones ?? []).join(", ") }));
  const keyToLabel = new Map(esquema.map((c) => [c.key, c.label]));
  const etapasRows = etapasOrig.slice().sort((a, b) => a.orden - b.orden).map((e) => ({
    key: e.key, nombre: e.nombre, terminal: !!e.terminal,
    plazoDias: e.reglas?.plazoDias ? String(e.reglas.plazoDias) : "",
    camposRequeridos: (e.reglas?.camposRequeridos ?? []).map((k: string) => keyToLabel.get(k)).filter(Boolean),
  }));
  const origCampos: Record<string, any> = Object.fromEntries(esquema.map((c) => [c.key, c]));
  const origEtapas: Record<string, any> = Object.fromEntries(etapasOrig.map((e) => [e.key, e]));
  const used = new Set<string>();
  for (const c of camposRows) if (c.key) used.add(c.key);
  for (const e of etapasRows) if (e.key) used.add(e.key);
  const labelToKey = new Map<string, string>();
  const esquemaFormulario = camposRows.map((c) => {
    const orig = c.key ? origCampos[c.key] : undefined;
    const key = c.key || toKey(c.label.trim(), used);
    labelToKey.set(c.label.trim(), key);
    const campo: any = { ...(orig ?? {}), key, label: c.label.trim(), tipo: c.tipo, requerido: c.requerido };
    if (c.tipo === "select" || c.tipo === "multiselect") campo.opciones = c.opciones.split(",").map((o: string) => o.trim()).filter(Boolean);
    else delete campo.opciones;
    return campo;
  });
  const etapas = etapasRows.map((e, i) => {
    const orig = e.key ? origEtapas[e.key] : undefined;
    const key = e.key || toKey(e.nombre.trim(), used);
    const cr = e.camposRequeridos.map((l: string) => labelToKey.get(l.trim())).filter(Boolean);
    const reglas: any = { ...((orig?.reglas) ?? {}) };
    if (cr.length) reglas.camposRequeridos = cr; else delete reglas.camposRequeridos;
    if (e.plazoDias.trim()) reglas.plazoDias = Number(e.plazoDias); else delete reglas.plazoDias;
    const et: any = { ...(orig ?? {}), key, nombre: e.nombre.trim(), orden: i + 1 };
    if (e.terminal) et.terminal = true; else delete et.terminal;
    if (Object.keys(reglas).length) et.reglas = reglas; else delete et.reglas;
    return et;
  });
  const payload = { nombre: t0.nombre, descripcion: t0.descripcion ?? undefined, jurisdiccion: t0.jurisdiccion, areaSlugs, esquemaFormulario, etapas };

  // --- PATCH (la operación bajo prueba) ---
  const res = await request(app).patch(`/catalogo/tipos-proceso/${t0.id}`).set(auth).send(payload);
  console.log("\n  PATCH /catalogo/tipos-proceso/:id →", res.status);

  // --- verificar en BD ---
  const t1 = await prisma.tipoProceso.findUniqueOrThrow({ where: { id: t0.id } });
  const c1 = t1.esquemaFormulario as any[];
  const e1 = t1.etapas as any[];
  const rad = e1.find((e) => e.key === "radicada");
  const fail: string[] = [];
  if (res.status !== 200) fail.push(`PATCH status ${res.status}: ${JSON.stringify(res.body?.error ?? res.body)}`);
  if (c1.map((c) => c.key).join() !== esquema.map((c) => c.key).join()) fail.push("keys de campos cambiaron");
  if (e1.map((e) => e.key).sort().join() !== etapasOrig.map((e) => e.key).sort().join()) fail.push("keys de etapas cambiaron");
  if (!rad?.reglas?.documentosRequeridos?.includes("peticion.pdf")) fail.push("perdió peticion.pdf");
  if (!rad?.reglas?.requeridosSi?.some((r: any) => r.documentosRequeridos?.includes("poder.pdf"))) fail.push("perdió poder.pdf");
  if (!e1.find((e) => e.key === "escala_tutela")?.accion) fail.push("perdió accion crearDerivado");
  if (!e1.find((e) => e.key === "respondida")?.disponibleSi) fail.push("perdió disponibleSi");
  if (!c1.find((c) => c.key === "tipoPeticion")?.ayuda) fail.push("perdió ayuda");
  if (t1.esquemaVersion !== t0.esquemaVersion + 1) fail.push(`esquemaVersion no subió (${t0.esquemaVersion}→${t1.esquemaVersion})`);

  console.log(fail.length ? "  ❌ " + fail.join("\n  ❌ ") : "  ✅ Editar+guardar el DdP NO rompió nada (keys + peticion/poder/accion/disponibleSi/ayuda intactos)");
  console.log(`  esquemaVersion: ${t0.esquemaVersion} → ${t1.esquemaVersion} · campos: ${c1.map((c) => c.key).join(", ")}`);
  await prisma.$disconnect();
  process.exit(fail.length ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
