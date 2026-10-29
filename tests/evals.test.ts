import { test } from "node:test"
import assert from "node:assert/strict"
import * as o from "../src/agentes/orquestador.ts"
import { ejecutarEvals } from "../src/evals/evals.ts"

test("las suites deterministas pasan y no dejan casos en la demo", async () => {
  o.reiniciar()
  const r = await ejecutarEvals(null)
  for (const s of r.suites) assert.equal(s.aprobada, true, `${s.nombre}: ${s.casos.filter((c) => !c.ok).map((c) => c.id).join(", ")}`)
  assert.equal(o.listarBandeja().length, 0)
})
