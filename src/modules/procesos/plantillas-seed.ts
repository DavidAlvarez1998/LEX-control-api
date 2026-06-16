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

REFERENCIA: Reiteración de derecho de petición — Radicado {{casoBase.datos.nroRadicado}}

Respetados señores:

{{parte.peticionario.nombre}}, mayor de edad, identificado(a) con {{parte.peticionario.tipoDocumento}} No. {{parte.peticionario.numeroDocumento}}, actuando en nombre propio, me permito REITERAR respetuosamente el derecho de petición radicado el {{fecha casoBase.datos.fechaRadicacion}} bajo el No. {{casoBase.datos.nroRadicado}}, por cuanto la respuesta recibida fue parcial, incompleta o no resolvió de fondo lo solicitado.

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

const RECLAMACION = `{{fecha proceso.createdAt}}

Señores
{{mayus datos.entidad}}
{{#if datos.correo}}Correo electrónico: {{datos.correo}}
{{/if}}E.  S.  D.

REFERENCIA: Reclamación administrativa — {{datos.tipoPeticion}}

Respetados señores:

{{parte.peticionario.nombre}}, mayor de edad, identificado(a) con {{parte.peticionario.tipoDocumento}} No. {{parte.peticionario.numeroDocumento}}, actuando en nombre propio, de manera respetuosa presento ante ustedes la siguiente RECLAMACIÓN ADMINISTRATIVA.

OBJETO DE LA RECLAMACIÓN
Solicito comedidamente a la entidad:
{{#each datos.queSolicita}}
{{@index}}. {{this}}{{/each}}
{{#if datos.detalle}}
HECHOS Y FUNDAMENTOS
{{datos.detalle}}
{{/if}}
FUNDAMENTOS DE DERECHO
La presente reclamación se formula en ejercicio del derecho fundamental de petición (artículo 23 de la Constitución Política y Ley 1755 de 2015) y, según corresponda, como reclamación administrativa previa para agotar la actuación ante la entidad.

TÉRMINO PARA RESOLVER
Solicito que la respuesta se profiera dentro del término legal aplicable.

NOTIFICACIONES
{{#if datos.correo}}Recibiré la respuesta y las notificaciones en el correo electrónico: {{datos.correo}}.{{else}}Indicaré la dirección física o electrónica para recibir la respuesta.{{/if}}

Atentamente,



______________________________
{{parte.peticionario.nombre}}
{{parte.peticionario.tipoDocumento}} No. {{parte.peticionario.numeroDocumento}}`;

const REITERACION_RECLAMACION = `{{fecha proceso.createdAt}}

Señores
{{mayus datos.entidad}}
{{#if datos.correo}}Correo electrónico: {{datos.correo}}
{{/if}}E.  S.  D.

REFERENCIA: Reiteración de reclamación administrativa — Radicado {{casoBase.datos.nroRadicado}}

Respetados señores:

{{parte.peticionario.nombre}}, mayor de edad, identificado(a) con {{parte.peticionario.tipoDocumento}} No. {{parte.peticionario.numeroDocumento}}, actuando en nombre propio, me permito REITERAR respetuosamente la reclamación administrativa radicada el {{fecha casoBase.datos.fechaRadicacion}} bajo el No. {{casoBase.datos.nroRadicado}}, por cuanto la respuesta recibida fue parcial, incompleta o no resolvió de fondo lo solicitado.

OBJETO DE LA RECLAMACIÓN
Reitero la solicitud de:
{{#each datos.queSolicita}}
{{@index}}. {{this}}{{/each}}
{{#if casoBase.datos.queFalto}}
LO QUE FALTÓ POR RESOLVER
{{casoBase.datos.queFalto}}
{{/if}}
FUNDAMENTOS DE DERECHO
El artículo 23 de la Constitución Política y la Ley 1755 de 2015 garantizan una respuesta de fondo, clara, precisa, congruente y oportuna. Una respuesta parcial o evasiva vulnera el núcleo esencial del derecho de petición.

PETICIÓN DE FONDO
Solicito que, dentro del término legal, se profiera una respuesta completa y de fondo respecto de todo lo reclamado.

NOTIFICACIONES
{{#if datos.correo}}Recibiré la respuesta y las notificaciones en el correo electrónico: {{datos.correo}}.{{else}}Indicaré la dirección física o electrónica para recibir la respuesta.{{/if}}

Atentamente,



______________________________
{{parte.peticionario.nombre}}
{{parte.peticionario.tipoDocumento}} No. {{parte.peticionario.numeroDocumento}}`;

