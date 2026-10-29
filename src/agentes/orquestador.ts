import { randomUUID } from "node:crypto"
import { DOCUMENTO_MALICIOSO, FECHA_REFERENCIA, empresa, facturasDe, pagador, FACTURAS } from "../dominio/datos.ts"
import { evaluarFactura, diasEntre } from "../dominio/motor.ts"
import { POLITICA } from "../dominio/politica.ts"
import { revisarTexto } from "../dominio/guardian.ts"
import type { AgenteId, Caso, Evento, ItemBandeja, Nivel, Resultado, TipoBandeja } from "../dominio/tipos.ts"

/**
 * Orquestador del caso. Cada función corresponde a un agente con sus herramientas y su nivel de autonomía.
 * Las herramientas consultan sistemas simulados; el motor de reglas es real y determinista.
 * Ninguna función de aquí recibe instrucciones del modelo de lenguaje: solo acciones de la pyme o de una persona del banco.
 */

export class ErrorNegocio extends Error {}

const casos = new Map<string, Caso>()
const bandeja = new Map<string, ItemBandeja>()
const ahora = () => new Date().toISOString()

function registrar(caso: Caso, agente: AgenteId, accion: string, resultado: Resultado, detalle: string, extra: { herramienta?: string; sistema?: string; nivel?: Nivel; datos?: Record<string, unknown> } = {}): Evento {
  const evento: Evento = { id: caso.eventos.length + 1, t: ahora(), agente, accion, resultado, detalle, ...extra }
  caso.eventos.push(evento)
  return evento
}

function abrirItem(caso: Caso, tipo: TipoBandeja, titulo: string, motivo: string, contexto: Record<string, unknown>, facturaId?: string): ItemBandeja {
  const item: ItemBandeja = { id: randomUUID().slice(0, 8), casoId: caso.id, tipo, titulo, motivo, contexto, creado: ahora(), estado: "pendiente", facturaId }
  bandeja.set(item.id, item)
  return item
}

export function obtenerCaso(id: string): Caso {
  const caso = casos.get(id)
  if (!caso) throw new ErrorNegocio("Caso no encontrado.")
  return caso
}

export const listarBandeja = () => [...bandeja.values()].sort((a, b) => (a.estado === b.estado ? b.creado.localeCompare(a.creado) : a.estado === "pendiente" ? -1 : 1))

/** Limpia el estado en memoria (pruebas y botón "reiniciar demo"). */
export function reiniciar(): void {
  casos.clear()
  bandeja.clear()
}

