import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, join, normalize, sep } from "node:path"
import { cargarEntorno } from "./core/entorno.ts"
import { LimitadorPorIp } from "./core/limite.ts"
import { crearProveedor } from "./llm/index.ts"
import { EMPRESAS, FECHA_REFERENCIA, facturasDe } from "./dominio/datos.ts"
import { compararAlternativas } from "./dominio/alternativas.ts"
import { POLITICA } from "./dominio/politica.ts"
import * as orq from "./agentes/orquestador.ts"
import { responder } from "./agentes/asesor.ts"
import { resumenMetricas } from "./agentes/metricas.ts"
import { ejecutarEvals } from "./evals/evals.ts"

const r = cargarEntorno()
if (!r.ok) {
  console.error(`Configuración inválida en .env:\n  - ${r.errores.join("\n  - ")}`)
  process.exit(1)
}
const entorno = r.entorno
const llm = crearProveedor(entorno)
const limitador = new LimitadorPorIp(entorno.LIMITE_CHAT_POR_MINUTO * 3)
const directorio = process.cwd()
const TIPOS: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" }

const json = (res: ServerResponse, estado: number, cuerpo: unknown) => {
  res.writeHead(estado, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(cuerpo))
}
async function cuerpo(req: IncomingMessage): Promise<Record<string, unknown>> {
  let texto = ""
  for await (const trozo of req) {
    texto += String(trozo)
    if (texto.length > 30_000) throw new orq.ErrorNegocio("Cuerpo demasiado grande.")
  }
  try {
    return (JSON.parse(texto || "{}") ?? {}) as Record<string, unknown>
  } catch {
    throw new orq.ErrorNegocio("Cuerpo inválido.")
  }
}
const ip = (req: IncomingMessage) => (entorno.CONFIAR_PROXY && String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim()) || req.socket.remoteAddress || "?"
const txt = (v: unknown, def = "") => (typeof v === "string" ? v : def)

async function estatico(res: ServerResponse, ruta: string) {
  const raiz = join(directorio, "web")
  const destino = normalize(join(raiz, decodeURIComponent(ruta)))
  if (!destino.startsWith(raiz + sep)) return json(res, 403, { error: "Ruta no permitida." })
  try {
    const contenido = await readFile(destino)
    res.writeHead(200, { "content-type": TIPOS[extname(destino)] ?? "application/octet-stream" })
    res.end(contenido)
  } catch {
    json(res, 404, { error: "No encontrado." })
  }
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost")
  const ruta = url.pathname
  const m = ruta.match(/^\/api\/casos\/([\w-]+)(?:\/(\w+))?$/)
  const b = ruta.match(/^\/api\/bandeja\/([\w-]+)$/)
  try {
    if (req.method === "GET" && ruta === "/api/health") return json(res, 200, { ok: true, modelo: llm ? `${llm.nombre}/${llm.modelo}` : null, hoy: FECHA_REFERENCIA, politica: POLITICA })
    if (req.method === "GET" && ruta === "/api/empresas") return json(res, 200, EMPRESAS.map((e) => ({ id: e.id, nombre: e.nombre, sector: e.sector, ciudad: e.ciudad, escenario: e.escenario, porCobrar: facturasDe(e.id).reduce((s, f) => s + f.valor, 0) })))
    if (req.method === "POST" && ruta === "/api/simular") {
      const c = await cuerpo(req)
      return json(res, 200, compararAlternativas({ porCobrar: Number(c.porCobrar) || 0, diasCobro: Number(c.diasCobro) || 60, necesidad: Number(c.necesidad) || 0, clientesGrandes: c.clientesGrandes !== false }))
    }
    if (req.method === "POST" && ruta === "/api/casos") {
      const c = await cuerpo(req)
      return json(res, 200, orq.vistaCaso(orq.iniciarCaso(txt(c.empresaId), (c.consentimientos ?? {}) as Record<string, boolean>)))
    }
    if (m) {
      const [, id, accion] = m
      if (req.method === "GET" && !accion) return json(res, 200, orq.vistaCaso(orq.obtenerCaso(id!)))
      if (req.method === "POST" && accion === "evaluar") return json(res, 200, orq.vistaCaso(orq.evaluarFacturas(id!)))
      const c = await cuerpo(req)
      if (req.method === "POST" && accion === "documentos") return json(res, 200, orq.vistaCaso(orq.adjuntarDocumento(id!, txt(c.nombre, "documento.pdf").slice(0, 120), txt(c.texto).slice(0, 20_000))))
      if (req.method === "POST" && accion === "aceptar") return json(res, 200, orq.vistaCaso(orq.aceptarOferta(id!, Array.isArray(c.facturaIds) ? c.facturaIds.map(String) : [], c.confirmacion === true)))
      if (req.method === "POST" && accion === "pago") return json(res, 200, orq.vistaCaso(orq.simularPago(id!, txt(c.facturaId))))
    }
    if (req.method === "GET" && ruta === "/api/demo/documento") return json(res, 200, orq.documentoDemo())
    if (req.method === "POST" && ruta === "/api/chat") {
      const permiso = limitador.permitir(ip(req))
      if (!permiso.ok) return json(res, 429, { error: `Demasiadas solicitudes. Intenta en ${permiso.reintentarEnSeg} s.` })
      const c = await cuerpo(req)
      const mensaje = txt(c.mensaje).trim()
      if (!mensaje) return json(res, 400, { error: "Falta el mensaje." })
      const casoId = txt(c.casoId) || undefined
      const respuesta = await responder(llm, mensaje, casoId)
      return json(res, 200, { ...respuesta, caso: casoId ? orq.vistaCaso(orq.obtenerCaso(casoId)) : null })
    }
    if (req.method === "GET" && ruta === "/api/metricas") return json(res, 200, resumenMetricas())
    if (req.method === "GET" && ruta === "/api/evals") {
      const conModelo = url.searchParams.get("modelo") === "1"
      if (conModelo) {
        const permiso = limitador.permitir(ip(req))
        if (!permiso.ok) return json(res, 429, { error: `Demasiadas solicitudes. Intenta en ${permiso.reintentarEnSeg} s.` })
      }
      return json(res, 200, await ejecutarEvals(conModelo ? llm : null))
    }
    if (req.method === "GET" && ruta === "/api/bandeja") return json(res, 200, orq.listarBandeja())
    if (req.method === "POST" && b) {
      const c = await cuerpo(req)
      const decision = txt(c.decision)
      if (!["aprobar", "rechazar", "atendido"].includes(decision)) throw new orq.ErrorNegocio("Decisión inválida.")
      const item = orq.decidir(b[1]!, decision as "aprobar" | "rechazar" | "atendido", txt(c.nota), txt(c.responsable, "Persona del banco").slice(0, 80))
      return json(res, 200, { item, caso: orq.vistaCaso(orq.obtenerCaso(item.casoId)) })
    }
    if (req.method === "POST" && ruta === "/api/reiniciar") {
      orq.reiniciar()
      return json(res, 200, { ok: true })
    }
    if (req.method === "GET" && !ruta.startsWith("/api/")) return await estatico(res, ruta === "/" ? "index.html" : ruta.slice(1))
    json(res, 404, { error: "No encontrado." })
  } catch (e) {
    if (e instanceof orq.ErrorNegocio) return json(res, 422, { error: e.message })
    console.error(e)
    json(res, 500, { error: "Error interno." })
  }
})

servidor.listen(entorno.PORT, () => console.log(`Liquidez Pyme escuchando en http://localhost:${entorno.PORT} (modelo: ${llm ? `${llm.nombre}/${llm.modelo}` : "sin modelo · modo respaldo"})`))
