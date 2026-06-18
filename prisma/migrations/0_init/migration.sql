-- CreateTable
CREATE TABLE `empresas` (
    `id` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `rfc` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `telefono` VARCHAR(191) NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `empresas_rfc_key`(`rfc`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `usuarios` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `rol` ENUM('ADMIN', 'USUARIO', 'COMERCIAL') NOT NULL DEFAULT 'USUARIO',
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `esAdminEmpresa` BOOLEAN NOT NULL DEFAULT false,
    `porcentajeComision` DECIMAL(5, 2) NULL,
    `empresaId` VARCHAR(191) NULL,
    `activationToken` VARCHAR(191) NULL,
    `activationExpires` DATETIME(3) NULL,
    `tokenVersion` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `usuarios_email_key`(`email`),
    UNIQUE INDEX `usuarios_activationToken_key`(`activationToken`),
    INDEX `usuarios_empresaId_idx`(`empresaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `servicios` (
    `id` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `descripcion` TEXT NULL,
    `precioBase` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `precioPorUnidad` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `unidad` VARCHAR(191) NULL,
    `incluidos` INTEGER NOT NULL DEFAULT 0,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `servicios_nombre_key`(`nombre`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `empresa_servicios` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `servicioId` VARCHAR(191) NOT NULL,
    `precioBase` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `precioPorUnidad` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `incluidos` INTEGER NOT NULL DEFAULT 0,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `asignadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `empresa_servicios_servicioId_idx`(`servicioId`),
    UNIQUE INDEX `empresa_servicios_empresaId_servicioId_key`(`empresaId`, `servicioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `areas_practica` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `tipo` ENUM('JURISDICCION', 'ESPECIALIDAD', 'PRACTICA') NOT NULL DEFAULT 'PRACTICA',
    `jurisdiccion` ENUM('ORDINARIA_CIVIL', 'ORDINARIA_LABORAL', 'CONTENCIOSO_ADMIN', 'PENAL', 'CONSTITUCIONAL', 'FAMILIA') NOT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `orden` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `areas_practica_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tipos_tramite` (
    `id` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `descripcion` TEXT NULL,
    `jurisdiccion` ENUM('ORDINARIA_CIVIL', 'ORDINARIA_LABORAL', 'CONTENCIOSO_ADMIN', 'PENAL', 'CONSTITUCIONAL', 'FAMILIA') NOT NULL,
    `grupo` ENUM('JUDICIAL', 'PETICION', 'CONSTITUCIONAL', 'LABORAL') NOT NULL DEFAULT 'JUDICIAL',
    `esquemaFormulario` JSON NOT NULL,
    `esquemaVersion` INTEGER NOT NULL DEFAULT 1,
    `etapas` JSON NOT NULL,
    `empresaId` VARCHAR(191) NULL,
    `empresaKey` VARCHAR(191) NOT NULL,
    `origenId` VARCHAR(191) NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `esJudicial` BOOLEAN NOT NULL DEFAULT true,
    `clienteOpcional` BOOLEAN NOT NULL DEFAULT false,
    `actualizado` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `tipos_tramite_empresaId_idx`(`empresaId`),
    INDEX `tipos_tramite_jurisdiccion_idx`(`jurisdiccion`),
    UNIQUE INDEX `tipos_tramite_empresaKey_nombre_key`(`empresaKey`, `nombre`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tipo_tramite_areas` (
    `tipoTramiteId` VARCHAR(191) NOT NULL,
    `areaId` VARCHAR(191) NOT NULL,

    INDEX `tipo_tramite_areas_areaId_idx`(`areaId`),
    PRIMARY KEY (`tipoTramiteId`, `areaId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tramites` (
    `id` VARCHAR(191) NOT NULL,
    `codigoInterno` VARCHAR(191) NOT NULL,
    `radicado` VARCHAR(191) NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `tipoTramiteId` VARCHAR(191) NOT NULL,
    `tipoEsquemaVersion` INTEGER NOT NULL,
    `jurisdiccion` ENUM('ORDINARIA_CIVIL', 'ORDINARIA_LABORAL', 'CONTENCIOSO_ADMIN', 'PENAL', 'CONSTITUCIONAL', 'FAMILIA') NOT NULL,
    `instancia` ENUM('PRIMERA', 'SEGUNDA', 'UNICA', 'CASACION', 'REVISION') NOT NULL DEFAULT 'PRIMERA',
    `cuantiaTipo` ENUM('MINIMA', 'MENOR', 'MAYOR', 'SIN_CUANTIA') NULL,
    `cuantiaValor` DECIMAL(14, 2) NULL,
    `despachoJuzgado` VARCHAR(191) NULL,
    `casoRelacionadoId` VARCHAR(191) NULL,
    `clienteId` VARCHAR(191) NULL,
    `creadoPorId` VARCHAR(191) NULL,
    `responsableId` VARCHAR(191) NULL,
    `titulo` VARCHAR(191) NOT NULL,
    `tituloManual` BOOLEAN NOT NULL DEFAULT false,
    `datos` JSON NOT NULL,
    `etapaActual` VARCHAR(191) NOT NULL,
    `estado` ENUM('ABIERTO', 'EN_PROCESO', 'SUSPENDIDO', 'CERRADO', 'ARCHIVADO') NOT NULL DEFAULT 'ABIERTO',
    `prioridad` ENUM('BAJA', 'MEDIA', 'ALTA', 'URGENTE') NOT NULL DEFAULT 'MEDIA',
    `proximaAudiencia` DATETIME(3) NULL,
    `fechaLimite` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `tramites_empresaId_idx`(`empresaId`),
    INDEX `tramites_tipoTramiteId_idx`(`tipoTramiteId`),
    INDEX `tramites_responsableId_idx`(`responsableId`),
    INDEX `tramites_estado_idx`(`estado`),
    INDEX `tramites_radicado_idx`(`radicado`),
    INDEX `tramites_casoRelacionadoId_idx`(`casoRelacionadoId`),
    INDEX `tramites_clienteId_idx`(`clienteId`),
    INDEX `tramites_empresaId_fechaLimite_idx`(`empresaId`, `fechaLimite`),
    UNIQUE INDEX `tramites_empresaId_codigoInterno_key`(`empresaId`, `codigoInterno`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `etapas_tramite` (
    `id` VARCHAR(191) NOT NULL,
    `tramiteId` VARCHAR(191) NOT NULL,
    `etapaKey` VARCHAR(191) NOT NULL,
    `nota` TEXT NULL,
    `usuarioId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `etapas_tramite_tramiteId_idx`(`tramiteId`),
    INDEX `etapas_tramite_usuarioId_idx`(`usuarioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `actuaciones_judiciales` (
    `id` VARCHAR(191) NOT NULL,
    `tramiteId` VARCHAR(191) NOT NULL,
    `radicado` VARCHAR(191) NOT NULL,
    `fechaActuacion` DATETIME(3) NULL,
    `actuacion` VARCHAR(191) NOT NULL,
    `anotacion` TEXT NULL,
    `fuente` VARCHAR(191) NOT NULL,
    `hashIdempotencia` VARCHAR(191) NOT NULL,
    `etapaProcesoId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `actuaciones_judiciales_tramiteId_fechaActuacion_idx`(`tramiteId`, `fechaActuacion`),
    UNIQUE INDEX `actuaciones_judiciales_tramiteId_hashIdempotencia_key`(`tramiteId`, `hashIdempotencia`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integration_sync_logs` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `tramiteId` VARCHAR(191) NULL,
    `proveedor` VARCHAR(191) NOT NULL,
    `estado` ENUM('OK', 'ERROR', 'SIN_RADICADO') NOT NULL,
    `itemsFetched` INTEGER NOT NULL DEFAULT 0,
    `itemsNew` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `integration_sync_logs_empresaId_createdAt_idx`(`empresaId`, `createdAt`),
    INDEX `integration_sync_logs_tramiteId_createdAt_idx`(`tramiteId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_configs` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `proveedor` VARCHAR(191) NOT NULL,
    `habilitado` BOOLEAN NOT NULL DEFAULT true,
    `credencialCifrada` TEXT NULL,
    `configuracion` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `provider_configs_empresaId_idx`(`empresaId`),
    UNIQUE INDEX `provider_configs_empresaId_proveedor_key`(`empresaId`, `proveedor`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `documentos_tramite` (
    `id` VARCHAR(191) NOT NULL,
    `tramiteId` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NULL,
    `contenido` TEXT NULL,
    `generadoDePlantilla` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `documentos_tramite_tramiteId_idx`(`tramiteId`),
    INDEX `documentos_tramite_generadoDePlantilla_idx`(`generadoDePlantilla`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `litigantes` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `tipoPersona` ENUM('NATURAL', 'JURIDICA') NOT NULL DEFAULT 'NATURAL',
    `nombre` VARCHAR(191) NOT NULL,
    `tipoDocumento` ENUM('CC', 'CE', 'NIT', 'TI', 'PASAPORTE', 'PEP_PPT') NULL,
    `numeroDocumento` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `correos` JSON NULL,
    `telefono` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `litigantes_empresaId_idx`(`empresaId`),
    UNIQUE INDEX `litigantes_empresaId_tipoDocumento_numeroDocumento_key`(`empresaId`, `tipoDocumento`, `numeroDocumento`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `partes_tramite` (
    `id` VARCHAR(191) NOT NULL,
    `tramiteId` VARCHAR(191) NOT NULL,
    `litiganteId` VARCHAR(191) NOT NULL,
    `rol` ENUM('DEMANDANTE', 'DEMANDADO', 'EJECUTANTE', 'EJECUTADO', 'ACCIONANTE', 'ACCIONADO', 'IMPUTADO', 'ACUSADO', 'VICTIMA', 'TERCERO', 'APODERADO', 'OTRO') NOT NULL,
    `rolEtiqueta` VARCHAR(191) NULL,
    `esNuestroCliente` BOOLEAN NOT NULL DEFAULT false,

    INDEX `partes_tramite_litiganteId_idx`(`litiganteId`),
    UNIQUE INDEX `partes_tramite_tramiteId_litiganteId_rol_key`(`tramiteId`, `litiganteId`, `rol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plantillas_documento` (
    `id` VARCHAR(191) NOT NULL,
    `tipoTramiteId` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `contenido` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `plantillas_documento_tipoTramiteId_idx`(`tipoTramiteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `modulos` (
    `id` VARCHAR(191) NOT NULL,
    `clave` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `descripcion` TEXT NULL,
    `esBaseline` BOOLEAN NOT NULL DEFAULT false,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `orden` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `modulos_clave_key`(`clave`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permisos` (
    `id` VARCHAR(191) NOT NULL,
    `clave` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `descripcion` TEXT NULL,
    `moduloId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `permisos_clave_key`(`clave`),
    INDEX `permisos_moduloId_idx`(`moduloId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rol_empresa_permisos` (
    `rolEmpresa` ENUM('ADMINISTRADOR', 'JURIDICO', 'CONTABLE', 'COMERCIAL') NOT NULL,
    `permisoId` VARCHAR(191) NOT NULL,

    INDEX `rol_empresa_permisos_permisoId_idx`(`permisoId`),
    PRIMARY KEY (`rolEmpresa`, `permisoId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `usuario_roles_empresa` (
    `id` VARCHAR(191) NOT NULL,
    `usuarioId` VARCHAR(191) NOT NULL,
    `rolEmpresa` ENUM('ADMINISTRADOR', 'JURIDICO', 'CONTABLE', 'COMERCIAL') NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `asignadoPorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `usuario_roles_empresa_empresaId_rolEmpresa_idx`(`empresaId`, `rolEmpresa`),
    UNIQUE INDEX `usuario_roles_empresa_usuarioId_rolEmpresa_key`(`usuarioId`, `rolEmpresa`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `planes` (
    `id` VARCHAR(191) NOT NULL,
    `clave` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `descripcion` TEXT NULL,
    `precioMensual` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `orden` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `planes_clave_key`(`clave`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plan_modulos` (
    `id` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `moduloId` VARCHAR(191) NOT NULL,

    INDEX `plan_modulos_moduloId_idx`(`moduloId`),
    UNIQUE INDEX `plan_modulos_planId_moduloId_key`(`planId`, `moduloId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plan_cuotas` (
    `id` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `rolEmpresa` ENUM('ADMINISTRADOR', 'JURIDICO', 'CONTABLE', 'COMERCIAL') NOT NULL,
    `limite` INTEGER NULL,

    UNIQUE INDEX `plan_cuotas_planId_rolEmpresa_key`(`planId`, `rolEmpresa`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `suscripciones` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `estado` ENUM('ACTIVA', 'TRIAL', 'SUSPENDIDA', 'CANCELADA') NOT NULL DEFAULT 'ACTIVA',
    `inicioEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finEn` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `suscripciones_empresaId_key`(`empresaId`),
    INDEX `suscripciones_planId_idx`(`planId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `suscripcion_modulos` (
    `id` VARCHAR(191) NOT NULL,
    `suscripcionId` VARCHAR(191) NOT NULL,
    `moduloId` VARCHAR(191) NOT NULL,
    `habilitado` BOOLEAN NOT NULL DEFAULT true,

    INDEX `suscripcion_modulos_moduloId_idx`(`moduloId`),
    UNIQUE INDEX `suscripcion_modulos_suscripcionId_moduloId_key`(`suscripcionId`, `moduloId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `suscripcion_cuotas` (
    `id` VARCHAR(191) NOT NULL,
    `suscripcionId` VARCHAR(191) NOT NULL,
    `rolEmpresa` ENUM('ADMINISTRADOR', 'JURIDICO', 'CONTABLE', 'COMERCIAL') NOT NULL,
    `limite` INTEGER NULL,

    UNIQUE INDEX `suscripcion_cuotas_suscripcionId_rolEmpresa_key`(`suscripcionId`, `rolEmpresa`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clientes` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `estado` ENUM('PROSPECTO', 'CLIENTE', 'DESCARTADO') NOT NULL DEFAULT 'PROSPECTO',
    `fechaIngreso` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `tipoPersona` ENUM('NATURAL', 'JURIDICA') NOT NULL DEFAULT 'NATURAL',
    `nombre` VARCHAR(191) NOT NULL,
    `tipoDocumento` ENUM('CC', 'CE', 'NIT', 'TI', 'PASAPORTE', 'PEP_PPT') NULL,
    `numeroDocumento` VARCHAR(191) NULL,
    `telefono` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `correos` JSON NULL,
    `ciudad` VARCHAR(191) NULL,
    `canalIngreso` ENUM('REFERIDO', 'INSTAGRAM', 'FACEBOOK', 'WHATSAPP', 'WEB', 'LLAMADA', 'OTRO') NULL,
    `tipoCaso` ENUM('CIVIL', 'LABORAL', 'PENAL', 'ADMINISTRATIVO', 'DISCIPLINARIO', 'CONSTITUCIONAL', 'FAMILIA', 'COMERCIAL', 'TRANSITO', 'AMBIENTAL', 'OTRO') NULL,
    `necesidadTipoTramiteId` VARCHAR(191) NULL,
    `resumenCaso` TEXT NULL,
    `viabilidad` ENUM('VIABLE', 'NO_VIABLE', 'EN_ESTUDIO') NULL DEFAULT 'EN_ESTUDIO',
    `responsableComercialId` VARCHAR(191) NULL,
    `observaciones` TEXT NULL,
    `litiganteId` VARCHAR(191) NULL,
    `convertidoEn` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `clientes_empresaId_idx`(`empresaId`),
    INDEX `clientes_estado_idx`(`estado`),
    INDEX `clientes_responsableComercialId_idx`(`responsableComercialId`),
    INDEX `clientes_necesidadTipoTramiteId_idx`(`necesidadTipoTramiteId`),
    INDEX `clientes_litiganteId_idx`(`litiganteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seguimientos_comerciales` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NULL,
    `fechaContacto` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `tipoGestion` ENUM('LLAMADA', 'WHATSAPP', 'REUNION', 'VIDEOLLAMADA', 'CORREO', 'OTRO') NOT NULL,
    `motivoContacto` TEXT NULL,
    `resultado` TEXT NULL,
    `disposicion` ENUM('CONTACTADO', 'NO_CONTESTA', 'INTERESADO', 'NO_VIABLE', 'OTRO') NULL,
    `proximaTarea` VARCHAR(191) NULL,
    `fechaProximaTarea` DATETIME(3) NULL,
    `estadoSeguimiento` ENUM('PENDIENTE', 'EN_GESTION', 'CERRADO') NOT NULL DEFAULT 'PENDIENTE',
    `observaciones` TEXT NULL,
    `registradoPorId` VARCHAR(191) NULL,
    `comercialId` VARCHAR(191) NULL,
    `titulo` VARCHAR(191) NULL,
    `completada` BOOLEAN NOT NULL DEFAULT false,
    `fechaCompletada` DATETIME(3) NULL,
    `canceladaEn` DATETIME(3) NULL,
    `motivoCancelacion` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `seguimientos_comerciales_clienteId_fechaContacto_idx`(`clienteId`, `fechaContacto`),
    INDEX `seguimientos_comerciales_empresaId_fechaProximaTarea_idx`(`empresaId`, `fechaProximaTarea`),
    INDEX `seguimientos_comerciales_empresaId_estadoSeguimiento_idx`(`empresaId`, `estadoSeguimiento`),
    INDEX `seguimientos_comerciales_empresaId_comercialId_fechaProximaT_idx`(`empresaId`, `comercialId`, `fechaProximaTarea`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `comisiones_despacho` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `comercialId` VARCHAR(191) NOT NULL,
    `contratoId` VARCHAR(191) NULL,
    `baseCalculo` DECIMAL(14, 2) NOT NULL,
    `porcentaje` DECIMAL(5, 2) NULL,
    `monto` DECIMAL(14, 2) NOT NULL,
    `estado` ENUM('PENDIENTE', 'PAGADA', 'ANULADA') NOT NULL DEFAULT 'PENDIENTE',
    `fechaPago` DATETIME(3) NULL,
    `notas` TEXT NULL,
    `registradoPorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `comisiones_despacho_empresaId_estado_idx`(`empresaId`, `estado`),
    INDEX `comisiones_despacho_comercialId_estado_idx`(`comercialId`, `estado`),
    INDEX `comisiones_despacho_clienteId_idx`(`clienteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fases_comerciales` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `fase` ENUM('LEAD', 'CONTACTO', 'EVALUACION', 'PROPUESTA', 'NEGOCIACION', 'CONTRATO', 'PODERES', 'FIRMADO', 'PERDIDO') NOT NULL,
    `fechaInicioFase` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fechaCierreFase` DATETIME(3) NULL,
    `motivoPerdida` TEXT NULL,
    `responsableComercialId` VARCHAR(191) NULL,
    `registradoPorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `fases_comerciales_empresaId_idx`(`empresaId`),
    INDEX `fases_comerciales_clienteId_fechaCierreFase_idx`(`clienteId`, `fechaCierreFase`),
    INDEX `fases_comerciales_fase_idx`(`fase`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cotizaciones` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `tipoServicio` VARCHAR(191) NOT NULL,
    `tipoProcesoId` VARCHAR(191) NULL,
    `valorCotizado` DECIMAL(14, 2) NOT NULL,
    `formaPago` ENUM('CONTADO', 'CUOTAS', 'CUOTALITIS', 'CUOTA_MIXTA', 'PRIMA_EXITO') NOT NULL,
    `porcentajeExito` DECIMAL(5, 2) NULL,
    `numeroCuotas` INTEGER NULL,
    `fechaEnvio` DATETIME(3) NULL,
    `fechaRespuesta` DATETIME(3) NULL,
    `estadoPropuesta` ENUM('PENDIENTE', 'ENVIADA', 'ACEPTADA', 'RECHAZADA') NOT NULL DEFAULT 'PENDIENTE',
    `observaciones` TEXT NULL,
    `creadoPorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `cotizaciones_clienteId_idx`(`clienteId`),
    INDEX `cotizaciones_empresaId_estadoPropuesta_idx`(`empresaId`, `estadoPropuesta`),
    INDEX `cotizaciones_empresaId_fechaEnvio_idx`(`empresaId`, `fechaEnvio`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contratos_comerciales` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `cotizacionId` VARCHAR(191) NULL,
    `tipoContrato` ENUM('PRESTACION_SERVICIOS', 'MANDATO', 'OTRO') NOT NULL,
    `fechaGeneracion` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fechaEnvio` DATETIME(3) NULL,
    `fechaFirma` DATETIME(3) NULL,
    `estadoContrato` ENUM('PENDIENTE', 'ENVIADO', 'FIRMADO') NOT NULL DEFAULT 'PENDIENTE',
    `estadoPoder` ENUM('PENDIENTE', 'ENVIADO', 'FIRMADO') NOT NULL DEFAULT 'PENDIENTE',
    `tipoCobroAcordado` ENUM('CUOTALITIS', 'CUOTA_MIXTA', 'PRIMA_EXITO', 'FIJO', 'OTRO') NOT NULL,
    `valorAcordado` DECIMAL(14, 2) NULL,
    `porcentajeAcordado` DECIMAL(5, 2) NULL,
    `documentoContratoUrl` VARCHAR(191) NULL,
    `documentoPoderUrl` VARCHAR(191) NULL,
    `observaciones` TEXT NULL,
    `registradoPorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `contratos_comerciales_clienteId_idx`(`clienteId`),
    INDEX `contratos_comerciales_empresaId_estadoContrato_fechaEnvio_idx`(`empresaId`, `estadoContrato`, `fechaEnvio`),
    INDEX `contratos_comerciales_empresaId_estadoPoder_idx`(`empresaId`, `estadoPoder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `configuraciones_cobro` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `contratoId` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `modalidadCobro` ENUM('CUOTALITIS', 'CUOTA_MIXTA', 'PRIMA_EXITO', 'FIJO', 'OTRO') NOT NULL,
    `valorFijo` DECIMAL(14, 2) NULL,
    `porcentajeExito` DECIMAL(5, 2) NULL,
    `numeroCuotas` INTEGER NULL,
    `valorCuota` DECIMAL(14, 2) NULL,
    `fechaPrimerPago` DATETIME(3) NULL,
    `condicionesEspeciales` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `configuraciones_cobro_contratoId_key`(`contratoId`),
    INDEX `configuraciones_cobro_empresaId_fechaPrimerPago_idx`(`empresaId`, `fechaPrimerPago`),
    INDEX `configuraciones_cobro_clienteId_idx`(`clienteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `solicitudes_asignacion_proceso` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `contratoId` VARCHAR(191) NULL,
    `tipoProcesoId` VARCHAR(191) NULL,
    `estado` ENUM('PENDIENTE', 'EN_REVISION', 'ASIGNADA', 'RECHAZADA', 'CANCELADA') NOT NULL DEFAULT 'PENDIENTE',
    `prioridad` ENUM('BAJA', 'MEDIA', 'ALTA', 'URGENTE') NULL DEFAULT 'MEDIA',
    `jurisdiccionSugerida` ENUM('ORDINARIA_CIVIL', 'ORDINARIA_LABORAL', 'CONTENCIOSO_ADMIN', 'PENAL', 'CONSTITUCIONAL', 'FAMILIA') NULL,
    `rolParteSugerido` ENUM('DEMANDANTE', 'DEMANDADO', 'EJECUTANTE', 'EJECUTADO', 'ACCIONANTE', 'ACCIONADO', 'IMPUTADO', 'ACUSADO', 'VICTIMA', 'TERCERO', 'APODERADO', 'OTRO') NULL,
    `tituloPropuesto` VARCHAR(191) NULL,
    `resumenCaso` TEXT NULL,
    `cobroSnapshot` JSON NULL,
    `notaComercial` TEXT NULL,
    `tareasDefinidas` TEXT NULL,
    `solicitadoPorId` VARCHAR(191) NULL,
    `asignadoPorId` VARCHAR(191) NULL,
    `abogadoAsignadoId` VARCHAR(191) NULL,
    `procesoId` VARCHAR(191) NULL,
    `motivoRechazo` TEXT NULL,
    `fechaSolicitud` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fechaAsignacion` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `solicitudes_asignacion_proceso_contratoId_key`(`contratoId`),
    UNIQUE INDEX `solicitudes_asignacion_proceso_procesoId_key`(`procesoId`),
    INDEX `solicitudes_asignacion_proceso_empresaId_estado_idx`(`empresaId`, `estado`),
    INDEX `solicitudes_asignacion_proceso_clienteId_idx`(`clienteId`),
    INDEX `solicitudes_asignacion_proceso_abogadoAsignadoId_estado_idx`(`abogadoAsignadoId`, `estado`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ingresos` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `procesoId` VARCHAR(191) NULL,
    `radicado` VARCHAR(191) NULL,
    `contratoId` VARCHAR(191) NULL,
    `configuracionCobroId` VARCHAR(191) NULL,
    `facturaId` VARCHAR(191) NULL,
    `cuentaId` VARCHAR(191) NULL,
    `fechaIngreso` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `conceptoPago` VARCHAR(191) NOT NULL,
    `tipoCobro` ENUM('ANTICIPO', 'CUOTA_INICIAL', 'HONORARIOS', 'PRIMA_EXITO', 'COSTAS', 'ABONO', 'OTRO') NOT NULL,
    `valorRecibido` DECIMAL(14, 2) NOT NULL,
    `metodoPago` ENUM('EFECTIVO', 'TRANSFERENCIA', 'CONSIGNACION', 'TARJETA', 'OTRO') NOT NULL,
    `estadoPago` ENUM('PAGADO', 'PENDIENTE', 'PARCIAL') NOT NULL DEFAULT 'PAGADO',
    `numeroComprobante` VARCHAR(191) NULL,
    `soportePagoUrl` VARCHAR(191) NULL,
    `observaciones` TEXT NULL,
    `registradoPorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ingresos_empresaId_fechaIngreso_idx`(`empresaId`, `fechaIngreso`),
    INDEX `ingresos_clienteId_idx`(`clienteId`),
    INDEX `ingresos_empresaId_procesoId_idx`(`empresaId`, `procesoId`),
    INDEX `ingresos_empresaId_radicado_idx`(`empresaId`, `radicado`),
    INDEX `ingresos_configuracionCobroId_idx`(`configuracionCobroId`),
    INDEX `ingresos_facturaId_idx`(`facturaId`),
    INDEX `ingresos_empresaId_estadoPago_idx`(`empresaId`, `estadoPago`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `egresos` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `tipoGasto` ENUM('GENERAL', 'POR_PROCESO') NOT NULL,
    `clienteId` VARCHAR(191) NULL,
    `procesoId` VARCHAR(191) NULL,
    `radicado` VARCHAR(191) NULL,
    `cuentaId` VARCHAR(191) NULL,
    `fechaGasto` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `categoriaGasto` ENUM('NOMINA', 'SERVICIOS', 'PAPELERIA', 'CAJA_MENOR', 'COSTAS', 'ARRIENDO', 'IMPUESTOS', 'HONORARIOS_TERCEROS', 'OTRO') NOT NULL,
    `subcategoria` VARCHAR(191) NULL,
    `descripcionGasto` VARCHAR(191) NOT NULL,
    `valorGasto` DECIMAL(14, 2) NOT NULL,
    `medioPago` ENUM('EFECTIVO', 'TRANSFERENCIA', 'CONSIGNACION', 'TARJETA', 'OTRO') NOT NULL,
    `estadoGasto` ENUM('PAGADO', 'PENDIENTE') NOT NULL DEFAULT 'PAGADO',
    `responsableId` VARCHAR(191) NULL,
    `soporteGastoUrl` VARCHAR(191) NULL,
    `observaciones` TEXT NULL,
    `registradoPorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `egresos_empresaId_fechaGasto_idx`(`empresaId`, `fechaGasto`),
    INDEX `egresos_empresaId_categoriaGasto_idx`(`empresaId`, `categoriaGasto`),
    INDEX `egresos_empresaId_radicado_idx`(`empresaId`, `radicado`),
    INDEX `egresos_empresaId_procesoId_idx`(`empresaId`, `procesoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nominas` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `empleadoId` VARCHAR(191) NULL,
    `nombreEmpleado` VARCHAR(191) NOT NULL,
    `cargo` VARCHAR(191) NULL,
    `tipoVinculacion` ENUM('LABORAL', 'PRESTACION_SERVICIOS', 'OTRO') NOT NULL,
    `periodo` VARCHAR(191) NOT NULL,
    `fechaIngreso` DATETIME(3) NULL,
    `salarioHonorarios` DECIMAL(14, 2) NOT NULL,
    `auxilioTransporte` DECIMAL(14, 2) NULL,
    `bonificaciones` DECIMAL(14, 2) NULL,
    `descuentos` DECIMAL(14, 2) NULL,
    `valorNetoPagar` DECIMAL(14, 2) NOT NULL,
    `fechaPago` DATETIME(3) NULL,
    `estadoPago` ENUM('PAGADO', 'PENDIENTE') NOT NULL DEFAULT 'PENDIENTE',
    `cuentaId` VARCHAR(191) NULL,
    `comprobantePagoUrl` VARCHAR(191) NULL,
    `observaciones` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `nominas_empresaId_periodo_idx`(`empresaId`, `periodo`),
    INDEX `nominas_empresaId_empleadoId_idx`(`empresaId`, `empleadoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cajas_menores` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `montoInicial` DECIMAL(14, 2) NOT NULL,
    `responsableId` VARCHAR(191) NULL,
    `estado` ENUM('ACTIVA', 'CERRADA') NOT NULL DEFAULT 'ACTIVA',
    `observaciones` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `cajas_menores_empresaId_idx`(`empresaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `caja_menor_movimientos` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `cajaId` VARCHAR(191) NOT NULL,
    `fechaMovimiento` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `tipoMovimiento` ENUM('SALIDA', 'REPOSICION') NOT NULL DEFAULT 'SALIDA',
    `concepto` VARCHAR(191) NOT NULL,
    `categoria` ENUM('TRANSPORTE', 'PAPELERIA', 'MENSAJERIA', 'ALIMENTACION', 'OTRO') NOT NULL,
    `valor` DECIMAL(14, 2) NOT NULL,
    `procesoId` VARCHAR(191) NULL,
    `radicado` VARCHAR(191) NULL,
    `medioSalida` ENUM('EFECTIVO', 'TRANSFERENCIA', 'CONSIGNACION', 'TARJETA', 'OTRO') NOT NULL,
    `responsableId` VARCHAR(191) NULL,
    `soporteUrl` VARCHAR(191) NULL,
    `observaciones` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `caja_menor_movimientos_cajaId_fechaMovimiento_idx`(`cajaId`, `fechaMovimiento`),
    INDEX `caja_menor_movimientos_empresaId_idx`(`empresaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `servicios_fijos` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `periodo` VARCHAR(191) NOT NULL,
    `tipoServicio` ENUM('AGUA', 'LUZ', 'GAS', 'INTERNET', 'TELEFONO', 'ARRIENDO', 'SOFTWARE', 'MANTENIMIENTO', 'VIGILANCIA', 'OTRO') NOT NULL,
    `proveedor` VARCHAR(191) NOT NULL,
    `valorFacturado` DECIMAL(14, 2) NOT NULL,
    `fechaVencimiento` DATETIME(3) NULL,
    `fechaPago` DATETIME(3) NULL,
    `estadoPago` ENUM('PAGADO', 'PENDIENTE', 'VENCIDO') NOT NULL DEFAULT 'PENDIENTE',
    `cuentaId` VARCHAR(191) NULL,
    `recurrenteId` VARCHAR(191) NULL,
    `soporteFacturaUrl` VARCHAR(191) NULL,
    `observaciones` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `servicios_fijos_empresaId_periodo_idx`(`empresaId`, `periodo`),
    INDEX `servicios_fijos_empresaId_estadoPago_fechaVencimiento_idx`(`empresaId`, `estadoPago`, `fechaVencimiento`),
    INDEX `servicios_fijos_empresaId_recurrenteId_idx`(`empresaId`, `recurrenteId`),
    UNIQUE INDEX `servicios_fijos_empresaId_tipoServicio_proveedor_periodo_key`(`empresaId`, `tipoServicio`, `proveedor`, `periodo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `servicios_fijos_recurrentes` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `tipoServicio` ENUM('AGUA', 'LUZ', 'GAS', 'INTERNET', 'TELEFONO', 'ARRIENDO', 'SOFTWARE', 'MANTENIMIENTO', 'VIGILANCIA', 'OTRO') NOT NULL,
    `proveedor` VARCHAR(191) NOT NULL,
    `valorEstimado` DECIMAL(14, 2) NOT NULL,
    `frecuencia` ENUM('MENSUAL', 'ANUAL') NOT NULL DEFAULT 'MENSUAL',
    `diaPago` INTEGER NOT NULL,
    `mesPago` INTEGER NULL,
    `cuentaId` VARCHAR(191) NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `observaciones` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `servicios_fijos_recurrentes_empresaId_activo_idx`(`empresaId`, `activo`),
    UNIQUE INDEX `servicios_fijos_recurrentes_empresaId_tipoServicio_proveedor_key`(`empresaId`, `tipoServicio`, `proveedor`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cuentas_bancarias` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `entidadBancaria` VARCHAR(191) NOT NULL,
    `tipoCuenta` ENUM('AHORROS', 'CORRIENTE', 'CAJA') NOT NULL,
    `numeroCuenta` VARCHAR(191) NULL,
    `nombreBolsa` VARCHAR(191) NOT NULL,
    `saldoInicial` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `estadoCuenta` ENUM('ACTIVA', 'INACTIVA', 'CONCILIACION_PENDIENTE') NOT NULL DEFAULT 'ACTIVA',
    `responsableId` VARCHAR(191) NULL,
    `observaciones` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `cuentas_bancarias_empresaId_idx`(`empresaId`),
    INDEX `cuentas_bancarias_empresaId_estadoCuenta_idx`(`empresaId`, `estadoCuenta`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cartera` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `procesoId` VARCHAR(191) NULL,
    `contratoId` VARCHAR(191) NULL,
    `configuracionCobroId` VARCHAR(191) NULL,
    `valorTotalAcordado` DECIMAL(14, 2) NULL,
    `tipoCobro` ENUM('CUOTALITIS', 'CUOTA_MIXTA', 'PRIMA_EXITO', 'FIJO', 'OTRO') NOT NULL,
    `fechaProximoPago` DATETIME(3) NULL,
    `estadoCartera` ENUM('AL_DIA', 'VENCIDO', 'PARCIAL', 'PAGADO') NOT NULL DEFAULT 'AL_DIA',
    `responsableId` VARCHAR(191) NULL,
    `observaciones` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cartera_contratoId_key`(`contratoId`),
    UNIQUE INDEX `cartera_configuracionCobroId_key`(`configuracionCobroId`),
    INDEX `cartera_empresaId_estadoCartera_idx`(`empresaId`, `estadoCartera`),
    INDEX `cartera_clienteId_idx`(`clienteId`),
    INDEX `cartera_empresaId_fechaProximoPago_idx`(`empresaId`, `fechaProximoPago`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `facturas` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `contratoId` VARCHAR(191) NULL,
    `configuracionCobroId` VARCHAR(191) NULL,
    `procesoId` VARCHAR(191) NULL,
    `radicado` VARCHAR(191) NULL,
    `numero` VARCHAR(191) NULL,
    `fechaEmision` DATETIME(3) NULL,
    `fechaVencimiento` DATETIME(3) NULL,
    `estado` ENUM('BORRADOR', 'EMITIDA', 'ANULADA') NOT NULL DEFAULT 'BORRADOR',
    `subtotal` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `porcentajeIva` DECIMAL(5, 2) NOT NULL DEFAULT 19,
    `valorIva` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `observaciones` TEXT NULL,
    `motivoAnulacion` TEXT NULL,
    `registradoPorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `facturas_empresaId_estado_idx`(`empresaId`, `estado`),
    INDEX `facturas_clienteId_idx`(`clienteId`),
    INDEX `facturas_empresaId_fechaEmision_idx`(`empresaId`, `fechaEmision`),
    UNIQUE INDEX `facturas_empresaId_numero_key`(`empresaId`, `numero`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `factura_items` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `facturaId` VARCHAR(191) NOT NULL,
    `descripcion` VARCHAR(191) NOT NULL,
    `cantidad` INTEGER NOT NULL DEFAULT 1,
    `valorUnitario` DECIMAL(14, 2) NOT NULL,
    `total` DECIMAL(14, 2) NOT NULL,
    `orden` INTEGER NOT NULL DEFAULT 0,

    INDEX `factura_items_facturaId_idx`(`facturaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prospectos` (
    `id` VARCHAR(191) NOT NULL,
    `nombreEmpresa` VARCHAR(191) NOT NULL,
    `nombreContacto` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `telefono` VARCHAR(191) NULL,
    `numeroDocumento` VARCHAR(191) NULL,
    `cargo` VARCHAR(191) NULL,
    `canalEntrada` ENUM('WEB', 'WHATSAPP', 'DIRECTO', 'REFERIDO', 'LLAMADA', 'REDES_SOCIALES', 'OTRO') NOT NULL DEFAULT 'DIRECTO',
    `referidoPor` VARCHAR(191) NULL,
    `estado` ENUM('NUEVO', 'CONTACTADO', 'COTIZADO', 'NEGOCIACION', 'GANADO', 'PERDIDO') NOT NULL DEFAULT 'NUEVO',
    `planInteresId` VARCHAR(191) NULL,
    `comercialId` VARCHAR(191) NULL,
    `planVendidoId` VARCHAR(191) NULL,
    `precioVenta` DECIMAL(10, 2) NULL,
    `fechaCierre` DATETIME(3) NULL,
    `empresaId` VARCHAR(191) NULL,
    `motivoPerdida` TEXT NULL,
    `notas` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `prospectos_empresaId_key`(`empresaId`),
    INDEX `prospectos_comercialId_estado_idx`(`comercialId`, `estado`),
    INDEX `prospectos_estado_idx`(`estado`),
    INDEX `prospectos_canalEntrada_idx`(`canalEntrada`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seguimientos_prospecto` (
    `id` VARCHAR(191) NOT NULL,
    `prospectoId` VARCHAR(191) NOT NULL,
    `comercialId` VARCHAR(191) NULL,
    `tipo` ENUM('LLAMADA', 'WHATSAPP', 'REUNION', 'VIDEOLLAMADA', 'CORREO', 'OTRO') NOT NULL DEFAULT 'LLAMADA',
    `titulo` VARCHAR(191) NULL,
    `nota` TEXT NULL,
    `resultado` TEXT NULL,
    `fechaProgramada` DATETIME(3) NULL,
    `completada` BOOLEAN NOT NULL DEFAULT false,
    `fechaCompletada` DATETIME(3) NULL,
    `canceladaEn` DATETIME(3) NULL,
    `motivoCancelacion` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `seguimientos_prospecto_prospectoId_createdAt_idx`(`prospectoId`, `createdAt`),
    INDEX `seguimientos_prospecto_comercialId_fechaProgramada_idx`(`comercialId`, `fechaProgramada`),
    INDEX `seguimientos_prospecto_comercialId_completada_idx`(`comercialId`, `completada`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `comisiones` (
    `id` VARCHAR(191) NOT NULL,
    `prospectoId` VARCHAR(191) NOT NULL,
    `comercialId` VARCHAR(191) NOT NULL,
    `baseCalculo` DECIMAL(10, 2) NOT NULL,
    `porcentaje` DECIMAL(5, 2) NULL,
    `monto` DECIMAL(10, 2) NOT NULL,
    `estado` ENUM('PENDIENTE', 'PAGADA', 'ANULADA') NOT NULL DEFAULT 'PENDIENTE',
    `fechaPago` DATETIME(3) NULL,
    `notas` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `comisiones_prospectoId_key`(`prospectoId`),
    INDEX `comisiones_comercialId_estado_idx`(`comercialId`, `estado`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contratos` (
    `id` VARCHAR(191) NOT NULL,
    `usuarioId` VARCHAR(191) NULL,
    `empresaId` VARCHAR(191) NULL,
    `nombreCompleto` VARCHAR(191) NOT NULL,
    `tipoDocumento` ENUM('CC', 'CE', 'NIT', 'TI', 'PASAPORTE', 'PEP_PPT') NULL,
    `numeroDocumento` VARCHAR(191) NULL,
    `fechaNacimiento` DATETIME(3) NULL,
    `direccion` VARCHAR(191) NULL,
    `telefono` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `tipoColaborador` VARCHAR(191) NULL,
    `cargo` VARCHAR(191) NULL,
    `tipoContrato` VARCHAR(191) NULL,
    `fechaInicio` DATETIME(3) NULL,
    `fechaFin` DATETIME(3) NULL,
    `duracionValor` INTEGER NULL,
    `duracionUnidad` VARCHAR(191) NULL,
    `estado` ENUM('ACTIVO', 'FINALIZADO', 'SUSPENDIDO') NOT NULL DEFAULT 'ACTIVO',
    `honorarios` DECIMAL(12, 2) NULL,
    `formaPago` VARCHAR(191) NULL,
    `diaPago` INTEGER NULL,
    `bonificaciones` VARCHAR(191) NULL,
    `descuentos` VARCHAR(191) NULL,
    `cuentaBancaria` VARCHAR(191) NULL,
    `descripcionCargo` TEXT NULL,
    `funciones` TEXT NULL,
    `area` VARCHAR(191) NULL,
    `supervisor` VARCHAR(191) NULL,
    `horario` VARCHAR(191) NULL,
    `modalidad` VARCHAR(191) NULL,
    `observaciones` TEXT NULL,
    `clausulas` TEXT NULL,
    `tipoTerminacion` VARCHAR(191) NULL,
    `penalidades` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `contratos_usuarioId_idx`(`usuarioId`),
    INDEX `contratos_empresaId_idx`(`empresaId`),
    INDEX `contratos_estado_idx`(`estado`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `documentos_contrato` (
    `id` VARCHAR(191) NOT NULL,
    `contratoId` VARCHAR(191) NOT NULL,
    `categoria` ENUM('PERSONAL', 'PROFESIONAL', 'CONTRACTUAL', 'FINANCIERO', 'LEGAL') NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `tipo` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `documentos_contrato_contratoId_idx`(`contratoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `usuarios` ADD CONSTRAINT `usuarios_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `empresa_servicios` ADD CONSTRAINT `empresa_servicios_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `empresa_servicios` ADD CONSTRAINT `empresa_servicios_servicioId_fkey` FOREIGN KEY (`servicioId`) REFERENCES `servicios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tipos_tramite` ADD CONSTRAINT `tipos_tramite_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tipo_tramite_areas` ADD CONSTRAINT `tipo_tramite_areas_tipoTramiteId_fkey` FOREIGN KEY (`tipoTramiteId`) REFERENCES `tipos_tramite`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tipo_tramite_areas` ADD CONSTRAINT `tipo_tramite_areas_areaId_fkey` FOREIGN KEY (`areaId`) REFERENCES `areas_practica`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tramites` ADD CONSTRAINT `tramites_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tramites` ADD CONSTRAINT `tramites_tipoTramiteId_fkey` FOREIGN KEY (`tipoTramiteId`) REFERENCES `tipos_tramite`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tramites` ADD CONSTRAINT `tramites_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `clientes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tramites` ADD CONSTRAINT `tramites_creadoPorId_fkey` FOREIGN KEY (`creadoPorId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tramites` ADD CONSTRAINT `tramites_responsableId_fkey` FOREIGN KEY (`responsableId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tramites` ADD CONSTRAINT `tramites_casoRelacionadoId_fkey` FOREIGN KEY (`casoRelacionadoId`) REFERENCES `tramites`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `etapas_tramite` ADD CONSTRAINT `etapas_tramite_tramiteId_fkey` FOREIGN KEY (`tramiteId`) REFERENCES `tramites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `etapas_tramite` ADD CONSTRAINT `etapas_tramite_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `actuaciones_judiciales` ADD CONSTRAINT `actuaciones_judiciales_tramiteId_fkey` FOREIGN KEY (`tramiteId`) REFERENCES `tramites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documentos_tramite` ADD CONSTRAINT `documentos_tramite_tramiteId_fkey` FOREIGN KEY (`tramiteId`) REFERENCES `tramites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documentos_tramite` ADD CONSTRAINT `documentos_tramite_generadoDePlantilla_fkey` FOREIGN KEY (`generadoDePlantilla`) REFERENCES `plantillas_documento`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `litigantes` ADD CONSTRAINT `litigantes_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `partes_tramite` ADD CONSTRAINT `partes_tramite_tramiteId_fkey` FOREIGN KEY (`tramiteId`) REFERENCES `tramites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `partes_tramite` ADD CONSTRAINT `partes_tramite_litiganteId_fkey` FOREIGN KEY (`litiganteId`) REFERENCES `litigantes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plantillas_documento` ADD CONSTRAINT `plantillas_documento_tipoTramiteId_fkey` FOREIGN KEY (`tipoTramiteId`) REFERENCES `tipos_tramite`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `permisos` ADD CONSTRAINT `permisos_moduloId_fkey` FOREIGN KEY (`moduloId`) REFERENCES `modulos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rol_empresa_permisos` ADD CONSTRAINT `rol_empresa_permisos_permisoId_fkey` FOREIGN KEY (`permisoId`) REFERENCES `permisos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `usuario_roles_empresa` ADD CONSTRAINT `usuario_roles_empresa_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plan_modulos` ADD CONSTRAINT `plan_modulos_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `planes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plan_modulos` ADD CONSTRAINT `plan_modulos_moduloId_fkey` FOREIGN KEY (`moduloId`) REFERENCES `modulos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plan_cuotas` ADD CONSTRAINT `plan_cuotas_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `planes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `suscripciones` ADD CONSTRAINT `suscripciones_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `suscripciones` ADD CONSTRAINT `suscripciones_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `planes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `suscripcion_modulos` ADD CONSTRAINT `suscripcion_modulos_suscripcionId_fkey` FOREIGN KEY (`suscripcionId`) REFERENCES `suscripciones`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `suscripcion_modulos` ADD CONSTRAINT `suscripcion_modulos_moduloId_fkey` FOREIGN KEY (`moduloId`) REFERENCES `modulos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `suscripcion_cuotas` ADD CONSTRAINT `suscripcion_cuotas_suscripcionId_fkey` FOREIGN KEY (`suscripcionId`) REFERENCES `suscripciones`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clientes` ADD CONSTRAINT `clientes_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clientes` ADD CONSTRAINT `clientes_necesidadTipoTramiteId_fkey` FOREIGN KEY (`necesidadTipoTramiteId`) REFERENCES `tipos_tramite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clientes` ADD CONSTRAINT `clientes_responsableComercialId_fkey` FOREIGN KEY (`responsableComercialId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clientes` ADD CONSTRAINT `clientes_litiganteId_fkey` FOREIGN KEY (`litiganteId`) REFERENCES `litigantes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seguimientos_comerciales` ADD CONSTRAINT `seguimientos_comerciales_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `clientes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comisiones_despacho` ADD CONSTRAINT `comisiones_despacho_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `clientes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fases_comerciales` ADD CONSTRAINT `fases_comerciales_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `clientes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cotizaciones` ADD CONSTRAINT `cotizaciones_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `clientes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cotizaciones` ADD CONSTRAINT `cotizaciones_tipoProcesoId_fkey` FOREIGN KEY (`tipoProcesoId`) REFERENCES `tipos_tramite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contratos_comerciales` ADD CONSTRAINT `contratos_comerciales_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `clientes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contratos_comerciales` ADD CONSTRAINT `contratos_comerciales_cotizacionId_fkey` FOREIGN KEY (`cotizacionId`) REFERENCES `cotizaciones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `configuraciones_cobro` ADD CONSTRAINT `configuraciones_cobro_contratoId_fkey` FOREIGN KEY (`contratoId`) REFERENCES `contratos_comerciales`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `solicitudes_asignacion_proceso` ADD CONSTRAINT `solicitudes_asignacion_proceso_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `clientes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `solicitudes_asignacion_proceso` ADD CONSTRAINT `solicitudes_asignacion_proceso_contratoId_fkey` FOREIGN KEY (`contratoId`) REFERENCES `contratos_comerciales`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `solicitudes_asignacion_proceso` ADD CONSTRAINT `solicitudes_asignacion_proceso_tipoProcesoId_fkey` FOREIGN KEY (`tipoProcesoId`) REFERENCES `tipos_tramite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `solicitudes_asignacion_proceso` ADD CONSTRAINT `solicitudes_asignacion_proceso_procesoId_fkey` FOREIGN KEY (`procesoId`) REFERENCES `tramites`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ingresos` ADD CONSTRAINT `ingresos_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `clientes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `egresos` ADD CONSTRAINT `egresos_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nominas` ADD CONSTRAINT `nominas_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cajas_menores` ADD CONSTRAINT `cajas_menores_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `caja_menor_movimientos` ADD CONSTRAINT `caja_menor_movimientos_cajaId_fkey` FOREIGN KEY (`cajaId`) REFERENCES `cajas_menores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `servicios_fijos` ADD CONSTRAINT `servicios_fijos_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `servicios_fijos_recurrentes` ADD CONSTRAINT `servicios_fijos_recurrentes_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cuentas_bancarias` ADD CONSTRAINT `cuentas_bancarias_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cartera` ADD CONSTRAINT `cartera_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `clientes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `facturas` ADD CONSTRAINT `facturas_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `clientes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `factura_items` ADD CONSTRAINT `factura_items_facturaId_fkey` FOREIGN KEY (`facturaId`) REFERENCES `facturas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prospectos` ADD CONSTRAINT `prospectos_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seguimientos_prospecto` ADD CONSTRAINT `seguimientos_prospecto_prospectoId_fkey` FOREIGN KEY (`prospectoId`) REFERENCES `prospectos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comisiones` ADD CONSTRAINT `comisiones_prospectoId_fkey` FOREIGN KEY (`prospectoId`) REFERENCES `prospectos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contratos` ADD CONSTRAINT `contratos_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contratos` ADD CONSTRAINT `contratos_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `empresas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documentos_contrato` ADD CONSTRAINT `documentos_contrato_contratoId_fkey` FOREIGN KEY (`contratoId`) REFERENCES `contratos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