// ── Agente KYC ────────────────────────────────────────────────────────────────
export function iniciarCaso(empresaId: string, consentimientos: { dian?: boolean; rues?: boolean; centrales?: boolean }): Caso {
  const e = empresa(empresaId)
  if (!e) throw new ErrorNegocio("Empresa no encontrada.")
  if (!consentimientos.dian || !consentimientos.rues || !consentimientos.centrales) throw new ErrorNegocio("Se requieren las tres autorizaciones para continuar.")
  const caso: Caso = {
    id: randomUUID().slice(0, 8),
    empresaId,
    creado: ahora(),
    consentimientos: { dian: true, rues: true, centrales: true, version: "autorizacion-v1.2", fecha: ahora() },
    estado: "kyc_ok",
    eventos: [],
    evaluaciones: [],
    operaciones: [],
    documentos: [],
  }
  casos.set(caso.id, caso)
  registrar(caso, "pyme", "Autorizó el tratamiento de datos", "ok", "Consulta a DIAN/RADIAN, RUES y centrales de riesgo (Ley 1581 de 2012 y Ley 1266 de 2008).", { sistema: "Registro de consentimientos", datos: { version: caso.consentimientos.version } })

  registrar(caso, "kyc", "Consultó el registro mercantil", e.rues.estado === "activa" ? "ok" : "alerta", `${e.nombre} · matrícula ${e.rues.estado}.`, { herramienta: "consultar_rues", sistema: "RUES", nivel: "ejecuta" })
  const coincideRepresentante = e.rues.representanteLegal.documento === e.solicitante.documento
  registrar(caso, "kyc", "Validó la identidad del solicitante", coincideRepresentante ? "ok" : "alerta",
    coincideRepresentante ? `${e.solicitante.nombre} es el representante legal inscrito.` : `El solicitante (${e.solicitante.cargo}) no es el representante legal inscrito en el RUES.`,
    { herramienta: "validar_identidad", sistema: "RUES + validación de identidad", nivel: "ejecuta" })
  registrar(caso, "kyc", "Consultó listas restrictivas", e.listas.coincidencia ? "alerta" : "ok", e.listas.coincidencia ? (e.listas.detalle ?? "Coincidencia en listas.") : "Sin coincidencias en ONU, OFAC ni PEP.", { herramienta: "consultar_listas", sistema: "Listas SARLAFT", nivel: "ejecuta" })

  const alertas = [!coincideRepresentante && "Solicitante distinto del representante legal", e.listas.coincidencia && "Coincidencia en listas restrictivas", e.rues.estado !== "activa" && "Matrícula no activa"].filter(Boolean) as string[]
  if (alertas.length > 0) {
    caso.estado = "en_revision_cumplimiento"
    const item = abrirItem(caso, "cumplimiento", `Alerta KYC · ${e.nombre}`, alertas.join(" · "), { empresa: e.nombre, solicitante: `${e.solicitante.nombre} (${e.solicitante.cargo})`, representanteLegal: e.rues.representanteLegal.nombre, listas: e.listas.detalle ?? "—" })
    registrar(caso, "kyc", "Transfirió el caso al oficial de cumplimiento", "pase_humano", "El agente no puede descartar alertas de cumplimiento. El caso queda en pausa hasta la decisión humana.", { nivel: "recomienda", datos: { bandeja: item.id, alertas } })
  } else {
    registrar(caso, "kyc", "Verificación completada", "ok", "Empresa y representante legal verificados.", { nivel: "ejecuta" })
  }
  return caso
}

// ── Agentes Verificador y Riesgo ───────────────────────────────────────────────
export function evaluarFacturas(casoId: string): Caso {
  const caso = obtenerCaso(casoId)
  if (caso.estado === "en_revision_cumplimiento") throw new ErrorNegocio("El caso está en revisión de cumplimiento.")
  if (caso.estado === "bloqueado") throw new ErrorNegocio("El caso fue cerrado por cumplimiento.")
  const e = empresa(caso.empresaId)!
  const facturas = facturasDe(e.id)
  registrar(caso, "verificador", "Listó facturas electrónicas emitidas", "ok", `${facturas.length} facturas de venta con vencimiento futuro.`, { herramienta: "listar_facturas_dian", sistema: "DIAN · factura electrónica", nivel: "ejecuta" })

  const usado = new Map<string, number>()
  caso.evaluaciones = facturas.map((f) => {
    const p = pagador(f.pagadorId)
    registrar(caso, "verificador", `Consultó ${f.numero} en RADIAN`, f.estadoRadian === "aceptada" ? "ok" : "alerta", f.estadoRadian === "endosada" ? `Estado: endosada a ${f.endosatario}.` : `Estado: ${f.estadoRadian.replace("_", " ")}.`, { herramienta: "consultar_radian", sistema: "RADIAN", nivel: "ejecuta", datos: { factura: f.numero } })
    registrar(caso, "verificador", `Verificó el pagador de ${f.numero}`, p?.elegible ? "ok" : "alerta", p?.elegible ? `${p.nombre} · calificación ${p.calificacion} · elegible.` : `${p?.nombre ?? "Desconocido"} · no elegible.`, { herramienta: "verificar_pagador", sistema: "Lista de pagadores elegibles", nivel: "ejecuta" })
    const ev = evaluarFactura(f, p, e, FECHA_REFERENCIA, usado.get(f.pagadorId) ?? 0)
    if (ev.oferta) usado.set(f.pagadorId, (usado.get(f.pagadorId) ?? 0) + ev.oferta.anticipo)
    return ev
  })
  registrar(caso, "riesgo", "Consultó centrales de riesgo del cedente", e.centrales.moras12m > 0 ? "alerta" : "ok", `Puntaje ${e.centrales.puntaje} · ${e.centrales.moras12m} mora(s) en 12 meses.`, { herramienta: "consultar_centrales", sistema: "Centrales de riesgo", nivel: "ejecuta" })
  const aptas = caso.evaluaciones.filter((v) => v.apta)
  registrar(caso, "riesgo", "Aplicó la política de riesgo y calculó ofertas", "ok", `${aptas.length} de ${caso.evaluaciones.length} facturas aptas · ${aptas.filter((v) => v.requiereAnalista).length} requieren analista. Política ${POLITICA.version}.`, { herramienta: "motor_reglas + calcular_oferta", sistema: "Motor de reglas (determinista)", nivel: "recomienda", datos: { reglas: caso.evaluaciones.flatMap((v) => [...v.motivos.map((m) => m.codigo), ...v.razonesAnalista.map((r) => r.split(":")[0])]) } })
  caso.estado = "evaluado"
  return caso
}

