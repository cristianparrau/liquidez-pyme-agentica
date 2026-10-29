/**
 * Guardián: capa sin modelo de lenguaje que revisa todo texto externo (mensajes y documentos)
 * antes de que llegue a un agente. Lo que venga en un documento es dato, nunca instrucción.
 */
const PATRONES: { codigo: string; regex: RegExp }[] = [
  { codigo: "ignorar-instrucciones", regex: /ignor(a|e|ar)\b.{0,40}(instrucciones|pol[ií]ticas|reglas|indicaciones)/i },
  { codigo: "cambio-de-rol", regex: /\b(eres|act[uú]a como|ahora eres|finge ser)\b.{0,40}(aprobador|administrador|sistema|banco|analista)/i },
  { codigo: "aprobacion-forzada", regex: /\baprueb(a|e|ar)\b.{0,80}(sin\s+(verificaci[oó]n|validaci[oó]n|revisi[oó]n)|de inmediato|autom[aá]tic)/i },
  { codigo: "evadir-controles", regex: /sin\s+(verificaci[oó]n|validaci[oó]n)\s+(en|de)\s+(radian|rues|listas)/i },
  { codigo: "prompt-del-sistema", regex: /(system prompt|prompt del sistema|tus instrucciones internas)/i },
  { codigo: "texto-oculto", regex: /(blanco sobre blanco|texto oculto|font-size:\s*0)/i },
]

export type RevisionGuardian = { sospechoso: boolean; coincidencias: string[] }

export function revisarTexto(texto: string): RevisionGuardian {
  const coincidencias = PATRONES.filter((p) => p.regex.test(texto)).map((p) => p.codigo)
  return { sospechoso: coincidencias.length > 0, coincidencias }
}

/** Enmascara identificadores antes de enviarlos al modelo o a los logs: NIT, cédulas y cuentas. */
export function enmascarar(texto: string): string {
  return texto
    .replace(/\b(\d{3})\.(\d{3})\.(\d{3})-(\d)\b/g, "$1.***.***-$4")
    .replace(/\b(\d{2})\.(\d{3})\.(\d{3})\b/g, "$1.***.***")
    .replace(/\b\d{9,16}\b/g, (m) => `${"*".repeat(m.length - 4)}${m.slice(-4)}`)
}
