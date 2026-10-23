import { z } from "zod";

/** Normaliza espacios y limita a letras, espacios, apóstrofes, puntos y guiones. */
export const personName = z
  .string({ error: "Ingresá nombre y apellido" })
  .transform((s) => s.normalize("NFC").replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(3, "Ingresá nombre y apellido")
      .max(120, "El nombre es demasiado largo")
      .regex(/^[\p{L}][\p{L}\p{M}' .-]*$/u, "Usá solo letras en el nombre")
      .refine((s) => s.includes(" "), "Ingresá nombre y apellido"),
  );

export const email = z
  .string({ error: "Ingresá tu correo electrónico" })
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.email("Revisá el correo electrónico").max(254));

/** Teléfono argentino o internacional: conserva el formato escrito, valida la cantidad de dígitos. */
export const phone = z
  .string()
  .transform((s) => s.replace(/\s+/g, " ").trim())
  .refine((s) => s === "" || /^[+\d][\d ()-]*$/.test(s), "Revisá el teléfono: usá solo números")
  .refine((s) => {
    const digits = s.replace(/\D/g, "").length;
    return s === "" || (digits >= 8 && digits <= 15);
  }, "Revisá el teléfono: debe tener entre 8 y 15 dígitos");

export const isoInstant = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)) && /T/.test(s), "Horario inválido")
  .transform((s) => new Date(s));

export const uuid = z.uuid();

export function bookingSchema(phoneRequired: boolean) {
  return z.object({
    specialty: z.string().regex(/^[a-z0-9-]{2,40}$/),
    startsAt: isoInstant,
    fullName: personName,
    email,
    phone: phoneRequired ? phone.refine((s) => s !== "", "Ingresá un teléfono de contacto") : phone.optional().default(""),
    acceptPrivacy: z.literal(true, { error: "Necesitamos que aceptes la política de privacidad" }),
  });
}

export function firstIssue(e: z.ZodError) {
  const i = e.issues[0];
  return { field: String(i?.path?.[0] ?? ""), message: i?.message ?? "Datos inválidos" };
}

export function maskEmail(e: string) {
  const [user, domain] = e.split("@");
  if (!domain) return e;
  const shown = user.length <= 2 ? user[0] : user.slice(0, 2);
  return `${shown}${"•".repeat(Math.max(1, Math.min(user.length - shown.length, 6)))}@${domain}`;
}
