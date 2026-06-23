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

// --- Proceso ejecutivo de mínima cuantía (6 plantillas) ---
// El abogado firmante sale de `proceso.responsable.*` (Usuario.cedula/tarjetaProfesional);
// el domicilio de las partes de `parte.*.{direccion,ciudad}` (Litigante). `{{#if}}` solo
// evalúa verdad/falsedad → los condicionales usan booleans (embargoSalarios/embargoCuentas)
// o presencia de campos, nunca el valor "Sí/No" de un select.

const EJ_DEMANDA = `Señor
JUEZ CIVIL MUNICIPAL DE {{mayus datos.ciudadReparto}} (REPARTO)
E.  S.  D.

REFERENCIA: PROCESO EJECUTIVO DE MÍNIMA CUANTÍA
DEMANDANTE: {{mayus parte.demandante.nombre}}
DEMANDADO: {{mayus parte.demandado.nombre}}

{{parte.demandante.nombre}}, persona {{parte.demandante.tipoPersona}} identificada con {{parte.demandante.tipoDocumento}} No. {{parte.demandante.numeroDocumento}}, domiciliada en la ciudad de {{parte.demandante.ciudad}}, en ejercicio de mis derechos formulo ante su Despacho DEMANDA EJECUTIVA DE MÍNIMA CUANTÍA contra {{parte.demandado.nombre}}, identificado(a) con cédula No. {{parte.demandado.numeroDocumento}}, para que se libre MANDAMIENTO DE PAGO por las sumas indicadas en las pretensiones.

HECHOS
{{datos.hechos}}

PRETENSIONES
{{datos.pretensiones}}
Que se condene al demandado(a) al pago del capital de $ {{moneda datos.capitalAdeudado}} ({{enLetras datos.capitalAdeudado}} PESOS){{#if datos.tasaInteresMoratorio}}, más los intereses de mora a la tasa del {{decimal datos.tasaInteresMoratorio}}% {{#if datos.periodoTasaMoratoria}}{{datos.periodoTasaMoratoria}}{{else}}efectivo anual{{/if}} causados desde el {{fecha datos.fechaExigibilidad}} hasta el pago total{{/if}}, junto con las costas del proceso.

DERECHO
Artículos 619 a 670 y 709 a 711 del Código de Comercio; artículos 82, 422 y siguientes del Código General del Proceso, y demás normas concordantes.

CLASE DE PROCESO, COMPETENCIA Y CUANTÍA
Se trata de un proceso ejecutivo de mínima cuantía. Es usted competente por el lugar de cumplimiento de la obligación y por la cuantía, que estimo en $ {{moneda datos.cuantia}} ({{enLetras datos.cuantia}} PESOS).

PRUEBAS
{{#if datos.pruebas}}{{datos.pruebas}}{{else}}[[falta: datos.pruebas]]{{/if}}

ANEXOS
- Los documentos enunciados como pruebas.
- Poder a mí conferido.

NOTIFICACIONES
El demandante recibirá notificaciones en la secretaría del Juzgado y en el correo: {{parte.demandante.email}}.
El demandado(a) en {{parte.demandado.direccion}}, ciudad de {{parte.demandado.ciudad}}; teléfono {{parte.demandado.telefono}}; correo {{parte.demandado.email}}.

Atentamente,


{{proceso.responsable.nombre}}
Abogado(a) — T.P. No. {{proceso.responsable.tarjetaProfesional}}`;

