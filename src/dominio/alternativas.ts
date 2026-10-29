/**
 * Comparador de alternativas de liquidez para la etapa de orientación.
 * Las tasas son referencias de mercado (supuestos del prototipo), no ofertas.
 */
export type Alternativa = {
  id: string
  nombre: string
  tasaMensual: number
  costoTotal: number
  tiempo: string
  requisitos: string
  encaja: boolean
  nota: string
}

export type EntradaSimulador = { porCobrar: number; diasCobro: number; necesidad: number; clientesGrandes: boolean }

const mensualDesdeEA = (ea: number) => (1 + ea) ** (1 / 12) - 1

export function compararAlternativas(e: EntradaSimulador) {
  const meses = Math.max(e.diasCobro, 1) / 30
  const monto = Math.max(e.necesidad, 0)
  const costo = (tasa: number) => Math.round(monto * tasa * meses)
  const opciones: Alternativa[] = [
    {
      id: "adelanto",
      nombre: "Adelanto de facturas",
      tasaMensual: 0.018,
      costoTotal: costo(0.018),
      tiempo: "Mismo día",
      requisitos: "Facturas electrónicas aceptadas a clientes grandes",
      encaja: e.clientesGrandes && e.diasCobro <= 90,
      nota: "No es deuda nueva: adelantas un dinero que ya ganaste.",
    },
    {
      id: "credito",
      nombre: "Crédito de capital de trabajo",
      tasaMensual: mensualDesdeEA(0.24),
      costoTotal: costo(mensualDesdeEA(0.24)),
      tiempo: "1 a 3 semanas",
      requisitos: "Estados financieros, garantías y estudio de crédito",
      encaja: e.diasCobro > 90 || !e.clientesGrandes,
      nota: "Conviene para necesidades de más de 3 meses o inversión.",
    },
    {
      id: "sobregiro",
      nombre: "Sobregiro o tarjeta empresarial",
      tasaMensual: mensualDesdeEA(0.2859),
      costoTotal: costo(mensualDesdeEA(0.2859)),
      tiempo: "Inmediato",
      requisitos: "Cupo preaprobado en tu banco",
      encaja: false,
      nota: "Rápido pero caro; útil solo para pocos días.",
    },
  ]
  const recomendada = opciones.find((o) => o.encaja && o.id === "adelanto") ?? opciones.find((o) => o.encaja) ?? opciones[1]!
  return { meses: Math.round(meses * 10) / 10, liquidezAtrapada: e.porCobrar, opciones, recomendada: recomendada.id }
}
