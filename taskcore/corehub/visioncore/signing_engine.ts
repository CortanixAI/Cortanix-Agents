/**
 * SigningEngine: wraps WebCrypto for RSA signing / verification.
 * Generates key pair lazily to avoid constructor async issues.
 */
export class SigningEngine {
  private keyPair?: CryptoKeyPair

  /** Ensure keypair is generated */
  private async ensureKeys(): Promise<CryptoKeyPair> {
    if (!this.keyPair) {
      this.keyPair = await crypto.subtle.generateKey(
        {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["sign", "verify"]
      )
    }
    return this.keyPair
  }

  /** Sign a string payload and return base64 signature */
  async sign(data: string): Promise<string> {
    const kp = await this.ensureKeys()
    const enc = new TextEncoder().encode(data)
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, enc)
    return Buffer.from(sig).toString("base64")
  }

  /** Verify base64 signature against a string payload */
  async verify(data: string, signature: string): Promise<boolean> {
    const kp = await this.ensureKeys()
    const enc = new TextEncoder().encode(data)
    const sig = Buffer.from(signature, "base64")
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", kp.publicKey, sig, enc)
  }

  /** Export public key in PEM format */
  async exportPublicKeyPem(): Promise<string> {
    const kp = await this.ensureKeys()
    const spki = await crypto.subtle.exportKey("spki", kp.publicKey)
    const b64 = Buffer.from(spki).toString("base64")
    const chunks = b64.match(/.{1,64}/g) ?? []
    return `-----BEGIN PUBLIC KEY-----\n${chunks.join("\n")}\n-----END PUBLIC KEY-----`
  }

  /** Export private key in PEM format */
  async exportPrivateKeyPem(): Promise<string> {
    const kp = await this.ensureKeys()
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", kp.privateKey)
    const b64 = Buffer.from(pkcs8).toString("base64")
    const chunks = b64.match(/.{1,64}/g) ?? []
    return `-----BEGIN PRIVATE KEY-----\n${chunks.join("\n")}\n-----END PRIVATE KEY-----`
  }
}