const EJ_PODER = `PODER ESPECIAL

{{#if datos.repLegalNombre}}Yo, {{mayus datos.repLegalNombre}}, mayor de edad, identificado(a) con cédula de ciudadanía No. {{datos.repLegalDocumento}}, actuando en calidad de Representante Legal de {{mayus parte.cliente.nombre}} (identificada con {{parte.cliente.tipoDocumento}} No. {{parte.cliente.numeroDocumento}}){{else}}Yo, {{mayus parte.cliente.nombre}}, mayor de edad, identificado(a) con {{parte.cliente.tipoDocumento}} No. {{parte.cliente.numeroDocumento}}{{/if}}, por medio del presente escrito confiero PODER ESPECIAL, amplio y suficiente, a {{mayus proceso.responsable.nombre}}, identificado(a) con cédula de ciudadanía No. {{proceso.responsable.cedula}} y Tarjeta Profesional No. {{proceso.responsable.tarjetaProfesional}}, para que actúe en mi nombre y representación ante entidades públicas y privadas, personas naturales o jurídicas, con el fin de realizar las actuaciones, gestiones, consultas, verificaciones y trámites necesarios para la defensa de mis intereses.

En ejercicio de este poder, el apoderado podrá solicitar información, presentar peticiones, allegar documentos, recibir respuestas, efectuar consultas en bases de datos de acceso autorizado, realizar seguimiento a trámites, gestionar requerimientos y, en general, adelantar todas las actuaciones que sean necesarias, dentro del marco legal vigente.

El presente poder se otorga a partir de la fecha de su firma y permanecerá vigente hasta su revocatoria expresa o el cumplimiento de la gestión encomendada.

Se firma en la ciudad de {{datos.ciudadFirmaPoder}}, el {{fecha datos.fechaPoder}}.


OTORGANTE,


______________________________
{{#if datos.repLegalNombre}}{{mayus datos.repLegalNombre}}
C.C. No. {{datos.repLegalDocumento}}
Representante Legal de {{mayus parte.cliente.nombre}}{{else}}{{mayus parte.cliente.nombre}}
C.C. No. {{parte.cliente.numeroDocumento}}{{/if}}`;

const EJ_CAUTELARES = `Señor
JUEZ CIVIL MUNICIPAL DE {{mayus datos.ciudadReparto}} (REPARTO)
E.  S.  D.

REFERENCIA: PROCESO EJECUTIVO DE MÍNIMA CUANTÍA{{#if datos.radicado}} — Radicado {{datos.radicado}}{{/if}}
DEMANDANTE: {{mayus parte.demandante.nombre}}
DEMANDADO: {{mayus parte.demandado.nombre}}

{{parte.demandante.nombre}}, identificado(a) con {{parte.demandante.tipoDocumento}} No. {{parte.demandante.numeroDocumento}}, en el proceso de la referencia que adelanto contra {{parte.demandado.nombre}}, respetuosamente solicito al Despacho, conforme al artículo 599 y siguientes del Código General del Proceso, decretar las siguientes MEDIDAS CAUTELARES sobre los bienes del demandado(a):

{{#if datos.embargoSalarios}}1) EMBARGO Y RETENCIÓN DE SALARIOS del señor(a) {{parte.demandado.nombre}}, identificado(a) con cédula No. {{parte.demandado.numeroDocumento}}, en su calidad de empleado(a) de la empresa {{datos.empleadorDemandado}}, en las proporciones legales. Ruego oficiar al empleador para que efectúe la retención y la consigne a órdenes del Despacho.

{{/if}}{{#if datos.embargoCuentas}}2) EMBARGO DE CUENTAS BANCARIAS Y DEPÓSITOS a nombre del señor(a) {{parte.demandado.nombre}}, con cédula No. {{parte.demandado.numeroDocumento}}. Ruego oficiar a las siguientes entidades del sistema financiero:
Banco de Bogotá, Banco Popular, Bancolombia, Scotiabank Colpatria, Banco GNB Sudameris, BBVA Colombia, Banco de Occidente, Banco Caja Social, Banco Davivienda, Banco Colpatria Red Multibanca, Banco Agrario, Banco AV Villas, Banco ProCredit, Banca Mía S.A., Banco W S.A., Bancoomeva, Banco Finandina, Banco Falabella S.A., Banco Pichincha S.A., Banco Cooperativo Coopcentral, Banco Santander de Negocios Colombia S.A., Banco Mundo Mujer, Banco Multibank S.A., Banco Compartir S.A. y Banco Itaú.

{{/if}}{{#if datos.otrasCautelares}}3) OTRAS MEDIDAS: {{datos.otrasCautelares}}

{{/if}}Del señor Juez, atentamente,


{{proceso.responsable.nombre}}
Abogado(a) — T.P. No. {{proceso.responsable.tarjetaProfesional}}`;

