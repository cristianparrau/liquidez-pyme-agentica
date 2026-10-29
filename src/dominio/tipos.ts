/** Modelo de dominio del prototipo "Adelanto de facturas". Todos los montos en pesos colombianos (COP). */

export type AgenteId = "guardian" | "asesor" | "kyc" | "verificador" | "riesgo" | "formalizacion" | "acompanamiento" | "humano" | "pyme"
export type Nivel = "informa" | "recomienda" | "ejecuta" | "decide"
export type Resultado = "ok" | "info" | "alerta" | "bloqueo" | "pase_humano"

/** Un paso visible en el panel "¿Qué está haciendo el agente?" y en el registro de auditoría. */
export type Evento = {
  id: number
  t: string
  agente: AgenteId
  accion: string
  herramienta?: string
  sistema?: string
  nivel?: Nivel
  resultado: Resultado
  detalle: string
  datos?: Record<string, unknown>
}

export type Empresa = {
  id: string
  nombre: string
  nit: string
  tamano: "pequeña" | "mediana"
  sector: string
  ciudad: string
  antiguedadAnios: number
  solicitante: { nombre: string; documento: string; cargo: string }
  rues: { estado: "activa" | "inactiva"; representanteLegal: { nombre: string; documento: string } }
  listas: { coincidencia: boolean; detalle?: string }
  centrales: { puntaje: number; moras12m: number }
  escenario: string
}

export type Pagador = {
  id: string
  nombre: string
  nit: string
  tipo: "gran empresa" | "entidad pública" | "mediana"
  calificacion: "A" | "B" | null
  elegible: boolean
  cupoDisponible: number
  tasaMensual: number
}

export type EstadoRadian = "aceptada" | "sin_aceptacion" | "endosada" | "embargada" | "pagada"

export type Factura = {
  id: string
  empresaId: string
  numero: string
  pagadorId: string
  valor: number
  emision: string
  vencimiento: string
  estadoRadian: EstadoRadian
  endosatario?: string
}

export type Motivo = { codigo: string; texto: string; accion?: string }

export type Oferta = {
  valor: number
  anticipoPct: number
  anticipo: number
  dias: number
  tasaMensual: number
  descuento: number
  neto: number
  remanente: number
  costoEfectivoAnual: number
}

export type Evaluacion = {
  facturaId: string
  apta: boolean
  motivos: Motivo[]
  requiereAnalista: boolean
  razonesAnalista: string[]
  oferta?: Oferta
}

export type EstadoOperacion = "pendiente_analista" | "aprobada" | "rechazada" | "desembolsada" | "pagada"
export type Operacion = { facturaId: string; estado: EstadoOperacion; oferta: Oferta; desembolso?: string; nota?: string }

export type EstadoCaso =
  | "kyc_ok"
  | "en_revision_cumplimiento"
  | "bloqueado"
  | "evaluado"
  | "en_curso"

export type Documento = { nombre: string; sospechoso: boolean; coincidencias: string[]; recibido: string }

export type Caso = {
  id: string
  empresaId: string
  creado: string
  consentimientos: { dian: boolean; rues: boolean; centrales: boolean; version: string; fecha: string }
  estado: EstadoCaso
  eventos: Evento[]
  evaluaciones: Evaluacion[]
  operaciones: Operacion[]
  documentos: Documento[]
}

export type TipoBandeja = "analista" | "cumplimiento" | "operaciones" | "gestor"
export type ItemBandeja = {
  id: string
  casoId: string
  tipo: TipoBandeja
  titulo: string
  motivo: string
  contexto: Record<string, unknown>
  creado: string
  estado: "pendiente" | "resuelto"
  decision?: "aprobar" | "rechazar" | "atendido"
  nota?: string
  resueltoPor?: string
  facturaId?: string
}
