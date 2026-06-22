/**
 * SINCRONIZACIÓN MASIVA de actuaciones de la Rama Judicial (CPNU).
 *
 * Pensado para correr por CRON DEL SO (no hay scheduler dentro de la API). Recorre
 * todos los procesos abiertos con radicado, en lotes y con esperas/backoff
 * anti-bloqueo. Es de SOLO LECTURA contra la Rama (gratis) + escritura en NUESTRA BD
 * (inserta actuaciones nuevas). Idempotente: re-correrlo no duplica.
 *
 * Cron recomendado (2×/día, configurable por env ACTUALIZAR_PROCESOS_CRON):
 *   0 0,12 * * *   cd /ruta/lex-control-api && pnpm exec tsx scripts/sync-actuaciones.ts
 *
 * La corrida del mediodía recoge lo que el juzgado publica en horario laboral.
 */
import { prisma } from "../src/index";
import { sincronizarTodas } from "../src/modules/procesos/actuaciones.service";

async function main() {
  const inicio = process.hrtime.bigint();
  const r = await sincronizarTodas();
  const seg = (Number(process.hrtime.bigint() - inicio) / 1e9).toFixed(1);
  console.log(
    `\n✅ Sync masivo: ${r.procesos} procesos · ${r.conNovedad} con novedad · ${r.nuevasTotal} actuaciones nuevas · ${r.errores} errores · ${seg}s\n`,
  );
}

main()
  .catch((e) => {
    console.error("\n❌ Sync masivo falló:", e?.message ?? e, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
