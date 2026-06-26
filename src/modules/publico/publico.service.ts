// Casos de uso públicos (landing del portal cliente). Sin auth/tenant.
import { randomBytes } from "crypto";
import { RolEmpresa } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "../../shared/prisma";
import { HttpError } from "../../middleware/error";
import { env } from "../../config/env";
import { generateActivationToken } from "../auth/auth.service";
import { enviarInvitacionCuenta } from "../notificaciones";
import { ACTIVATION_TTL_MS, activationUrl } from "../usuarios/usuarios.shared";
import { PublicoRepository } from "./publico.repository";
import { toPlanPublico } from "./publico.dto";
import type { contactoSchema, solicitudCuentaSchema } from "./publico.schemas";

type SolicitudInput = z.infer<typeof solicitudCuentaSchema>;
type ContactoInput = z.infer<typeof contactoSchema>;

export async function listPlanes() {
  return (await new PublicoRepository().listPlanesActivos()).map(toPlanPublico);
}

/**
 * Alta AUTOSERVICIO desde la landing ("Crea tu cuenta"): aprovisiona el tenant completo
 * en una transacción —Empresa (activo) + Suscripción al plan trial + Usuario administrador
 * (PENDIENTE de activar, rol ADMINISTRADOR) + Prospecto GANADO (rastro de funnel, sin
 * comercial/comisión)— y dispara el correo de activación (best-effort, fuera de la tx).
 *
 * Honeypot `website` → no-op silencioso (200). Email o NIT ya existentes → 409 con mensaje
 * claro. El plan lo decide el servidor (trial); si la clave no resuelve, el alta NO se
 * bloquea: se crea sin suscripción y se loggea. Ver openspec/changes/cuenta-autoservicio-empresa.
 */
export async function solicitarCuenta(b: SolicitudInput): Promise<{ creado: boolean }> {
  if (b.website && b.website.trim() !== "") return { creado: false };
  const repo = new PublicoRepository();

  // Pre-chequeo de duplicados → 409 amable (el @unique de email/rfc es el seguro real).
  if (await repo.findUsuarioByEmail(b.email)) {
    throw new HttpError(409, "Ya existe una cuenta con ese correo");
  }
  if (await repo.findEmpresaByRfc(b.nit)) {
    throw new HttpError(409, "Ya existe una empresa con ese NIT/CC");
  }

  // Plan trial (oculto del catálogo): clave server-side. Degrada a "sin suscripción".
  const plan = await repo.findPlanByClave(env.selfSignupPlanClave);
  if (!plan) {
    console.warn(`[publico] plan autoservicio "${env.selfSignupPlanClave}" no encontrado: empresa sin suscripción`);
  }

  const { raw, hash } = generateActivationToken();

  const { user } = await prisma.$transaction(async (tx) => {
    const r = new PublicoRepository(tx);
    const empresa = await r.createEmpresa({
      nombre: b.nombreEmpresa,
      rfc: b.nit,
      email: b.email,
      activo: true,
    });
    if (plan) await r.createSuscripcion(empresa.id, plan.id);

    // Usuario admin de la empresa: PENDIENTE (password placeholder no usable + token de
    // activación 48 h), igual que el alta de usuarios del admin. No fija `activo` (default
    // true → estado PENDIENTE): no puede entrar hasta poner contraseña vía /activar.
    const u = await r.createUsuario({
      email: b.email,
      nombre: b.nombreContacto,
      empresaId: empresa.id,
      rol: "USUARIO",
      esAdminEmpresa: true,
      telefono: b.telefono,
      tarjetaProfesional: b.tarjeta?.trim() || null,
      password: randomBytes(24).toString("hex"),
      activationToken: hash,
      activationExpires: new Date(Date.now() + ACTIVATION_TTL_MS),
    });
    await r.createRolEmpresa(u.id, RolEmpresa.ADMINISTRADOR, empresa.id);

    // Rastro en el funnel: Prospecto GANADO ligado a la empresa, canal WEB, sin comercial
    // (sin comisión). No exige contacto; solo deja la métrica del alta web.
    await r.createProspecto({
      nombreEmpresa: b.nombreEmpresa,
      nombreContacto: b.nombreContacto,
      email: b.email,
      telefono: b.telefono,
      numeroDocumento: b.nit,
      canalEntrada: "WEB",
      estado: "GANADO",
      empresaId: empresa.id,
      planVendidoId: plan?.id ?? null,
      fechaCierre: new Date(),
      notas: "Alta autoservicio web.",
    });

    return { user: u };
  });

  // Correo de activación FUERA de la tx (best-effort): si SES falla, la cuenta ya quedó
  // firme y un admin puede reenviar el link (resetPassword). Nunca lanza.
  await enviarInvitacionCuenta({
    to: user.email,
    nombre: user.nombre,
    activationUrl: activationUrl(raw, user.rol),
    contexto: "empresa",
  });

  return { creado: true };
}

/**
 * Contacto desde la landing ("Habla con un asesor"): crea un Prospecto
 * (canalEntrada=WEB) SIN comercial asignado (comercialId queda null → bandeja de no
 * asignados) y con el mensaje del visitante en `notas`. Honeypot `website` → no-op.
 * `nombreEmpresa` cae al nombre del contacto cuando no se da (el modelo lo exige).
 */
export async function contactar(b: ContactoInput): Promise<{ creado: boolean }> {
  if (b.website && b.website.trim() !== "") return { creado: false };
  const repo = new PublicoRepository();
  const notas = [
    "Contacto desde landing.",
    b.mensaje?.trim() ? `Mensaje: ${b.mensaje.trim()}` : null,
  ].filter(Boolean).join(" · ");
  await repo.createProspecto({
    nombreEmpresa: b.nombreEmpresa?.trim() || b.nombreContacto,
    nombreContacto: b.nombreContacto,
    email: b.email?.trim() || null,
    telefono: b.telefono?.trim() || null,
    canalEntrada: "WEB", // comercialId omitido → null (sin asignar); estado → NUEVO
    notas,
  });
  return { creado: true };
}
