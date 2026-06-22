/**
 * SMOKE de la API Rama Judicial (CPNU) usando NUESTRO cliente. Solo LECTURA y
 * GRATIS (API pública) → no exige --confirmar. Verifica el flujo radicado →
 * idProceso → actuaciones contra el servicio real.
 *
 * Uso:
 *   tsx scripts/smoke-rama-judicial.ts [radicado]
 *   (sin argumento usa el radicado de prueba del doc: 66001333300320140049500)
 */
import { env } from "../src/config/env";
import { consultarRadicado, obtenerActuaciones } from "../src/modules/rama-judicial";

const radicado = process.argv[2] ?? "66001333300320140049500";

async function main() {
  console.log(`\n🔎 Rama Judicial (${env.ramaJudicial.baseUrl}) — radicado ${radicado}\n`);

  const info = await consultarRadicado(radicado);
  console.log("A) Consulta radicado:", info);
  if (!info.encontrado || info.idProceso == null) {
    console.log("\n⚠️  Radicado no encontrado / no publicado. Fin.\n");
    return;
  }

  const acts = await obtenerActuaciones(info.idProceso);
  console.log(`\nB) Actuaciones: ${acts.length} en total. Primeras 5:\n`);
  for (const a of acts.slice(0, 5)) {
    console.log(`  ${(a.fechaActuacion ?? "").slice(0, 10)}  |  ${a.actuacion}`);
  }
  console.log("\n✅ Smoke terminado.\n");
}

main().catch((e) => {
  console.error("\n❌ Smoke falló:", e?.message ?? e, "\n");
  process.exit(1);
});
