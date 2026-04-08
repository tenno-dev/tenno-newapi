/**
 * Pure Web Push (VAPID + encrypted payload) implementation using Web Crypto API.
 * Compatible with Cloudflare Workers runtime (no Node-only APIs).
 */

import { Bindings, TranslatePingMessage } from "../app/types";
import { SQL } from "../db/sql";
import { ensurePushTables } from "../pipeline/retention";

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  lang: string;
};

type PingKey = string;

function pingKey(ping: TranslatePingMessage): PingKey {
  return `${ping.rootKey}:${ping.lang}:${ping.hash}`;
}

// ---------- Base64url helpers ----------

function base64urlToBytes(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ---------- ECDH key agreement helpers ----------

async function importPublicKey(rawBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", rawBytes, { name: "ECDH", namedCurve: "P-256" }, false, []);
}

// ---------- VAPID JWT building ----------

async function buildVapidJwt(
  vapidPublicKeyB64: string,
  vapidPrivateKeyB64: string,
  audience: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 12 * 3600; // 12 hours

  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp,
    sub: "mailto:push@tennodev.invalid",
  };

  const encodedHeader = bytesToBase64url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = bytesToBase64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  // Import VAPID private key as ECDSA signing key
  const privateKeyBytes = base64urlToBytes(vapidPrivateKeyB64);
  const publicKeyBytes = base64urlToBytes(vapidPublicKeyB64);

  // Reconstruct full JWK using both public and private key material
  const pubKeyImported = await crypto.subtle.importKey(
    "raw",
    publicKeyBytes,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    []
  );
  const pubJwkRaw = await crypto.subtle.exportKey("jwk", pubKeyImported);
  const pubJwk = pubJwkRaw as JsonWebKey;

  const privateKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: bytesToBase64url(privateKeyBytes),
      x: pubJwk.x,
      y: pubJwk.y,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signingInput)
  );

  const encodedSignature = bytesToBase64url(new Uint8Array(signature));
  return `${signingInput}.${encodedSignature}`;
}

// ---------- RFC 8188 / Web Push encryption (aes128gcm) ----------

async function encryptWebPushPayload(
  plaintext: Uint8Array,
  subscriptionPublicKeyB64: string,
  authSecretB64: string
): Promise<Uint8Array> {
  const subscriptionPublicKeyBytes = base64urlToBytes(subscriptionPublicKeyB64);
  const authSecret = base64urlToBytes(authSecretB64);

  // Generate an ephemeral ECDH key pair
  const ephemeralKeyPair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  )) as CryptoKeyPair;

  // Export the ephemeral public key in raw (uncompressed) format
  const ephemeralPublicKeyRaw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", ephemeralKeyPair.publicKey)) as ArrayBuffer
  );

  // Import the subscription's public key for ECDH
  const subscriptionPublicKey = await importPublicKey(subscriptionPublicKeyBytes);

  // Perform ECDH key agreement: compute shared secret
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sharedSecretBits = await (crypto.subtle as any).deriveBits(
    { name: "ECDH", public: subscriptionPublicKey },
    ephemeralKeyPair.privateKey,
    256
  ) as ArrayBuffer;
  const sharedSecret = new Uint8Array(sharedSecretBits);

  // Generate a random 16-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF extract+expand per RFC 8291 (aes128gcm content encoding)
  // PRK = HMAC-SHA-256(auth_secret, ecdh_secret)
  const hkdfKey = await crypto.subtle.importKey("raw", authSecret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prkBits = await crypto.subtle.sign("HMAC", hkdfKey, sharedSecret);
  const prk = new Uint8Array(prkBits);

  // key_info = "WebPush: info\x00" + receiver_public || sender_public
  const keyInfoPrefix = new TextEncoder().encode("WebPush: info\x00");
  const keyInfo = new Uint8Array(keyInfoPrefix.length + subscriptionPublicKeyBytes.length + ephemeralPublicKeyRaw.length);
  keyInfo.set(keyInfoPrefix, 0);
  keyInfo.set(subscriptionPublicKeyBytes, keyInfoPrefix.length);
  keyInfo.set(ephemeralPublicKeyRaw, keyInfoPrefix.length + subscriptionPublicKeyBytes.length);

  const ikm = await hkdfExpand(prk, keyInfo, 32);

  // Derive content encryption key (CEK) and nonce using HKDF with the salt
  const cekInfo = new TextEncoder().encode("Content-Encoding: aes128gcm\x00");
  const cek = await hkdfWithSalt(ikm, salt, cekInfo, 16);

  const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\x00");
  const nonce = await hkdfWithSalt(ikm, salt, nonceInfo, 12);

  // Encrypt the plaintext using AES-128-GCM
  const paddedPlaintext = new Uint8Array(plaintext.length + 1);
  paddedPlaintext.set(plaintext, 0);
  paddedPlaintext[plaintext.length] = 0x02; // record delimiter

  const contentEncryptionKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, contentEncryptionKey, paddedPlaintext)
  );

  // Build the aes128gcm content-encoding header
  // salt (16) + rs (4, big-endian uint32) + idlen (1) + keyid (65 bytes uncompressed public key)
  const rs = plaintext.length + 18; // record size
  const headerLength = 16 + 4 + 1 + ephemeralPublicKeyRaw.length;
  const result = new Uint8Array(headerLength + ciphertext.length);
  let offset = 0;

  result.set(salt, offset);
  offset += 16;

  // rs as big-endian uint32
  const rsView = new DataView(result.buffer, offset, 4);
  rsView.setUint32(0, rs, false);
  offset += 4;

  // idlen
  result[offset] = ephemeralPublicKeyRaw.length;
  offset += 1;

  // keyid (ephemeral public key)
  result.set(ephemeralPublicKeyRaw, offset);
  offset += ephemeralPublicKeyRaw.length;

  // ciphertext
  result.set(ciphertext, offset);

  return result;
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const t = new Uint8Array(info.length + 1);
  t.set(info, 0);
  t[info.length] = 0x01;
  const output = new Uint8Array(await crypto.subtle.sign("HMAC", key, t));
  return output.slice(0, length);
}

