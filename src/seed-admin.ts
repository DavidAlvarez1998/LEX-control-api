import bcrypt from "bcryptjs";
import { prisma } from "./index";

/**
 * Crea (o actualiza) el primer usuario ADMIN de plataforma con la contraseña
 * hasheada. Idempotente: re-ejecutarlo actualiza la contraseña del mismo email.
 *
 * Uso (las variables no se guardan en el repo):
 *   ADMIN_EMAIL=admin@lex.com ADMIN_PASSWORD="una-clave-fuerte" pnpm seed:admin
 */
async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const nombre = process.env.ADMIN_NOMBRE ?? "Administrador";

  if (!email || !password) {
    console.error(
      "Faltan variables. ADMIN_EMAIL y ADMIN_PASSWORD son obligatorias.\n" +
        'Ej: ADMIN_EMAIL=admin@lex.com ADMIN_PASSWORD="..." pnpm seed:admin',
    );
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const admin = await prisma.usuario.upsert({
    where: { email },
    update: { password: hash, rol: "ADMIN", activo: true, nombre },
    create: { email, nombre, password: hash, rol: "ADMIN", activo: true },
  });

  console.log(`✔ ADMIN listo: ${admin.email} (${admin.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