const RENUENCIA = `{{fecha proceso.createdAt}}

Señores
{{mayus datos.entidad}}
{{#if datos.correo}}Correo electrónico: {{datos.correo}}
{{/if}}E.  S.  D.

REFERENCIA: Constitución de renuencia — Ley 393 de 1997

Respetados señores:

{{parte.peticionario.nombre}}, mayor de edad, identificado(a) con {{parte.peticionario.tipoDocumento}} No. {{parte.peticionario.numeroDocumento}}, actuando en nombre propio y con fundamento en el artículo 8 de la Ley 393 de 1997, me permito requerir a esa autoridad el cumplimiento del deber legal o acto administrativo que a continuación se señala, con el fin de constituir la renuencia como requisito de procedibilidad de la acción de cumplimiento (artículo 87 de la Constitución Política).

DEBER LEGAL O ACTO CUYO CUMPLIMIENTO SE EXIGE
{{datos.solicitud}}

FUNDAMENTOS DE DERECHO
El artículo 87 de la Constitución Política y la Ley 393 de 1997 facultan a toda persona para hacer efectivo el cumplimiento de normas con fuerza material de ley o de actos administrativos. Conforme al artículo 8 de la misma ley, con el presente requerimiento se procura constituir la renuencia de la autoridad.

REQUERIMIENTO
Solicito que, dentro de los quince (15) días hábiles siguientes a la presentación de este escrito, la autoridad cumpla el deber o acto señalado o se pronuncie al respecto. Su silencio o negativa constituirá la renuencia que habilita el ejercicio de las acciones constitucionales correspondientes.

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

// Respuesta que NOSOTROS (la entidad/empresa) damos a un derecho de petición que
// nos fue dirigido. El peticionario externo está en `datos.*` (texto), no como
// `parte`. La firma queda como bloque en blanco para que el responsable la
// complete (el contexto de render no expone la empresa).
const RESPUESTA_DDP_RECIBIDO = `{{fecha datos.fechaContestacion}}

Señor(a)
{{mayus datos.peticionario}}
{{#if datos.direccion}}{{datos.direccion}}
{{/if}}{{#if datos.correo}}Correo electrónico: {{datos.correo}}
{{/if}}E.  S.  D.

REFERENCIA: Respuesta a derecho de petición — Radicado de ingreso {{datos.radicadoIngreso}}{{#if datos.radicadoRespuesta}} — Radicado de respuesta {{datos.radicadoRespuesta}}{{/if}}

Respetado(a) señor(a):

En atención al derecho de petición radicado bajo el No. {{datos.radicadoIngreso}}{{#if datos.fechaRecepcion}}, recibido el {{fecha datos.fechaRecepcion}}{{/if}}, mediante el cual solicitó:
{{#each datos.queSolicita}}
{{@index}}. {{this}}{{/each}}
{{#if datos.otroSolicita}}
{{datos.otroSolicita}}
{{/if}}
nos permitimos dar respuesta de fondo, clara, precisa y congruente con lo solicitado, en cumplimiento del derecho fundamental de petición consagrado en el artículo 23 de la Constitución Política y la Ley 1755 de 2015.

RESPUESTA
{{#if datos.observacionContestacion}}{{datos.observacionContestacion}}{{else}}[[falta: respuesta de fondo a la petición]]{{/if}}

{{#if datos.detalle}}HECHOS Y CONSIDERACIONES
{{datos.detalle}}

{{/if}}La presente respuesta se notifica por el medio señalado por el peticionario{{#if datos.medioRespuesta}} ({{datos.medioRespuesta}}){{/if}}. Si no comparte la decisión adoptada, podrá ejercer los recursos y acciones que la ley contempla.

Atentamente,



______________________________
Firma del responsable
[[falta: nombre, cargo y entidad que responde]]`;

export const PLANTILLAS_SEED: PlantillaSeed[] = [
  { tipoNombre: "Derecho de Petición Recibido", nombre: "Respuesta a la petición recibida", contenido: RESPUESTA_DDP_RECIBIDO },
  { tipoNombre: "Derecho de Petición", nombre: "Derecho de petición", contenido: PETICION },
  { tipoNombre: "Derecho de Petición", nombre: "Reiteración de la petición", contenido: REITERACION },
  { tipoNombre: "Reclamación Administrativa", nombre: "Reclamación administrativa", contenido: RECLAMACION },
  { tipoNombre: "Reclamación Administrativa", nombre: "Reiteración de la reclamación", contenido: REITERACION_RECLAMACION },
  { tipoNombre: "Constitución de Renuencia", nombre: "Constitución de renuencia", contenido: RENUENCIA },
  { tipoNombre: "Acción de tutela", nombre: "Demanda de tutela", contenido: DEMANDA_TUTELA },
];
