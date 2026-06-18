// Forma plana de un resultado de búsqueda (lista del topbar).
export type Resultado = {
  tipo: "cliente" | "proceso" | "factura" | "usuario" | "contrato" | "prospecto" | "empresa" | "plan";
  id: string;
  titulo: string;
  subtitulo: string | null;
};
