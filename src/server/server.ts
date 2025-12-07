import net from "net"
import path from "path"
import { fileURLToPath } from "url"
import { LeoSession } from "./session.ts"
import { Storage } from "./storage.ts"

type ServerOptions = { host: string; port: number; storagePath: string; credentials: { username: string; password: string } }

export function startServer(options: ServerOptions): Promise<net.Server> {
  const storage = new Storage(options.storagePath)
  const server = net.createServer(socket => {
    new LeoSession(socket, storage, options.credentials)
  })
  return new Promise(resolve => {
    server.listen(options.port, options.host, () => resolve(server))
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
