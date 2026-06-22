// Plantillas HTML de los correos transaccionales de cuenta (invitación / reset).
// Funciones PURAS (sin red) → testeables. El proveedor (SES) ya envuelve este html
// en su plantilla con logo, así que el cuerpo es sobrio: saludo + propósito + botón +
// enlace en texto + nota de vigencia. Ver openspec change correos-cuenta-invitacion-reset.

/** A quién se invita: ajusta solo el copy del propósito. */
export type ContextoInvitacion = "admin" | "comercial" | "empresa";

type Plantilla = { subject: string; html: string };

const boton = (url: string, texto: string): string =>
  `<a href="${url}" style="display:inline-block;background:#1e293b;color:#ffffff;` +
  `text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${texto}</a>`;

function cuerpo(opts: { titulo: string; intro: string; botonTexto: string; url: string }): string {
  const { titulo, intro, botonTexto, url } = opts;
  return [
    `<h2 style="margin:0 0 12px">${titulo}</h2>`,
    `<p style="margin:0 0 16px;line-height:1.5">${intro}</p>`,
    `<p style="margin:0 0 16px">${boton(url, botonTexto)}</p>`,
    `<p style="margin:0 0 4px;font-size:13px;color:#475569">Si el botón no funciona, copia y pega este enlace:</p>`,
    `<p style="margin:0 0 16px;font-size:13px;word-break:break-all"><a href="${url}">${url}</a></p>`,
    `<p style="margin:0 0 4px;font-size:13px;color:#475569">El enlace es de un solo uso y vence en 48 horas.</p>`,
    `<p style="margin:0;font-size:13px;color:#475569">Si no esperabas este correo, puedes ignorarlo.</p>`,
  ].join("\n");
}

const intro: Record<ContextoInvitacion, string> = {
  admin: "Te crearon una cuenta de administrador en LEX Control. Actívala y define tu contraseña para entrar.",
  comercial: "Te crearon una cuenta de comercial en LEX Control. Actívala y define tu contraseña para entrar.",
  empresa: "Te invitaron a unirte a tu equipo en LEX Control. Activa tu cuenta y define tu contraseña para entrar.",
};

/** Correo de invitación al crear un usuario (plataforma o equipo de empresa). */
export function plantillaInvitacion(p: {
  nombre: string;
  activationUrl: string;
  contexto: ContextoInvitacion;
}): Plantilla {
  return {
    subject: "Activa tu cuenta de LEX Control",
    html: cuerpo({
      titulo: `Hola, ${p.nombre}`,
      intro: intro[p.contexto],
      botonTexto: "Activar mi cuenta",
      url: p.activationUrl,
    }),
  };
}

/** Correo de restablecimiento de contraseña (lo dispara un admin). */
export function plantillaReset(p: { nombre: string; activationUrl: string }): Plantilla {
  return {
    subject: "Restablece tu contraseña de LEX Control",
    html: cuerpo({
      titulo: `Hola, ${p.nombre}`,
      intro:
        "Se solicitó restablecer tu contraseña de LEX Control. Define una nueva con el siguiente enlace.",
      botonTexto: "Definir nueva contraseña",
      url: p.activationUrl,
    }),
  };
}
