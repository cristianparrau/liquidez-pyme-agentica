/** Política de producto y riesgo del piloto. La define el comité de riesgo; el modelo de lenguaje no puede cambiarla. */
export const POLITICA = {
  version: "piloto-1.0",
  montoMinimo: 5_000_000,
  montoMaximo: 500_000_000,
  diasMinimos: 15,
  diasMaximos: 90,
  anticipoPct: 0.9,
  umbralAutomatico: 100_000_000, // por encima, aprueba un analista
  concentracionMaxima: 0.3, // proporción del cupo disponible del pagador
  morasMaximasCedente: 0, // con moras en 12 meses, revisa un analista
} as const
