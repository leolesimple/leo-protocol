import { createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync } from "crypto"

export type X25519KeyPair = {
  publicKey: Buffer
  privateKey: Buffer
}

export function createX25519KeyPair(): X25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("x25519")
  return { publicKey: publicKey.export({ type: "spki", format: "der" }), privateKey: privateKey.export({ type: "pkcs8", format: "der" }) }
}

export function computeSharedSecret(privateKeyDer: Buffer, publicKeyDer: Buffer): Buffer {
  const privateKey = createPrivateKey({ key: privateKeyDer, format: "der", type: "pkcs8" })
  const publicKey = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" })
  return diffieHellman({ privateKey, publicKey })
}

export function deriveSessionKeys(sharedSecret: Buffer, sessionId: string): { clientToServerKey: Buffer; serverToClientKey: Buffer } {
  const info = Buffer.from(`LEO-SESSION-${sessionId}`)
  const okm = Buffer.from(hkdfSync("sha256", sharedSecret, Buffer.alloc(0), info, 64))
  return { clientToServerKey: okm.subarray(0, 32), serverToClientKey: okm.subarray(32, 64) }
}
