import "dotenv/config";
import { prisma } from "./index";

/**
 * Catálogo real de LEX Control (plataforma para bufetes de abogados).
 * Los precios se siembran en 0 (referencia); el monto real se acuerda por
 * empresa al asignar el servicio. `unidad` = qué se cuenta para el cobro por
 * unidad; null = servicio de costo fijo (solo se cobra por estar activo).
 */
const SERVICIOS = [
  {
    nombre: "Límite de usuarios",
    descripcion:
      "Usuarios incluidos en el plan. Cada usuario adicional tiene costo por usuario extra.",
    unidad: "usuario",
    incluidos: 0,
  },
  {
    nombre: "Mensajería de texto (SMS)",
    descripcion: "Envío de SMS. Costo base + costo por mensaje enviado.",
    unidad: "mensaje",
    incluidos: 0,
  },
  {
    nombre: "Correo electrónico",
    descripcion: "Envío de correos. Costo base + costo por envío/solicitud.",
    unidad: "envío",
    incluidos: 0,
  },
  {
    nombre: "IA legal – Lectura de documentos (Samai)",
    descripcion:
      "Análisis de documentos legales con IA. Costo base + costo por documento procesado.",
    unidad: "documento",
    incluidos: 0,
  },
  {
    nombre: "Plantilla de procesos",
    descripcion:
      "Plantillas de procesos legales reutilizables. Costo fijo: se cobra por servicio activo.",
    unidad: null,
    incluidos: 0,
  },
  {
    nombre: "Llamadas programadas",
    descripcion:
      "Llamadas programadas. Solo se cobran las llamadas contestadas.",
    unidad: "llamada contestada",
    incluidos: 0,
  },
];

// Servicios de prueba que se crearon durante el desarrollo y ya no van.
const A_BORRAR = ["Registro de Marca", "Asesoría Legal"];

async function main() {
  await prisma.servicio.deleteMany({ where: { nombre: { in: A_BORRAR } } });

  for (const s of SERVICIOS) {
    await prisma.servicio.upsert({
      where: { nombre: s.nombre },
      update: {
        descripcion: s.descripcion,
        unidad: s.unidad,
        incluidos: s.incluidos,
      },
      create: {
        nombre: s.nombre,
        descripcion: s.descripcion,
        unidad: s.unidad,
        incluidos: s.incluidos,
        precioBase: 0,
        precioPorUnidad: 0,
      },
    });
    console.log(`✔ ${s.nombre}`);
  }

  const total = await prisma.servicio.count();
  console.log(`\nServicios en catálogo: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
