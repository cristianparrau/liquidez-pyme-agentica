import { POLITICA } from "./politica.ts"
import type { Empresa, Evaluacion, Factura, Motivo, Oferta, Pagador } from "./tipos.ts"

/**
 * Motor de reglas determinista: decide elegibilidad, si requiere analista y el precio.
 * Es la única fuente de cifras que ve la pyme. El modelo de lenguaje solo las explica.
 */

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000)
}

const MOTIVOS_RADIAN: Record<string, Motivo> = {
  sin_aceptacion: { codigo: "R1-SIN-ACEPTACION", texto: "La factura aún no tiene aceptación del pagador en RADIAN.", accion: "Pide a tu cliente que la acepte o espera la aceptación tácita (3 días hábiles tras el recibo)." },
  endosada: { codigo: "R1-ENDOSADA", texto: "La factura ya fue endosada a otro tenedor en RADIAN.", accion: "No puede financiarse dos veces. Si crees que es un error, contáctanos." },
  embargada: { codigo: "R1-EMBARGADA", texto: "La factura registra un embargo en RADIAN.", accion: "Debe levantarse el embargo antes de negociarla." },
  pagada: { codigo: "R1-PAGADA", texto: "La factura ya figura como pagada.", accion: "No hay nada que adelantar." },
}

export function calcularOferta(valor: number, dias: number, tasaMensual: number): Oferta {
  const anticipo = Math.round(valor * POLITICA.anticipoPct)
  const descuento = Math.round(anticipo * tasaMensual * (dias / 30))
  return {
    valor,
    anticipoPct: POLITICA.anticipoPct,
    anticipo,
    dias,
    tasaMensual,
    descuento,
    neto: anticipo - descuento,
    remanente: valor - anticipo,
    costoEfectivoAnual: Math.round(((1 + tasaMensual) ** 12 - 1) * 10_000) / 10_000,
  }
}

export function evaluarFactura(factura: Factura, pagador: Pagador | undefined, empresa: Empresa, hoy: string, usadoPorPagador = 0): Evaluacion {
  const motivos: Motivo[] = []
  const razonesAnalista: string[] = []
  const dias = diasEntre(hoy, factura.vencimiento)

  const radian = MOTIVOS_RADIAN[factura.estadoRadian]
  if (radian) motivos.push(radian)
  if (!pagador || !pagador.elegible) {
    motivos.push({ codigo: "R2-PAGADOR-NO-ELEGIBLE", texto: `El pagador ${pagador?.nombre ?? "desconocido"} no está en la lista de pagadores elegibles del banco.`, accion: "Por ahora solo financiamos facturas a grandes empresas y entidades evaluadas. Te avisaremos si se habilita." })
  }
  if (dias < POLITICA.diasMinimos) motivos.push({ codigo: "R3-PLAZO-CORTO", texto: `Faltan ${dias} días para el vencimiento; el mínimo es ${POLITICA.diasMinimos}.` })
  if (dias > POLITICA.diasMaximos) motivos.push({ codigo: "R3-PLAZO-LARGO", texto: `Faltan ${dias} días para el vencimiento; el máximo es ${POLITICA.diasMaximos}.` })
  if (factura.valor < POLITICA.montoMinimo || factura.valor > POLITICA.montoMaximo) motivos.push({ codigo: "R4-MONTO", texto: "El valor está fuera del rango del producto ($5 M a $500 M)." })

  const apta = motivos.length === 0 && !!pagador
  if (!apta || !pagador) return { facturaId: factura.id, apta: false, motivos, requiereAnalista: false, razonesAnalista }

  const oferta = calcularOferta(factura.valor, dias, pagador.tasaMensual)
  if (factura.valor > POLITICA.umbralAutomatico) razonesAnalista.push(`R7-UMBRAL: el valor supera el umbral de aprobación automática ($${(POLITICA.umbralAutomatico / 1e6).toFixed(0)} M).`)
  if (oferta.anticipo + usadoPorPagador > pagador.cupoDisponible * POLITICA.concentracionMaxima) razonesAnalista.push(`R8-CONCENTRACION: la operación supera el ${POLITICA.concentracionMaxima * 100} % del cupo disponible del pagador.`)
  if (empresa.centrales.moras12m > POLITICA.morasMaximasCedente) razonesAnalista.push(`R9-CEDENTE: el cedente registra ${empresa.centrales.moras12m} mora(s) en los últimos 12 meses.`)

  return { facturaId: factura.id, apta: true, motivos, requiereAnalista: razonesAnalista.length > 0, razonesAnalista, oferta }
}
