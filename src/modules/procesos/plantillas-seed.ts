// Plantillas de documento iniciales (borradores editables) para los tipos
// constitucionales sembrados. Se autollenan con el motor de plantillas
// (renderPlantilla): {{datos.*}}, {{parte.<rol>.*}}, {{#each}}, {{#if}}, helpers
// (fecha, moneda…). Lo no resuelto queda como [[falta: <path>]] visible para que
// el abogado lo complete. Ver openspec/changes/derecho-peticion/ (Fase 4.2).

export type PlantillaSeed = { tipoNombre: string; nombre: string; contenido: string };

const PETICION = `{{fecha proceso.createdAt}}

Señores
{{mayus datos.entidad}}
{{#if datos.correo}}Correo electrónico: {{datos.correo}}
{{/if}}E.  S.  D.

REFERENCIA: Derecho de petición — {{datos.tipoPeticion}}

Respetados señores:

{{parte.peticionario.nombre}}, mayor de edad, identificado(a) con {{parte.peticionario.tipoDocumento}} No. {{parte.peticionario.numeroDocumento}}, actuando en nombre propio y en ejercicio del derecho fundamental de petición consagrado en el artículo 23 de la Constitución Política y desarrollado por la Ley 1755 de 2015, de manera respetuosa elevo ante ustedes la siguiente petición.

PETICIÓN
Solicito comedidamente a la entidad:
{{#each datos.queSolicita}}
{{@index}}. {{this}}{{/each}}
{{#if datos.detalle}}
HECHOS Y FUNDAMENTOS
{{datos.detalle}}
{{/if}}
FUNDAMENTOS DE DERECHO
La presente petición se sustenta en el artículo 23 de la Constitución Política, que consagra el derecho fundamental de petición, y en la Ley 1755 de 2015, que regula su ejercicio y los términos para resolver.

TÉRMINO PARA RESOLVER
De conformidad con el artículo 14 de la Ley 1755 de 2015, solicito que la respuesta se profiera dentro del término legal: quince (15) días hábiles como regla general; diez (10) días hábiles cuando se trate de peticiones de documentos e información; y treinta (30) días hábiles para consultas.

NOTIFICACIONES
{{#if datos.correo}}Recibiré la respuesta y las notificaciones en el correo electrónico: {{datos.correo}}.{{else}}Indicaré la dirección física o electrónica para recibir la respuesta.{{/if}}

Atentamente,



______________________________
{{parte.peticionario.nombre}}
{{parte.peticionario.tipoDocumento}} No. {{parte.peticionario.numeroDocumento}}`;

const REITERACION = `{{fecha proceso.createdAt}}

Señores
{{mayus datos.entidad}}
{{#if datos.correo}}Correo electrónico: {{datos.correo}}
{{/if}}E.  S.  D.

REFERENCIA: Reiteración de derecho de petición — Radicado {{datos.nroRadicado}}

Respetados señores:

{{parte.peticionario.nombre}}, mayor de edad, identificado(a) con {{parte.peticionario.tipoDocumento}} No. {{parte.peticionario.numeroDocumento}}, actuando en nombre propio, me permito REITERAR respetuosamente el derecho de petición radicado el {{fecha datos.fechaRadicacion}} bajo el No. {{datos.nroRadicado}}, por cuanto la respuesta recibida fue parcial, incompleta o no resolvió de fondo lo solicitado.

PETICIÓN
Reitero la solicitud de:
{{#each datos.queSolicita}}
{{@index}}. {{this}}{{/each}}
{{#if datos.queFalto}}
LO QUE FALTÓ POR RESOLVER
{{datos.queFalto}}
{{/if}}
FUNDAMENTOS DE DERECHO
El artículo 23 de la Constitución Política y la Ley 1755 de 2015 garantizan una respuesta de fondo, clara, precisa, congruente y oportuna. Una respuesta parcial o evasiva vulnera el núcleo esencial del derecho de petición (Corte Constitucional, sentencias T-206 de 2018 y T-001 de 2019, entre otras).

PETICIÓN DE FONDO
Solicito que, dentro del término legal, se profiera una respuesta completa y de fondo respecto de todo lo pedido.

NOTIFICACIONES
{{#if datos.correo}}Recibiré la respuesta y las notificaciones en el correo electrónico: {{datos.correo}}.{{else}}Indicaré la dirección física o electrónica para recibir la respuesta.{{/if}}

Atentamente,



______________________________
{{parte.peticionario.nombre}}
{{parte.peticionario.tipoDocumento}} No. {{parte.peticionario.numeroDocumento}}`;

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
