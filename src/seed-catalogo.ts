import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Jurisdiccion, Prisma, TipoAreaPractica } from "@prisma/client";
import { prisma } from "./index";
import { PLANTILLAS_SEED } from "./modules/procesos/plantillas-seed";

// Áreas de práctica reconocidas por el Estado colombiano (Ley 270/1996,
// Acuerdo 201/1997). Las inactivas quedan en catálogo pero ocultas en el picker.
const AREAS: {
  slug: string;
  nombre: string;
  tipo: TipoAreaPractica;
  jurisdiccion: Jurisdiccion;
  activo: boolean;
  orden: number;
}[] = [
  { slug: "civil", nombre: "Civil", tipo: "JURISDICCION", jurisdiccion: "ORDINARIA_CIVIL", activo: true, orden: 1 },
  { slug: "comercial-societario", nombre: "Comercial y Societario", tipo: "PRACTICA", jurisdiccion: "ORDINARIA_CIVIL", activo: true, orden: 2 },
  { slug: "laboral", nombre: "Laboral y Seguridad Social", tipo: "JURISDICCION", jurisdiccion: "ORDINARIA_LABORAL", activo: true, orden: 3 },
  { slug: "penal", nombre: "Penal", tipo: "JURISDICCION", jurisdiccion: "PENAL", activo: true, orden: 4 },
  { slug: "familia", nombre: "Familia", tipo: "JURISDICCION", jurisdiccion: "FAMILIA", activo: true, orden: 5 },
  { slug: "administrativo", nombre: "Administrativo", tipo: "JURISDICCION", jurisdiccion: "CONTENCIOSO_ADMIN", activo: true, orden: 6 },
  { slug: "constitucional", nombre: "Constitucional", tipo: "JURISDICCION", jurisdiccion: "CONSTITUCIONAL", activo: true, orden: 7 },
  { slug: "tributario-aduanero", nombre: "Tributario y Aduanero", tipo: "PRACTICA", jurisdiccion: "CONTENCIOSO_ADMIN", activo: true, orden: 8 },
  { slug: "restitucion-tierras", nombre: "Restitución de Tierras", tipo: "ESPECIALIDAD", jurisdiccion: "CONTENCIOSO_ADMIN", activo: true, orden: 9 },
  { slug: "disciplinario", nombre: "Disciplinario", tipo: "JURISDICCION", jurisdiccion: "CONTENCIOSO_ADMIN", activo: true, orden: 10 },
  // Presentes pero inactivas (se activan cuando se demanden).
  { slug: "agrario-rural", nombre: "Agrario y Rural", tipo: "ESPECIALIDAD", jurisdiccion: "ORDINARIA_CIVIL", activo: false, orden: 20 },
  { slug: "insolvencia", nombre: "Insolvencia / Reorganización", tipo: "PRACTICA", jurisdiccion: "ORDINARIA_CIVIL", activo: false, orden: 21 },
  { slug: "propiedad-intelectual", nombre: "Propiedad Intelectual", tipo: "PRACTICA", jurisdiccion: "ORDINARIA_CIVIL", activo: false, orden: 22 },
  { slug: "ambiental", nombre: "Ambiental", tipo: "PRACTICA", jurisdiccion: "CONTENCIOSO_ADMIN", activo: false, orden: 23 },
  { slug: "electoral", nombre: "Electoral", tipo: "PRACTICA", jurisdiccion: "CONTENCIOSO_ADMIN", activo: false, orden: 24 },
  { slug: "migratorio", nombre: "Migratorio y Extranjería", tipo: "PRACTICA", jurisdiccion: "CONTENCIOSO_ADMIN", activo: false, orden: 25 },
];

// Tipos de proceso GLOBALES, generados con asistencia de IA y con base legal
// colombiana (CGP, CPACA, CPTSS, Ley 906, acciones constitucionales). PENDIENTE
// de revisión por un abogado. Viven en prisma/seed-tipos.json.
type TipoSeed = {
  nombre: string;
  descripcion: string;
  jurisdiccion: Jurisdiccion;
  esJudicial?: boolean; // default true; false = trámite ante entidad (DdP)
  areaSlugs: string[];
  esquemaFormulario: Prisma.InputJsonValue;
  etapas: Prisma.InputJsonValue;
};

