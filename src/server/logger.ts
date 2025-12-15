export type LogMeta = Record<string, unknown>

function write(level: "info" | "error" | "warn", context: string, message: string, meta?: LogMeta) {
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    context,
    message
  }
  if (meta && Object.keys(meta).length > 0) Object.assign(payload, meta)
  const line = JSON.stringify(payload)
  if (level === "error") console.error(line)
  else console.log(line)
}

export function logInfo(context: string, message: string, meta?: LogMeta) {
  write("info", context, message, meta)
}

export function logWarn(context: string, message: string, meta?: LogMeta) {
  write("warn", context, message, meta)
}

export function logError(context: string, message: string, meta?: LogMeta) {
  write("error", context, message, meta)
}
