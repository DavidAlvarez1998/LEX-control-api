/**
 * SMOKE de NOTIFICACIONES contra el proveedor REAL (API_NOTIFICAR).
 *
 * ⚠️⚠️ ESTE SCRIPT ENVÍA DE VERDAD Y CUESTA DINERO (correo SES / SMS Háblame /
 * llamada Go4). No se corre en CI ni en el gate. Solo se ejecuta a propósito,
 * con TU destino, y exige la bandera `--confirmar` para no dispararse por error.
 *
 * Requiere que la API alcance `env.notificaciones.baseUrl` (host interno
 * 10.10.10.211:5020 → normalmente vía VPN/red de Finova o NOTIFICAR_API_URL).
 *
 * Uso:
 *   tsx scripts/smoke-notificaciones.ts correo  tu@correo.com      --confirmar
 *   tsx scripts/smoke-notificaciones.ts sms      573XXXXXXXXX       --confirmar
 *   tsx scripts/smoke-notificaciones.ts llamada  3XXXXXXXXX         --confirmar
 */
import { enviarCorreo } from "../src/modules/notificaciones/correo.client";
import { enviarSms } from "../src/modules/notificaciones/sms.client";
import { consultarEstadoLlamada, llamar } from "../src/modules/notificaciones/llamadas.client";
import { env } from "../src/config/env";

const [canal, destino] = process.argv.slice(2);
const confirmado = process.argv.includes("--confirmar");

function abortar(msg: string): never {
  console.error(`\n❌ ${msg}\n`);
  console.error("Uso:");
  console.error("  tsx scripts/smoke-notificaciones.ts correo  tu@correo.com   --confirmar");
  console.error("  tsx scripts/smoke-notificaciones.ts sms      573XXXXXXXXX    --confirmar");
  console.error("  tsx scripts/smoke-notificaciones.ts llamada  3XXXXXXXXX      --confirmar\n");
  process.exit(1);
}

async function main() {
  if (!canal || !destino) abortar("Faltan argumentos (canal y destino).");
  if (!confirmado) abortar("Falta --confirmar. ESTE SMOKE ENVÍA DE VERDAD Y ES DE COBRO.");

  console.log(`\n⚠️  Envío REAL vía ${env.notificaciones.baseUrl} — canal=${canal} destino=${destino}\n`);

  if (canal === "correo") {
    const r = await enviarCorreo({
      to: destino,
      subject: "Prueba LEX Control",
      html: "<h2>Hola</h2><p>Smoke de correo desde LEX Control.</p>",
    });
    console.log("Resultado correo:", r);
  } else if (canal === "sms") {
    const r = await enviarSms({ toNumber: destino, content: "Prueba SMS desde LEX Control." });
    console.log("Resultado SMS:", r);
  } else if (canal === "llamada") {
    const disparo = await llamar({ telefono: destino, mensaje: "Hola, esta es una prueba de LEX Control." });
    console.log("Llamada disparada:", disparo);
    if (!disparo.ok || !disparo.campaignId) return;
    // Go4 tarda ~30–60 s; consultar hasta termino=true (máx 6 intentos de 20 s).
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 20_000));
      const estado = await consultarEstadoLlamada(disparo.campaignId);
      console.log(`  intento ${i + 1}:`, estado);
      if (estado.termino) break;
    }
  } else {
    abortar(`Canal desconocido: ${canal} (usa correo | sms | llamada).`);
  }
  console.log("\n✅ Smoke terminado.\n");
}

main().catch((e) => {
  console.error("\n❌ Smoke falló:", e?.message ?? e, "\n");
  process.exit(1);
});