// ── Guardián: documentos adjuntos ──────────────────────────────────────────────
export function adjuntarDocumento(casoId: string, nombre: string, texto: string): Caso {
  const caso = obtenerCaso(casoId)
  const revision = revisarTexto(texto)
  caso.documentos.push({ nombre, sospechoso: revision.sospechoso, coincidencias: revision.coincidencias, recibido: ahora() })
  if (revision.sospechoso) {
    registrar(caso, "guardian", `Bloqueó instrucciones dentro de ${nombre}`, "bloqueo", "El documento contiene texto que intenta dar órdenes al agente. Se trata como dato: no cambia ninguna decisión, cupo ni precio.", { herramienta: "revisar_documento", sistema: "Guardián (reglas, sin modelo)", datos: { patrones: revision.coincidencias } })
    const item = abrirItem(caso, "cumplimiento", `Posible intento de manipulación · ${empresa(caso.empresaId)!.nombre}`, "Documento con instrucciones dirigidas al agente", { documento: nombre, patrones: revision.coincidencias.join(", ") })
    registrar(caso, "guardian", "Notificó a cumplimiento (informativo)", "pase_humano", "El flujo de la pyme sigue con las reglas normales; cumplimiento revisa el intento.", { datos: { bandeja: item.id } })
  } else {
    registrar(caso, "guardian", `Revisó ${nombre}`, "ok", "Sin instrucciones sospechosas. Se guarda como soporte.", { herramienta: "revisar_documento", sistema: "Guardián" })
  }
  return caso
}
export const documentoDemo = () => DOCUMENTO_MALICIOSO

// ── Agente de Formalización ────────────────────────────────────────────────────
function formalizar(caso: Caso, facturaId: string): void {
  const op = caso.operaciones.find((o) => o.facturaId === facturaId)!
  const f = FACTURAS.find((x) => x.id === facturaId)!
  registrar(caso, "formalizacion", `Generó contrato y endoso de ${f.numero}`, "ok", "Contrato marco de factoring sin responsabilidad + endoso electrónico.", { herramienta: "generar_contrato", sistema: "Gestor documental", nivel: "ejecuta" })
  registrar(caso, "formalizacion", "Firma electrónica completada", "ok", "La pyme firmó con su certificado (simulado).", { herramienta: "solicitar_firma", sistema: "Firma electrónica", nivel: "ejecuta" })
  registrar(caso, "formalizacion", `Registró el endoso de ${f.numero}`, "ok", "Nuevo tenedor legítimo: el banco.", { herramienta: "registrar_endoso", sistema: "RADIAN", nivel: "ejecuta" })
  op.estado = "desembolsada"
  op.desembolso = ahora()
  registrar(caso, "formalizacion", "Desembolsó el anticipo neto", "ok", `$${op.oferta.neto.toLocaleString("es-CO")} a la cuenta registrada de la empresa.`, { herramienta: "solicitar_desembolso", sistema: "Core bancario", nivel: "ejecuta", datos: { factura: f.numero, neto: op.oferta.neto } })
  registrar(caso, "acompanamiento", `Programó seguimiento de ${f.numero}`, "info", `Avisará el pago del pagador (vence ${f.vencimiento}) y liberará el remanente de $${op.oferta.remanente.toLocaleString("es-CO")}.`, { herramienta: "programar_seguimiento", sistema: "RADIAN + CRM", nivel: "informa" })
}

