/** Métricas en vivo del Asesor (en memoria): alimentan el tablero de calidad de la vista banco. */
export type Metricas = {
  mensajes: number
  respuestasModelo: number
  bloqueadasGrounding: number
  esquemaInvalido: number
  bloqueadasGuardian: number
  respaldoPorFalla: number
  pasesAHumano: number
  latenciaModeloMs: number[]
  ultimasViolaciones: { t: string; valor: string; tipo: string }[]
}
const vacias = (): Metricas => ({ mensajes: 0, respuestasModelo: 0, bloqueadasGrounding: 0, esquemaInvalido: 0, bloqueadasGuardian: 0, respaldoPorFalla: 0, pasesAHumano: 0, latenciaModeloMs: [], ultimasViolaciones: [] })
export let metricas: Metricas = vacias()
export function reiniciarMetricas(): void {
  metricas = vacias()
}
export const copiarMetricas = (): Metricas => structuredClone(metricas)
export function restaurarMetricas(m: Metricas): void {
  metricas = m
}
export function resumenMetricas() {
  const l = [...metricas.latenciaModeloMs].sort((a, b) => a - b)
  const p = (q: number) => (l.length ? l[Math.min(l.length - 1, Math.floor(q * l.length))]! : 0)
  const llamadas = metricas.respuestasModelo + metricas.bloqueadasGrounding + metricas.esquemaInvalido
  return {
    ...metricas,
    latenciaModeloMs: undefined,
    latenciaP50Ms: p(0.5),
    latenciaP95Ms: p(0.95),
    tasaBloqueoGrounding: llamadas ? metricas.bloqueadasGrounding / llamadas : 0,
  }
}
