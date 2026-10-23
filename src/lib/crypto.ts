import "server-only";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "./env";

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hmac(value: string) {
  return createHmac("sha256", env.appSecret).update(value).digest("base64url");
}

export function randomToken(bytes = 16) {
  return randomBytes(bytes).toString("base64url");
}

/** Código numérico de 6 dígitos para verificar el correo. */
export function verificationCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashCode(appointmentId: string, code: string) {
  return hmac(`code:${appointmentId}:${code}`);
}

export function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Enlace de gestión del turno: token aleatorio derivado del id + sal, firmado
 * con APP_SECRET. En la base solo se guarda su hash, así un acceso a la base no
 * revela enlaces válidos. El token no contiene datos personales.
 */
export function manageToken(appointmentId: string, salt: string) {
  return hmac(`manage:${appointmentId}:${salt}`);
}

export function manageTokenHash(token: string) {
  return sha256(`manage:${token}`);
}

/** Token del formulario público: marca de tiempo firmada (detecta envíos automáticos instantáneos). */
export function formToken(now = Date.now()) {
  const ts = String(now);
  return `${ts}.${hmac(`form:${ts}`)}`;
}

export function checkFormToken(token: unknown, minMs = 2500, maxMs = 3 * 60 * 60 * 1000) {
  if (typeof token !== "string") return false;
  const [ts, sig] = token.split(".");
  if (!ts || !sig || !safeEqual(sig, hmac(`form:${ts}`))) return false;
  const age = Date.now() - Number(ts);
  return age >= minMs && age <= maxMs;
}
