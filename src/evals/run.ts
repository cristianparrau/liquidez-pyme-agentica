import { ejecutarEvals } from "./evals.ts"
import { cargarEntorno } from "../core/entorno.ts"
import { crearProveedor } from "../llm/index.ts"

/** npm run evals            → suites deterministas
 *  npm run evals -- --modelo → además, la suite contra el modelo real (requiere GEMINI_API_KEY) */
const conModelo = process.argv.includes("--modelo")
const r = cargarEntorno()
const llm = conModelo && r.ok ? crearProveedor(r.entorno) : null
if (conModelo && !llm) console.warn("Sin GEMINI_API_KEY: se omite la suite con modelo real.")
const reporte = await ejecutarEvals(llm)
for (const s of reporte.suites) {
  console.log(`\n${s.aprobada ? "✔" : "✘"} ${s.nombre} · ${s.metrica}: ${(s.valor * 100).toFixed(0)} % (umbral ${s.umbral})`)
  for (const c of s.casos.filter((x) => !x.ok)) console.log(`   ✘ ${c.id}: esperado "${c.esperado}", obtenido "${c.obtenido}" · ${c.entrada}`)
}
console.log(`\n${reporte.aprobadas}/${reporte.total} suites aprobadas`)
process.exitCode = reporte.aprobadas === reporte.total ? 0 : 1