const EJ_MEMORIAL = `Señor
JUEZ {{datos.juzgado}}
E.  S.  D.

Referencia: Proceso ejecutivo de mínima cuantía{{#if datos.radicado}} — Radicado {{datos.radicado}}{{/if}}
Demandante: {{parte.demandante.nombre}}
Demandado: {{parte.demandado.nombre}}
Asunto: {{#if datos.asuntoMemorial}}{{datos.asuntoMemorial}}{{else}}Solicitud de información sobre el estado del proceso de la referencia{{/if}}

Respetado señor Juez:

{{parte.demandante.nombre}}, en mi calidad de parte demandante dentro del proceso de la referencia, respetuosamente solicito se sirva informar el estado actual del mismo, teniendo en cuenta que la última actuación registrada es: {{#if datos.ultimaActuacion}}{{datos.ultimaActuacion}}{{else}}[[falta: datos.ultimaActuacion]]{{/if}}.

En consecuencia, solicito informar:
1. El estado actual del proceso.
2. Si se surtió el trámite correspondiente y su resultado.
3. Si existe auto que apruebe, modifique o niegue las pretensiones.
4. Las actuaciones posteriores a la última registrada.
5. Si existen actuaciones pendientes a cargo del despacho o de la parte.

Lo anterior con el fin de contar con información actualizada y adelantar lo procedente.

Cordialmente,


{{proceso.responsable.nombre}}
Abogado(a) — T.P. No. {{proceso.responsable.tarjetaProfesional}}`;

const EJ_ACUERDO = `ACUERDO DE PAGO{{#if datos.numeroCredito}} — CRÉDITO N.º {{datos.numeroCredito}}{{/if}}

Entre los suscritos: {{mayus parte.demandado.nombre}}, identificado(a) con {{parte.demandado.tipoDocumento}} No. {{parte.demandado.numeroDocumento}}, quien en adelante se denominará EL DEUDOR; y {{mayus parte.demandante.nombre}}, identificado(a) con {{parte.demandante.tipoDocumento}} No. {{parte.demandante.numeroDocumento}}, quien en adelante se denominará EL ACREEDOR, se acuerda:

PRIMERA. OBJETO. El DEUDOR se obliga a pagar al ACREEDOR la obligación{{#if datos.numeroCredito}} del crédito N.º {{datos.numeroCredito}}{{/if}}, por un capital de $ {{moneda datos.capitalAdeudado}} ({{enLetras datos.capitalAdeudado}} PESOS).

SEGUNDA. FORMA DE PAGO. El DEUDOR pagará en {{datos.numeroCuotas}} cuotas, conforme al siguiente cronograma (N.º cuota | fecha de pago | valor):
{{datos.cronograma}}
PARÁGRAFO. Los pagos se harán a nombre de {{datos.titularRecaudo}} por los medios autorizados, compartiendo el soporte a {{datos.contactoSoporte}}.

TERCERA. OBLIGACIONES DEL ACREEDOR. Emitir el Paz y Salvo a nombre de {{parte.demandado.nombre}} una vez cancelada la totalidad de la deuda, y actualizar la información en las centrales de riesgo.

CUARTA. INCUMPLIMIENTO. Ante el incumplimiento de cualquier cuota, el ACREEDOR podrá continuar las acciones legales correspondientes (medidas cautelares en demanda ejecutiva, cobro de intereses moratorios y costas, embargo de bienes/salarios/cuentas y reporte a centrales de riesgo).

QUINTA. CLÁUSULA ACELERATORIA. El DEUDOR autoriza al ACREEDOR para declarar extinguido el plazo y exigir el pago total de la obligación, sin necesidad de requerimiento judicial ni extrajudicial, ante: a) el incumplimiento de cualquiera de las cuotas; b) la insolvencia del DEUDOR o el inicio de un proceso ejecutivo en su contra.

En constancia, se firma en {{datos.ciudadFirmaAcuerdo}}, el {{fecha datos.fechaAcuerdo}}.


______________________________        ______________________________
EL DEUDOR                              EL ACREEDOR
{{parte.demandado.nombre}}            {{parte.demandante.nombre}}`;

