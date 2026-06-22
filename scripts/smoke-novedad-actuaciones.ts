/**
 * SMOKE del correo de NOVEDADES de actuaciones (#2) contra SES REAL.
 * ⚠️ ENVÍA DE VERDAD (de cobro). Exige --confirmar. Usa la misma función que el cron.
 *
 *   tsx scripts/smoke-novedad-actuaciones.ts adjuan123@gmail.com --confirmar
 */
import { enviarNovedadActuaciones } from "../src/modules/notificaciones";

const destino = process.argv[2];
const confirmado = process.argv.includes("--confirmar");

async function main() {
  if (!destino || !confirmado) {
    console.error("\nUso: tsx scripts/smoke-novedad-actuaciones.ts tu@correo.com --confirmar\n");
    process.exit(1);
  }
  const enviado = await enviarNovedadActuaciones({
    to: destino,
    nombre: "Abogado de Prueba",
    procesoTitulo: "Proceso ejecutivo de mínima cuantía — Prueba",
    radicado: "66001333300320140049500",
    nuevas: 2,
    ultima: "RECIBE MEMORIALES ONLINE",
  });
  console.log(`\n${enviado ? "✅" : "❌"} Novedad → enviado=${enviado} a ${destino}\n`);
}

main().catch((e) => {
  console.error("\n❌ Smoke falló:", e?.message ?? e, "\n");
  process.exit(1);
});