export function aceptarOferta(casoId: string, facturaIds: string[], confirmacion: boolean): Caso {
  const caso = obtenerCaso(casoId)
  if (!confirmacion) throw new ErrorNegocio("La pyme debe confirmar expresamente la oferta.")
  if (caso.estado !== "evaluado" && caso.estado !== "en_curso") throw new ErrorNegocio("El caso aún no tiene ofertas.")
  const seleccion = caso.evaluaciones.filter((v) => facturaIds.includes(v.facturaId) && v.apta && v.oferta)
  if (seleccion.length === 0) throw new ErrorNegocio("Selecciona al menos una factura apta.")
  caso.estado = "en_curso"
  registrar(caso, "pyme", "Aceptó la oferta", "ok", `${seleccion.length} factura(s) seleccionadas con confirmación expresa.`)
  for (const ev of seleccion) {
    if (caso.operaciones.some((o) => o.facturaId === ev.facturaId)) continue
    const f = FACTURAS.find((x) => x.id === ev.facturaId)!
    if (ev.requiereAnalista) {
      caso.operaciones.push({ facturaId: ev.facturaId, estado: "pendiente_analista", oferta: ev.oferta! })
      const item = abrirItem(caso, "analista", `Aprobación · ${f.numero} · $${(f.valor / 1e6).toFixed(0)} M`, ev.razonesAnalista.join(" "), { empresa: empresa(caso.empresaId)!.nombre, pagador: pagador(f.pagadorId)!.nombre, valor: f.valor, anticipo: ev.oferta!.anticipo, neto: ev.oferta!.neto, tasaMensual: ev.oferta!.tasaMensual, dias: ev.oferta!.dias }, ev.facturaId)
      registrar(caso, "riesgo", `Transfirió ${f.numero} al analista de crédito`, "pase_humano", ev.razonesAnalista.join(" "), { nivel: "recomienda", datos: { bandeja: item.id } })
    } else {
      caso.operaciones.push({ facturaId: ev.facturaId, estado: "aprobada", oferta: ev.oferta! })
      registrar(caso, "riesgo", `Aprobó ${f.numero} dentro de política`, "ok", "Aprobación automática del motor de reglas: dentro de umbral, cupo y política.", { herramienta: "motor_reglas", sistema: "Motor de reglas (determinista)", nivel: "decide" })
      formalizar(caso, ev.facturaId)
    }
  }
  return caso
}

// ── Decisiones humanas ─────────────────────────────────────────────────────────
export function decidir(itemId: string, decision: "aprobar" | "rechazar" | "atendido", nota: string, responsable: string): ItemBandeja {
  const item = bandeja.get(itemId)
  if (!item) throw new ErrorNegocio("Elemento no encontrado.")
  if (item.estado === "resuelto") throw new ErrorNegocio("Este elemento ya fue resuelto.")
  if (!nota.trim()) throw new ErrorNegocio("La decisión requiere una nota de justificación.")
  const caso = obtenerCaso(item.casoId)
  Object.assign(item, { estado: "resuelto", decision, nota: nota.slice(0, 500), resueltoPor: responsable })
  const sello = { nivel: "decide" as const, datos: { bandeja: item.id, responsable } }

  if (item.tipo === "analista" && item.facturaId) {
    const op = caso.operaciones.find((o) => o.facturaId === item.facturaId)!
    if (decision === "aprobar") {
      op.estado = "aprobada"
      registrar(caso, "humano", "Analista de crédito aprobó la operación", "ok", nota, sello)
      formalizar(caso, item.facturaId)
    } else {
      op.estado = "rechazada"
      op.nota = nota
      registrar(caso, "humano", "Analista de crédito rechazó la operación", "alerta", nota, sello)
    }
  } else if (item.tipo === "cumplimiento" && caso.estado === "en_revision_cumplimiento") {
    caso.estado = decision === "aprobar" ? "kyc_ok" : "bloqueado"
    registrar(caso, "humano", decision === "aprobar" ? "Oficial de cumplimiento levantó la alerta" : "Oficial de cumplimiento cerró el caso", decision === "aprobar" ? "ok" : "bloqueo", nota, sello)
  } else {
    registrar(caso, "humano", `${item.tipo === "gestor" ? "Gestor de relación" : "Cumplimiento"} atendió el caso`, "info", nota, sello)
  }
  return item
}

