import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as o from "../src/agentes/orquestador.ts"
import { responder } from "../src/agentes/asesor.ts"
import { parsearSalida, validarRespuesta, cifrasBase, extraerMontos } from "../src/agentes/grounding.ts"
import { metricas } from "../src/agentes/metricas.ts"
import type { ProveedorLLM } from "../src/llm/adapter.ts"

const AUT = { dian: true, rues: true, centrales: true }
beforeEach(() => o.reiniciar())

/** Modelo simulado que devuelve siempre el texto dado. */
const falso = (texto: string): ProveedorLLM => ({ nombre: "falso", modelo: "falso", enviar: async () => ({ texto, llamadas: [], tokens: 10 }) })
const salida = (respuesta: string, extra: Record<string, unknown> = {}) => JSON.stringify({ respuesta, intencion: "costo", cifras_citadas: [], requiere_persona: false, ...extra })

test("extrae montos en sus formatos habituales", () => {
  assert.deepEqual(extraerMontos("$34.200.000, $34,2 M y 34,2 millones").map((m) => m.valor), [34_200_000, 34_200_000, 34_200_000])
  assert.deepEqual(extraerMontos("FE-1041 vence en 37 días"), [])
})

test("cifras de política permitidas sin caso; inventadas bloqueadas", () => {
  assert.equal(validarRespuesta("El umbral es de $100 M y el plazo máximo de 90 días.", cifrasBase()).ok, true)
  assert.equal(validarRespuesta("Te podemos prestar $250 millones.", cifrasBase()).ok, false)
})

test("salida que no cumple el esquema se rechaza", () => {
  assert.equal(parsearSalida("Hola, tu oferta es buena").ok, false)
  assert.equal(parsearSalida(salida("ok")).ok, true)
  assert.equal(parsearSalida("```json\n" + salida("ok") + "\n```").ok, true)
})

test("Asesor: respuesta del modelo fundamentada llega a la pyme", async () => {
  const c = o.iniciarCaso("andina", AUT)
  o.evaluarFacturas(c.id)
  const r = await responder(falso(salida("En FE-1041 recibes hoy $33.525.120.", { cifras_citadas: ["$33.525.120"] })), "¿cuánto recibo?", c.id)
  assert.equal(r.fuente, "modelo")
  assert.equal(r.grounding?.ok, true)
})

test("Asesor: cifra inventada por el modelo se bloquea, se usa respaldo y queda en auditoría", async () => {
  const c = o.iniciarCaso("andina", AUT)
  o.evaluarFacturas(c.id)
  const antes = metricas.bloqueadasGrounding
  const r = await responder(falso(salida("En FE-1041 recibes hoy $40.000.000.")), "¿cuánto recibo?", c.id)
  assert.equal(r.fuente, "respaldo")
  assert.match(r.motivo ?? "", /grounding/)
  assert.equal(metricas.bloqueadasGrounding, antes + 1)
  assert.ok(c.eventos.some((e) => e.accion.includes("grounding") && e.resultado === "bloqueo"))
})

test("Asesor: promesa de aprobación se bloquea", async () => {
  const c = o.iniciarCaso("andina", AUT)
  o.evaluarFacturas(c.id)
  assert.equal((await responder(falso(salida("Tranquila, te aprobamos la FE-1052.")), "¿me aprueban?", c.id)).fuente, "respaldo")
})

test("Asesor: salida fuera de contrato se descarta", async () => {
  const c = o.iniciarCaso("andina", AUT)
  o.evaluarFacturas(c.id)
  const r = await responder(falso("Claro, tu oferta es muy buena"), "¿qué tal mi oferta?", c.id)
  assert.equal(r.fuente, "respaldo")
  assert.match(r.motivo ?? "", /JSON/)
})

test("Asesor: si el modelo excede el presupuesto de tiempo, responde el respaldo", async () => {
  process.env.ASESOR_PRESUPUESTO_MS = "50"
  const c = o.iniciarCaso("andina", AUT)
  o.evaluarFacturas(c.id)
  const lento: ProveedorLLM = { nombre: "lento", modelo: "lento", enviar: () => new Promise((r) => setTimeout(() => r({ texto: "{}", llamadas: [], tokens: 0 }), 500)) }
  const r = await responder(lento, "¿cuánto recibo?", c.id)
  delete process.env.ASESOR_PRESUPUESTO_MS
  assert.equal(r.fuente, "respaldo")
  assert.match(r.motivo ?? "", /tardó/)
})
