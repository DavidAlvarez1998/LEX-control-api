// Contrato de paginación opcional y RETROCOMPATIBLE para listados. Si no llegan
// `page`/`pageSize`, los repositorios deben comportarse como hoy (sin take/skip),
// para no romper a los frontends que ya consumen las listas completas.
export type PageParams = { page: number; pageSize: number; skip: number; take: number };

export type Paginated<T> = { items: T[]; total: number; page: number; pageSize: number };

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Parsea `page`/`pageSize` del query. Devuelve null si NO vienen ambos (→ listado
 * completo, comportamiento actual). Si vienen, los normaliza/clampa.
 */
export function parsePage(query: Record<string, unknown>): PageParams | null {
  const rawPage = query.page;
  const rawSize = query.pageSize;
  if (rawPage === undefined && rawSize === undefined) return null;
  const page = Math.max(1, Number.parseInt(String(rawPage ?? "1"), 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(String(rawSize ?? DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
  );
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/** Envuelve resultados en el contrato { items, total, page, pageSize }. */
export function paginated<T>(items: T[], total: number, p: PageParams): Paginated<T> {
  return { items, total, page: p.page, pageSize: p.pageSize };
}
