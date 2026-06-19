// Métricas Prometheus (prom-client). Expuestas en GET /metrics. Sin dependencia de
// servicios externos: un scraper (Prometheus/Grafana/Datadog) las consume cuando exista.
// Las métricas por defecto del proceso (CPU, memoria, event-loop, GC) se registran solo
// fuera de test para no dejar timers abiertos en la suite.
import client from "prom-client";

export const registry = new client.Registry();

if (process.env.NODE_ENV !== "test") {
  client.collectDefaultMetrics({ register: registry });
}

/** Duración de las peticiones HTTP por método, ruta (bucket grueso) y status. */
export const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duración de las peticiones HTTP en segundos",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [registry],
});

/** Total de peticiones HTTP (mismas etiquetas). */
export const httpTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total de peticiones HTTP atendidas",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

/** Registra una petición terminada. `route` debe ser de baja cardinalidad. */
export function registrarHttp(method: string, route: string, status: number, durationMs: number): void {
  const labels = { method, route, status: String(status) };
  httpDuration.observe(labels, durationMs / 1000);
  httpTotal.inc(labels);
}