const TIPOS: TipoSeed[] = JSON.parse(
  readFileSync(join(__dirname, "../prisma/seed-tipos.json"), "utf-8"),
);

async function main() {
  for (const a of AREAS) {
    await prisma.areaPractica.upsert({
      where: { slug: a.slug },
      update: { nombre: a.nombre, tipo: a.tipo, jurisdiccion: a.jurisdiccion, activo: a.activo, orden: a.orden },
      create: a,
    });
  }
  console.log(`✔ ${AREAS.length} áreas de práctica`);

  let creados = 0;
  let actualizados = 0;
  for (const t of TIPOS) {
    const areas = await prisma.areaPractica.findMany({ where: { slug: { in: t.areaSlugs } } });
    if (areas.length !== t.areaSlugs.length) {
      console.warn(`⚠ ${t.nombre}: área(s) no encontrada(s) — se omite`);
      continue;
    }
    const existe = await prisma.tipoProceso.findUnique({
      where: { empresaKey_nombre: { empresaKey: "", nombre: t.nombre } },
      select: { id: true },
    });

    if (existe) {
      // Reemplaza las etiquetas de área y refresca el contenido (sube versión).
      await prisma.$transaction([
        prisma.tipoProcesoArea.deleteMany({ where: { tipoProcesoId: existe.id } }),
        prisma.tipoProceso.update({
          where: { id: existe.id },
          data: {
            descripcion: t.descripcion,
            jurisdiccion: t.jurisdiccion,
            esJudicial: t.esJudicial ?? true,
            esquemaFormulario: t.esquemaFormulario,
            etapas: t.etapas,
            esquemaVersion: { increment: 1 },
            areas: { create: areas.map((a) => ({ areaId: a.id })) },
          },
        }),
      ]);
      actualizados++;
    } else {
      await prisma.tipoProceso.create({
        data: {
          nombre: t.nombre,
          descripcion: t.descripcion,
          jurisdiccion: t.jurisdiccion,
          esJudicial: t.esJudicial ?? true,
          esquemaFormulario: t.esquemaFormulario,
          etapas: t.etapas,
          empresaId: null,
          empresaKey: "",
          areas: { create: areas.map((a) => ({ areaId: a.id })) },
        },
      });
      creados++;
    }
  }

  console.log(`✔ Tipos: ${creados} creados, ${actualizados} actualizados`);

  // Plantillas de documento iniciales (idempotentes por tipo + nombre, ya que
  // PlantillaDocumento no tiene unique compuesto).
  let plCreadas = 0;
  let plActualizadas = 0;
  for (const p of PLANTILLAS_SEED) {
    const tipo = await prisma.tipoProceso.findUnique({
      where: { empresaKey_nombre: { empresaKey: "", nombre: p.tipoNombre } },
      select: { id: true },
    });
    if (!tipo) {
      console.warn(`⚠ Plantilla "${p.nombre}": tipo "${p.tipoNombre}" no existe — se omite`);
      continue;
    }
    const existe = await prisma.plantillaDocumento.findFirst({
      where: { tipoProcesoId: tipo.id, nombre: p.nombre },
      select: { id: true },
    });
    if (existe) {
      await prisma.plantillaDocumento.update({ where: { id: existe.id }, data: { contenido: p.contenido } });
      plActualizadas++;
    } else {
      await prisma.plantillaDocumento.create({
        data: { tipoProcesoId: tipo.id, nombre: p.nombre, contenido: p.contenido },
      });
      plCreadas++;
    }
  }
  console.log(`✔ Plantillas: ${plCreadas} creadas, ${plActualizadas} actualizadas`);

  console.log(
    `\nÁreas: ${await prisma.areaPractica.count()} · Tipos globales: ${await prisma.tipoProceso.count({ where: { empresaId: null } })}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