const EJ_TERMINACION = `Señores
JUZGADO {{datos.juzgado}}
E.  S.  D.

REFERENCIA: TERMINACIÓN DEL PROCESO
DEMANDANTE: {{mayus parte.demandante.nombre}}
DEMANDADO: {{mayus parte.demandado.nombre}}
RADICADO: {{datos.radicado}}

{{mayus proceso.responsable.nombre}}, identificado(a) con cédula de ciudadanía No. {{proceso.responsable.cedula}}, abogado(a) en ejercicio con Tarjeta Profesional No. {{proceso.responsable.tarjetaProfesional}} del Consejo Superior de la Judicatura, actuando como apoderado(a) de {{parte.demandante.nombre}}, me permito solicitar al Despacho la TERMINACIÓN del proceso de la referencia, toda vez que el demandado(a) cumplió con lo solicitado en las pretensiones de la demanda{{#if datos.fechaTerminacion}}, hecho verificado el {{fecha datos.fechaTerminacion}}{{/if}}.

En consecuencia, solicito declarar terminado el proceso, ordenar su archivo y el levantamiento de las medidas cautelares que se hubieren decretado.

Recibo notificaciones en el correo electrónico {{proceso.responsable.email}}.

Cordialmente,


{{proceso.responsable.nombre}}
C.C. No. {{proceso.responsable.cedula}}
T.P. No. {{proceso.responsable.tarjetaProfesional}} C.S.J.`;

export const PLANTILLAS_SEED: PlantillaSeed[] = [
  { tipoNombre: "Derecho de Petición Recibido", nombre: "Respuesta a la petición recibida", contenido: RESPUESTA_DDP_RECIBIDO },
  { tipoNombre: "Derecho de Petición", nombre: "Derecho de petición", contenido: PETICION },
  { tipoNombre: "Derecho de Petición", nombre: "Reiteración de la petición", contenido: REITERACION },
  { tipoNombre: "Reclamación Administrativa", nombre: "Reclamación administrativa", contenido: RECLAMACION },
  { tipoNombre: "Reclamación Administrativa", nombre: "Reiteración de la reclamación", contenido: REITERACION_RECLAMACION },
  { tipoNombre: "Constitución de Renuencia", nombre: "Constitución de renuencia", contenido: RENUENCIA },
  { tipoNombre: "Acción de tutela", nombre: "Demanda de tutela", contenido: DEMANDA_TUTELA },
  // Proceso ejecutivo de mínima cuantía — los nombres = slot de archivo para anclar a su etapa.
  { tipoNombre: "Proceso ejecutivo de mínima cuantía", nombre: "demanda.pdf", contenido: EJ_DEMANDA },
  { tipoNombre: "Proceso ejecutivo de mínima cuantía", nombre: "poder.pdf", contenido: EJ_PODER },
  { tipoNombre: "Proceso ejecutivo de mínima cuantía", nombre: "solicitud-cautelares.pdf", contenido: EJ_CAUTELARES },
  { tipoNombre: "Proceso ejecutivo de mínima cuantía", nombre: "memorial.pdf", contenido: EJ_MEMORIAL },
  { tipoNombre: "Proceso ejecutivo de mínima cuantía", nombre: "acuerdo-pago.pdf", contenido: EJ_ACUERDO },
  { tipoNombre: "Proceso ejecutivo de mínima cuantía", nombre: "solicitud-terminacion.pdf", contenido: EJ_TERMINACION },
];
