import { z } from "zod"
import { POLITICA } from "../dominio/politica.ts"

/**
 * Grounding de salida: valida, sin modelo de lenguaje, que la respuesta del Asesor solo use cifras
 * que existen en el contexto del caso (generado por el motor de reglas) y que no prometa decisiones.
 * Si la validación falla, la respuesta del modelo NO se muestra: se usa la respuesta de respaldo y se registra.
 */

/** Contrato de salida del Asesor (structured output). El modelo debe devolver exactamente esto. */
export const SalidaAsesorSchema = z.object({
  respuesta: z.string().min(1).max(1200),
  intencion: z.enum(["oferta", "costo", "elegibilidad", "estado", "alternativas", "proceso", "persona", "fuera_de_alcance", "otro"]),
  cifras_citadas: z.array(z.string()).max(20),
  requiere_persona: z.boolean(),
})
export type SalidaAsesor = z.infer<typeof SalidaAsesorSchema>

/** JSON Schema equivalente para el modo JSON del proveedor. */
export const SALIDA_ASESOR_JSON_SCHEMA = {
  type: "object",
  properties: {
    respuesta: { type: "string", description: "Texto para la pyme, máximo 80 palabras, sin markdown." },
    intencion: { type: "string", enum: SalidaAsesorSchema.shape.intencion.options },
    cifras_citadas: { type: "array", items: { type: "string" }, description: "Cada monto, tasa o plazo que aparece en la respuesta, copiado tal cual del CONTEXTO." },
    requiere_persona: { type: "boolean" },
  },
  required: ["respuesta", "intencion", "cifras_citadas", "requiere_persona"],
}

export type CifrasPermitidas = { montos: number[]; porcentajes: number[]; dias: number[]; hayOperacionAprobada: boolean }
export type Violacion = { tipo: "monto" | "porcentaje" | "dias" | "promesa" | "esquema"; valor: string }
export type ResultadoGrounding = { ok: boolean; violaciones: Violacion[]; cifrasRevisadas: number }

/** Cifras de política que el Asesor siempre puede mencionar. */
export function cifrasBase(): CifrasPermitidas {
  return {
    montos: [POLITICA.montoMinimo, POLITICA.montoMaximo, POLITICA.umbralAutomatico],
    porcentajes: [POLITICA.anticipoPct * 100, POLITICA.concentracionMaxima * 100, 1.8],
    dias: [POLITICA.diasMinimos, POLITICA.diasMaximos, 30, 60, 3],
    hayOperacionAprobada: false,
  }
}

const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."))

/** Extrae montos en pesos: "$34.200.000", "$34,2 M", "34,2 millones", "$1.200 millones". */
export function extraerMontos(texto: string): { valor: number; crudo: string }[] {
  const salida: { valor: number; crudo: string }[] = []
  const re = /(\$\s?)?(\d{1,3}(?:\.\d{3})+|\d+(?:,\d+)?)\s*(millones|mill\.|M\b|mil\b)?/gi
  for (const m of texto.matchAll(re)) {
    const [crudo, signo, cifra, escala] = m
    if (!signo && !escala) continue // un número suelto no es un monto
    let v = num(cifra!)
    const e = (escala ?? "").toLowerCase()
    if (e.startsWith("mill") || e === "m") v *= 1_000_000
    else if (e === "mil") v *= 1_000
    if (v < 1000) continue
    salida.push({ valor: v, crudo: crudo.trim() })
  }
  return salida
}
export const extraerPorcentajes = (t: string) => [...t.matchAll(/(\d+(?:[.,]\d+)?)\s?%/g)].map((m) => ({ valor: Number(m[1]!.replace(",", ".")), crudo: m[0] }))
export const extraerDias = (t: string) => [...t.matchAll(/(\d+)\s+d[ií]as/gi)].map((m) => ({ valor: Number(m[1]), crudo: m[0] }))

const PROMESAS: RegExp[] = [
  /\b(te|le|les)\s+(aprobamos|aprobaremos|garantizamos|aseguramos)\b/i,
  /\bgarantizad[oa]s?\b/i,
  /\baprobaci[oó]n\s+(segura|garantizada|asegurada)\b/i,
  /\b(seguro|seguramente)\s+(te|le)\s+(aprueban|aprobar[aá]n)\b/i,
  /\bsin\s+(ning[uú]n\s+)?riesgo\s+de\s+rechazo\b/i,
]
const APROBADA = /\b(est[aá]|queda|qued[oó]|fue)\s+(pre)?aprobad[oa]\b/i

export function validarRespuesta(texto: string, permitidas: CifrasPermitidas, mensajeUsuario = ""): ResultadoGrounding {
  const violaciones: Violacion[] = []
  // Las cifras que escribió la propia pyme se pueden repetir.
  const delUsuario = { montos: extraerMontos(mensajeUsuario).map((x) => x.valor), pct: extraerPorcentajes(mensajeUsuario).map((x) => x.valor), dias: extraerDias(mensajeUsuario).map((x) => x.valor) }
  const montos = [...permitidas.montos, ...delUsuario.montos]
  const cerca = (v: number, lista: number[], tol: (x: number) => number) => lista.some((x) => Math.abs(x - v) <= tol(x))
  // Tolerancia para redondeos tipo "$34,2 M": 0,5 % o $100.000, lo que sea mayor.
  const tolMonto = (x: number) => Math.max(100_000, Math.abs(x) * 0.005)

  const ms = extraerMontos(texto), ps = extraerPorcentajes(texto), ds = extraerDias(texto)
  for (const m of ms) if (!cerca(m.valor, montos, tolMonto)) violaciones.push({ tipo: "monto", valor: m.crudo })
  for (const p of ps) if (!cerca(p.valor, [...permitidas.porcentajes, ...delUsuario.pct], () => 0.06)) violaciones.push({ tipo: "porcentaje", valor: p.crudo })
  for (const d of ds) if (![...permitidas.dias, ...delUsuario.dias].includes(d.valor)) violaciones.push({ tipo: "dias", valor: d.crudo })
  for (const re of PROMESAS) {
    const m = texto.match(re)
    if (m) violaciones.push({ tipo: "promesa", valor: m[0] })
  }
  const ap = texto.match(APROBADA)
  if (ap && !permitidas.hayOperacionAprobada) violaciones.push({ tipo: "promesa", valor: ap[0] })
  return { ok: violaciones.length === 0, violaciones, cifrasRevisadas: ms.length + ps.length + ds.length }
}

/** Parsea y valida la salida estructurada del modelo. Tolera bloques ```json. */
export function parsearSalida(texto: string): { ok: true; salida: SalidaAsesor } | { ok: false; error: string } {
  const limpio = texto.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim()
  let json: unknown
  try {
    json = JSON.parse(limpio)
  } catch {
    return { ok: false, error: "la salida no es JSON" }
  }
  const r = SalidaAsesorSchema.safeParse(json)
  return r.success ? { ok: true, salida: r.data } : { ok: false, error: `no cumple el esquema: ${r.error.issues.map((i) => i.path.join(".")).join(", ")}` }
}
