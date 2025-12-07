import { describe, expect, it } from "vitest"
import { createX25519KeyPair, computeSharedSecret, deriveSessionKeys } from "../crypto.ts"

describe("crypto primitives", () => {
  it("derives matching shared secrets and session keys", () => {
    const alice = createX25519KeyPair()
    const bob = createX25519KeyPair()
    const secret1 = computeSharedSecret(alice.privateKey, bob.publicKey)
    const secret2 = computeSharedSecret(bob.privateKey, alice.publicKey)
    expect(secret1.equals(secret2)).toBe(true)
    const keys1 = deriveSessionKeys(secret1, "abcd")
    const keys2 = deriveSessionKeys(secret2, "abcd")
    expect(keys1.clientToServerKey.equals(keys2.clientToServerKey)).toBe(true)
    expect(keys1.serverToClientKey.equals(keys2.serverToClientKey)).toBe(true)
  })
})
