// Casos de uso de Mi Empresa (portal del cliente; admin de empresa gestiona su
// propio equipo). empresaId SIEMPRE del TenantContext (nunca del body/params) →
// imposible tocar otra empresa. Transacciones + puerta de cupos por rol. Sin Express.
import { randomBytes } from "crypto";
import { Prisma, RolEmpresa } from "@prisma/client";
import { HttpError } from "../../middleware/error";
import { prisma } from "../../shared/prisma";
import { empresaIdOrThrow, type TenantContext } from "../../shared/tenant";
import { generateActivationToken } from "../auth/auth.service";
import { enviarInvitacionCuenta } from "../notificaciones";
import { resolveEntitlements } from "../entitlements/entitlements.service";
import { assertSeatAvailable } from "../roles/roles.service";
import { ACTIVATION_TTL_MS, activationUrl } from "../usuarios/usuarios.shared";
import { MiEmpresaRepository } from "./mi-empresa.repository";
import { toCuposDTO } from "./mi-empresa.dto";
import type { CreateMiembroInput, UpdateMiembroInput } from "./mi-empresa.schemas";

/** La empresa del usuario logueado (con servicios solo si es admin de empresa). */
export async function getMiEmpresa(t: TenantContext) {
  const repo = new MiEmpresaRepository(t.empresaId ?? "");
  const usuario = await repo.findEmpresaOfUser(t.userId, t.esAdminEmpresa);
  if (!usuario?.empresa) throw new HttpError(404, "No tienes una empresa asociada");
  return usuario.empresa;
}

/** Equipo de la propia empresa (filas crudas; el router las pasa por el DTO). */
export function listEquipo(t: TenantContext) {
  return new MiEmpresaRepository(empresaIdOrThrow(t)).listTeam();
}

/** Cupos (cap/usados) por rol según el plan. */
export async function getCupos(t: TenantContext) {
  const empresaId = empresaIdOrThrow(t);
  const { cuotas } = await resolveEntitlements(empresaId);
  const usados = await new MiEmpresaRepository(empresaId).countSeatsByRole();
  return toCuposDTO(cuotas, usados);
}

export async function createMiembro(t: TenantContext, input: CreateMiembroInput) {
  const empresaId = empresaIdOrThrow(t);
  const { email, nombre, roles } = input;
  const { raw, hash } = generateActivationToken();
  const esAdminEmpresa = roles.includes(RolEmpresa.ADMINISTRADOR);

  try {
    const user = await prisma.$transaction(async (tx) => {
      const r = new MiEmpresaRepository(empresaId, tx);
      // Verifica el cupo de CADA rol antes de crear (todo-o-nada).
      for (const rolEmpresa of roles) await assertSeatAvailable(tx, empresaId, rolEmpresa);
      const u = await r.createMiembro({
        email,
        nombre,
        empresaId,
        rol: "USUARIO", // un admin de empresa nunca crea ADMIN de plataforma
        esAdminEmpresa,
        password: randomBytes(24).toString("hex"), // placeholder no usable hasta activar
        activationToken: hash,
        activationExpires: new Date(Date.now() + ACTIVATION_TTL_MS),
      });
      for (const rolEmpresa of roles) await r.createRolEmpresa(u.id, rolEmpresa, t.userId);
      return { ...u, roles };
    });
    // Correo de invitación fuera de la tx (best-effort): el link queda de respaldo.
    const url = activationUrl(raw, user.rol);
    const correoEnviado = await enviarInvitacionCuenta({
      to: user.email,
      nombre: user.nombre,
      activationUrl: url,
      contexto: "empresa",
    });
    return { user, activationUrl: url, correoEnviado };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "Ya existe un usuario con ese correo");
    }
    throw err;
  }
}

export async function updateMiembro(t: TenantContext, targetId: string, input: UpdateMiembroInput) {
  const empresaId = empresaIdOrThrow(t);
  const { activo, roles } = input;
  const esYoMismo = t.userId === targetId;

  // Guardas: un admin no puede quedarse sin acceso.
  if (activo === false && esYoMismo) throw new HttpError(400, "No puedes desactivar tu propia cuenta");
  if (roles && esYoMismo && !roles.includes(RolEmpresa.ADMINISTRADOR)) {
    throw new HttpError(400, "No puedes quitarte el rol Administrador");
  }

  // 1) activar/desactivar (desactivar revoca sesiones vivas).
  if (activo !== undefined) {
    const count = await new MiEmpresaRepository(empresaId).updateScoped(
      targetId,
      activo ? { activo: true } : { activo: false, tokenVersion: { increment: 1 } },
    );
    if (count === 0) throw new HttpError(404, "Usuario no encontrado");
  }

  // 2) reconciliar roles (añade faltantes con puerta de cupos, quita sobrantes).
  if (roles) {
    await prisma.$transaction(async (tx) => {
      const r = new MiEmpresaRepository(empresaId, tx);
      const target = await r.findMiembroScoped(targetId);
      if (!target) throw new HttpError(404, "Usuario no encontrado");

      const actuales = (await r.rolesActuales(targetId)).map((x) => x.rolEmpresa);
      const quitar = actuales.filter((x) => !roles.includes(x));
      const agregar = roles.filter((x) => !actuales.includes(x));

      if (quitar.length) await r.deleteRoles(targetId, quitar);
      for (const rolEmpresa of agregar) {
        await assertSeatAvailable(tx, empresaId, rolEmpresa);
        await r.createRolEmpresa(targetId, rolEmpresa, t.userId);
      }
      // ADMINISTRADOR ⇄ esAdminEmpresa (espejo).
      await r.setEsAdmin(targetId, roles.includes(RolEmpresa.ADMINISTRADOR));
    });
  }

  return { id: targetId, ...(activo !== undefined && { activo }), ...(roles && { roles }) };
}

export async function resendActivation(t: TenantContext, targetId: string) {
  const empresaId = empresaIdOrThrow(t);
  const { raw, hash } = generateActivationToken();
  const repo = new MiEmpresaRepository(empresaId);
  const count = await repo.updateScoped(targetId, {
    activationToken: hash,
    activationExpires: new Date(Date.now() + ACTIVATION_TTL_MS),
    tokenVersion: { increment: 1 },
  });
  if (count === 0) throw new HttpError(404, "Usuario no encontrado");
  // Los miembros del equipo son siempre USUARIO → link al portal del cliente.
  const url = activationUrl(raw, "USUARIO");
  const contacto = await repo.findMiembroContacto(targetId);
  const correoEnviado = contacto
    ? await enviarInvitacionCuenta({
        to: contacto.email,
        nombre: contacto.nombre,
        activationUrl: url,
        contexto: "empresa",
      })
    : false;
  return { activationUrl: url, correoEnviado };
}
