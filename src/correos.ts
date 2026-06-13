// Utilidades de la lista de correos de un contacto (Cliente / Litigante). El
// modelo guarda `correos` (string[]) y conserva `email` como espejo del principal
// (correos[0]) por compatibilidad con el código que aún lee `email` (búsqueda,
// plantillas {{parte.peticionario.email}}, conversión a litigante).

/**
 * Normaliza una lista de correos: recorta, descarta vacíos y duplicados
 * (case-insensitive), conservando el orden. El primero es el principal.
 */
export function normalizarCorreos(correos: unknown): string[] {
  if (!Array.isArray(correos)) return [];
  const out: string[] = [];
  const vistos = new Set<string>();
  for (const c of correos) {
    const v = String(c ?? "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(v);
  }
  return out;
}

/**
 * Combina `email` + `correos` en un par consistente: `correos` (lista normalizada)
 * y `email` (su primer elemento). Si no vienen correos pero sí un `email` suelto
 * (compat / API antigua), la lista se inicializa con ese email.
 */
export function fusionarCorreos(input: {
  email?: string | null;
  correos?: unknown;
}): { correos: string[]; email: string | null } {
  let correos = normalizarCorreos(input.correos);
  if (correos.length === 0 && input.email) {
    const e = input.email.trim();
    if (e) correos = [e];
  }
  return { correos, email: correos[0] ?? null };
}