async function hkdfWithSalt(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const saltKey = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", saltKey, ikm));
  return hkdfExpand(prk, info, length);
}

// ---------- Send a single Web Push notification ----------

async function sendWebPush(
  subscription: PushSubscriptionRow,
  payload: object,
  vapidPublicKey: string,
  vapidPrivateKey: string
): Promise<{ ok: boolean; status: number; gone: boolean }> {
  const endpointUrl = new URL(subscription.endpoint);
  const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;

  const jwt = await buildVapidJwt(vapidPublicKey, vapidPrivateKey, audience);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await encryptWebPushPayload(plaintext, subscription.p256dh, subscription.auth);

  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Authorization": `vapid t=${jwt},k=${vapidPublicKey}`,
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL": "86400",
    },
    body: encrypted,
  });

  const gone = response.status === 404 || response.status === 410;
  return { ok: response.ok, status: response.status, gone };
}

// ---------- Batch send ----------

export async function sendWebPushBatch(
  env: Bindings,
  pings: TranslatePingMessage[]
): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    // VAPID keys not configured; skip sending
    return;
  }

  await ensurePushTables(env.TENNODEV_WORLDSTATE_D1);

  // Deduplicate pings by (rootKey, lang, hash)
  const seen = new Set<PingKey>();
  const dedupedPings: TranslatePingMessage[] = [];
  for (const ping of pings) {
    const key = pingKey(ping);
    if (!seen.has(key)) {
      seen.add(key);
      dedupedPings.push(ping);
    }
  }

  const goneEndpoints = new Set<string>();

  for (const ping of dedupedPings) {
    // Query subscriptions matching (lang, rootKey)
    const result = await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.selectMatchingPushSubscriptions)
      .bind(ping.lang, ping.rootKey)
      .all<PushSubscriptionRow>();

    const pushPayload = { rootKey: ping.rootKey, lang: ping.lang, hash: ping.hash };

    for (const sub of result.results) {
      if (goneEndpoints.has(sub.endpoint)) {
        continue;
      }

      try {
        const outcome = await sendWebPush(sub, pushPayload, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);

        if (outcome.gone) {
          goneEndpoints.add(sub.endpoint);
          // Remove subscription and its root keys
          await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.deletePushSubscriptionRootKeysByEndpoint)
            .bind(sub.endpoint)
            .run();
          await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.deletePushSubscriptionByEndpoint)
            .bind(sub.endpoint)
            .run();
        }
      } catch (err) {
        // Network or crypto errors; log and skip this subscription for this batch
        console.error(
          `[webpush] Failed to send push to ${sub.endpoint} for ${ping.rootKey}/${ping.lang}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }
}