// ── Agente Asesor: pase a una persona a pedido de la pyme ─────────────────────
export function pedirPersona(casoId: string, motivo: string): ItemBandeja {
  const caso = obtenerCaso(casoId)
  const item = abrirItem(caso, "gestor", `Contacto solicitado · ${empresa(caso.empresaId)!.nombre}`, motivo.slice(0, 300) || "La pyme pidió hablar con una persona.", { estado: caso.estado })
  registrar(caso, "asesor", "Transfirió la conversación a un gestor de relación", "pase_humano", "La pyme pidió hablar con una persona. Un gestor la contactará con el contexto del caso.", { nivel: "recomienda", datos: { bandeja: item.id } })
  return item
}

// ── Agente de Acompañamiento ───────────────────────────────────────────────────
export function simularPago(casoId: string, facturaId: string): Caso {
  const caso = obtenerCaso(casoId)
  const op = caso.operaciones.find((o) => o.facturaId === facturaId && o.estado === "desembolsada")
  if (!op) throw new ErrorNegocio("No hay una operación desembolsada para esa factura.")
  const f = FACTURAS.find((x) => x.id === facturaId)!
  op.estado = "pagada"
  registrar(caso, "acompanamiento", `Detectó el pago de ${f.numero}`, "ok", `${pagador(f.pagadorId)!.nombre} pagó $${f.valor.toLocaleString("es-CO")} en la fecha de vencimiento.`, { herramienta: "consultar_eventos_radian", sistema: "RADIAN", nivel: "informa" })
  registrar(caso, "acompanamiento", "Liberó el remanente", "ok", `$${op.oferta.remanente.toLocaleString("es-CO")} transferidos a la empresa.`, { herramienta: "liberar_remanente", sistema: "Core bancario", nivel: "ejecuta" })
  const pendientes = caso.evaluaciones.filter((v) => v.apta && !caso.operaciones.some((o) => o.facturaId === v.facturaId))
  registrar(caso, "acompanamiento", "Sugirió el siguiente paso", "info", pendientes.length ? `Tienes ${pendientes.length} factura(s) apta(s) más que puedes adelantar.` : "Cuando emitas nuevas facturas a tus clientes grandes, te avisaremos si son aptas.", { herramienta: "sugerir_facturas", nivel: "recomienda" })
  return caso
}

/** Vista del caso para el front: une evaluaciones con los datos de factura y pagador. */
export function vistaCaso(caso: Caso) {
  const e = empresa(caso.empresaId)!
  return {
    ...caso,
    empresa: { id: e.id, nombre: e.nombre, nit: e.nit, tamano: e.tamano, sector: e.sector, ciudad: e.ciudad },
    hoy: FECHA_REFERENCIA,
    facturas: caso.evaluaciones.map((v) => {
      const f = FACTURAS.find((x) => x.id === v.facturaId)!
      const p = pagador(f.pagadorId)
      return { ...v, numero: f.numero, valor: f.valor, vencimiento: f.vencimiento, dias: diasEntre(FECHA_REFERENCIA, f.vencimiento), pagador: p?.nombre ?? "—", calificacion: p?.calificacion ?? null, estadoRadian: f.estadoRadian, operacion: caso.operaciones.find((o) => o.facturaId === v.facturaId) ?? null }
    }),
    pendientesHumanos: listarBandeja().filter((i) => i.casoId === caso.id && i.estado === "pendiente").map((i) => ({ id: i.id, tipo: i.tipo, titulo: i.titulo })),
  }
}
