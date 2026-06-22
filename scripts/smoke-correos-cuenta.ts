/**
 * SMOKE de los CORREOS DE CUENTA (invitación / restablecimiento) contra SES REAL.
 *
 * ⚠️⚠️ ENVÍA DE VERDAD Y CUESTA DINERO (Amazon SES vía API_NOTIFICAR). No corre en
 * CI ni en el gate. Exige `--confirmar`. Usa las MISMAS funciones que producción
 * (enviarInvitacionCuenta / enviarResetCuenta → plantillas reales).
 *
 * Cubre los 4 casos pedidos:
 *   1) crear usuario (admin de plataforma)        → invitación, contexto "admin"
 *   2) restablecer contraseña                      → reset
 *   3) crear usuario comercial                     → invitación, contexto "comercial"
 *   4) crear usuario desde una empresa             → invitación, contexto "empresa"
 *
 * El link lleva un token real generado al vuelo (para ver el enlace tal cual), pero
 * NO existe en la BD → es ilustrativo: valida ENTREGA + RENDER, no la activación.
 *
 * Uso:
 *   tsx scripts/smoke-correos-cuenta.ts adjuan123@gmail.com --confirmar
 */
import { env } from "../src/config/env";
import { generateActivationToken } from "../src/modules/auth/auth.service";
import { enviarInvitacionCuenta, enviarResetCuenta } from "../src/modules/notificaciones";
import { activationUrl } from "../src/modules/usuarios/usuarios.shared";

const destino = process.argv[2];
const confirmado = process.argv.includes("--confirmar");

function abortar(msg: string): never {
  console.error(`\n❌ ${msg}\n`);
  console.error("Uso:\n  tsx scripts/smoke-correos-cuenta.ts tu@correo.com --confirmar\n");
  process.exit(1);
}

// Link de activación con un token real (ilustrativo: no está en la BD).
const linkPara = (rol: "ADMIN" | "COMERCIAL" | "USUARIO") =>
  activationUrl(generateActivationToken().raw, rol);

async function main() {
  if (!destino) abortar("Falta el correo destino.");
  if (!confirmado) abortar("Falta --confirmar. ESTE SMOKE ENVÍA DE VERDAD Y ES DE COBRO.");

  console.log(`\n⚠️  Envío REAL vía ${env.notificaciones.baseUrl} — destino=${destino}\n`);

  const casos: Array<{ etiqueta: string; enviar: () => Promise<boolean> }> = [
    {
      etiqueta: "1) Crear usuario (admin de plataforma) — invitación",
      enviar: () =>
        enviarInvitacionCuenta({
          to: destino,
          nombre: "Admin de Prueba",
          activationUrl: linkPara("ADMIN"),
          contexto: "admin",
        }),
    },
    {
      etiqueta: "2) Restablecer contraseña",
      enviar: () =>
        enviarResetCuenta({
          to: destino,
          nombre: "Usuario de Prueba",
          activationUrl: linkPara("USUARIO"),
        }),
    },
    {
      etiqueta: "3) Crear usuario comercial — invitación",
      enviar: () =>
        enviarInvitacionCuenta({
          to: destino,
          nombre: "Comercial de Prueba",
          activationUrl: linkPara("COMERCIAL"),
          contexto: "comercial",
        }),
    },
    {
      etiqueta: "4) Crear usuario desde una empresa — invitación",
      enviar: () =>
        enviarInvitacionCuenta({
          to: destino,
          nombre: "Miembro de Empresa",
          activationUrl: linkPara("USUARIO"),
          contexto: "empresa",
        }),
    },
  ];

  for (const c of casos) {
    const enviado = await c.enviar();
    console.log(`${enviado ? "✅" : "❌"} ${c.etiqueta} → enviado=${enviado}`);
  }

  console.log("\n✅ Smoke terminado. Revisa la bandeja (y SPAM) de", destino, "\n");
}

main().catch((e) => {
  console.error("\n❌ Smoke falló:", e?.message ?? e, "\n");
  process.exit(1);
});
