import net from "net"
import path from "path"
import { fileURLToPath } from "url"
import pkg from "../../package.json" assert { type: "json" }
import { logInfo } from "./logger.ts"
import { LeoSession } from "./session.ts"
import { Storage } from "./storage.ts"

type ServerOptions = {
  host: string
  port: number
  storagePath: string
  credentials: { username: string; password: string }
  protocolVersion?: number
  capabilities?: string[]
}

export function startServer(options: ServerOptions): Promise<net.Server> {
  const storage = new Storage(options.storagePath)
  const capabilities = options.capabilities ?? ["AUTH", "PUT", "GET", "LIST", "DEL", "INFO", "BYE"]
  const protocolVersion = options.protocolVersion ?? 1
  const server = net.createServer(socket => {
    new LeoSession(socket, storage, options.credentials, {
      protocolVersion,
      capabilities,
      version: typeof pkg === "object" && pkg && "version" in pkg ? String((pkg as { version?: string }).version ?? "unknown") :
        "unknown",
      storageRoot: path.resolve(options.storagePath)
    })
  })
  return new Promise(resolve => {
    server.listen(options.port, options.host, () => {
      logInfo("server", "LEO server listening", { host: options.host, port: options.port, storage: options.storagePath })
      resolve(server)
    })
  })
}

async function main() {
  const host = process.env.LEO_HOST ?? "127.0.0.1"
  const port = Number(process.env.LEO_PORT ?? "9000")
  const storagePath = process.env.LEO_STORAGE ?? path.resolve(process.cwd(), "data")
  const username = process.env.LEO_USER ?? "user"
  const password = process.env.LEO_PASS ?? "pass"
  await startServer({ host, port, storagePath, credentials: { username, password } })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
