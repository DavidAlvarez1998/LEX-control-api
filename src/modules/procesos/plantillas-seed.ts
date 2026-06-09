// Plantillas de documento iniciales (borradores editables) para los tipos
// constitucionales sembrados. Se autollenan con el motor de plantillas
// (renderPlantilla): {{datos.*}}, {{parte.<rol>.*}}, {{#each}}, {{#if}}, helpers
// (fecha, moneda…). Lo no resuelto queda como [[falta: <path>]] visible para que
// el abogado lo complete. Ver openspec/changes/derecho-peticion/ (Fase 4.2).

export type PlantillaSeed = { tipoNombre: string; nombre: string; contenido: string };

const PETICION = `Señores
{{datos.entidad}}
{{#if datos.correo}}Correo: {{datos.correo}}{{/if}}
E.  S.  D.

Referencia: Derecho de petición — {{datos.tipoPeticion}}

{{parte.accionante.nombre}}, identificado(a) con {{parte.accionante.tipoDocumento}} No. {{parte.accionante.numeroDocumento}}, en ejercicio del derecho fundamental de petición (artículo 23 de la Constitución Política y Ley 1755 de 2015), respetuosamente formulo la siguiente petición:

PETICIÓN
Solicito a la entidad:
{{#each datos.queSolicita}}
  - {{this}}
{{/each}}
{{#if datos.detalle}}
SUSTENTO
{{datos.detalle}}
{{/if}}
NOTIFICACIONES
{{#if datos.correo}}Recibiré respuesta en el correo electrónico: {{datos.correo}}.{{else}}Indicaré la dirección de notificación.{{/if}}

Atentamente,


{{parte.accionante.nombre}}
{{parte.accionante.tipoDocumento}} No. {{parte.accionante.numeroDocumento}}`;

const REITERACION = `Señores
{{datos.entidad}}
E.  S.  D.

Referencia: Reiteración de derecho de petición — Radicado {{datos.nroRadicado}}

{{parte.accionante.nombre}}, identificado(a) con {{parte.accionante.tipoDocumento}} No. {{parte.accionante.numeroDocumento}}, me permito REITERAR el derecho de petición radicado el {{fecha datos.fechaRadicacion}} bajo el No. {{datos.nroRadicado}}, por cuanto la respuesta recibida fue parcial o incompleta.

Reitero la solicitud de:
{{#each datos.queSolicita}}
  - {{this}}
{{/each}}
Solicito respetuosamente una respuesta de fondo, clara, precisa y congruente, dentro del término legal.

Atentamente,


{{parte.accionante.nombre}}
{{parte.accionante.tipoDocumento}} No. {{parte.accionante.numeroDocumento}}`;

const DEMANDA_TUTELA = `Señor
JUEZ (REPARTO)
E.  S.  D.

Referencia: ACCIÓN DE TUTELA
Accionante: {{parte.accionante.nombre}}
Accionado: {{datos.entidadAccionada}}

{{parte.accionante.nombre}}, identificado(a) con {{parte.accionante.tipoDocumento}} No. {{parte.accionante.numeroDocumento}}, promuevo ACCIÓN DE TUTELA (artículo 86 de la Constitución Política y Decreto 2591 de 1991) contra {{datos.entidadAccionada}}, por la vulneración de los siguientes derechos fundamentales:
{{#each datos.derechosFundamentales}}
  - {{this}}
{{/each}}
HECHOS
{{datos.hechos}}

PRETENSIONES
{{datos.pretension}}
{{#if datos.perjuicioIrremediable}}
Se solicita el amparo como mecanismo transitorio para evitar un perjuicio irremediable.
{{/if}}{{#if datos.medidaProvisional}}
Se solicita decretar MEDIDA PROVISIONAL para la protección inmediata de los derechos invocados.
{{/if}}
JURAMENTO
Manifiesto, bajo la gravedad del juramento, que no he presentado otra acción de tutela por los mismos hechos y derechos.

Atentamente,


{{parte.accionante.nombre}}
{{parte.accionante.tipoDocumento}} No. {{parte.accionante.numeroDocumento}}`;

export const PLANTILLAS_SEED: PlantillaSeed[] = [
  { tipoNombre: "Derecho de Petición", nombre: "Derecho de petición", contenido: PETICION },
  { tipoNombre: "Derecho de Petición", nombre: "Reiteración de la petición", contenido: REITERACION },
  { tipoNombre: "Acción de tutela", nombre: "Demanda de tutela", contenido: DEMANDA_TUTELA },
];
