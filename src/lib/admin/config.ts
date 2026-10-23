import "server-only";
import { z } from "zod";
import { sql } from "../db";
import { audit, type Actor } from "../audit";
import { firstIssue } from "../validation";
import { addDays, isValidDay, zonedToInstant } from "../time";
import { loadSiteConfig } from "../settings";
import { AdminError } from "./appointments";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) {
    const i = firstIssue(r.error);
    throw new AdminError(i.message, i.field);
  }
  return r.data;
}

const optText = (max: number, msg = `Hasta ${max} caracteres`) =>
  z
    .string()
    .max(max, msg)
    .transform((s) => s.trim() || null)
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const httpsUrl = z.preprocess(
  (v) => (v == null ? "" : v),
  z
    .string()
    .trim()
    .transform((s) => s || null)
    .refine((s) => s === null || /^https:\/\/[^\s]+$/.test(s), "El enlace debe empezar con https://"),
);

// ---------------- Especialidades ----------------

const specialtySchema = z.object({
  name: z.string().trim().min(2, "Ingresá un nombre").max(80),
  description: optText(400),
  durationMinutes: z.coerce.number().int().min(5, "Mínimo 5 minutos").max(240, "Máximo 240 minutos"),
  bufferMinutes: z.coerce.number().int().min(0).max(120, "Máximo 120 minutos"),
  minNoticeHours: z.coerce.number().int().min(0).max(720, "Máximo 720 horas"),
  maxAdvanceDays: z.coerce.number().int().min(1, "Mínimo 1 día").max(365, "Máximo 365 días"),
  active: z.boolean(),
});

export async function updateSpecialty(id: string, input: unknown, actor: Actor) {
  const d = parse(specialtySchema, input);
  const rows = await sql`
    update specialties set
      name = ${d.name}, description = ${d.description}, duration_minutes = ${d.durationMinutes},
      buffer_minutes = ${d.bufferMinutes}, min_notice_hours = ${d.minNoticeHours},
      max_advance_days = ${d.maxAdvanceDays}, active = ${d.active}
    where id = ${id} returning id`;
  if (!rows.length) throw new AdminError("Especialidad inexistente");
  await audit(actor, "specialty.updated", "specialty", id, { ...d, description: undefined });
}

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const ruleSchema = z
  .object({
    weekday: z.coerce.number().int().min(1).max(7),
    startTime: z.string().regex(timeRe, "Hora inválida (usá HH:MM)"),
    endTime: z.string().regex(timeRe, "Hora inválida (usá HH:MM)"),
  })
  .refine((r) => r.endTime > r.startTime, { message: "La hora de fin debe ser posterior a la de inicio", path: ["endTime"] });

/** Reemplaza las franjas semanales de una especialidad (operación atómica). */
export async function replaceRules(specialtyId: string, input: unknown, actor: Actor) {
  const rules = parse(z.array(ruleSchema).max(60), input);
  // Franjas del mismo día no pueden superponerse entre sí.
  for (let wd = 1; wd <= 7; wd++) {
    const day = rules.filter((r) => r.weekday === wd).sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < day.length; i++) {
      if (day[i].startTime < day[i - 1].endTime) {
        throw new AdminError("Hay franjas superpuestas en el mismo día. Revisá los horarios.");
      }
    }
  }
  await sql.begin(async (tx) => {
    const [s] = await tx`select id from specialties where id = ${specialtyId} for update`;
    if (!s) throw new AdminError("Especialidad inexistente");
    await tx`delete from availability_rules where specialty_id = ${specialtyId}`;
    for (const r of rules) {
      await tx`insert into availability_rules (specialty_id, weekday, start_time, end_time)
               values (${specialtyId}, ${r.weekday}, ${r.startTime}, ${r.endTime})`;
    }
    await audit(actor, "availability.rules_replaced", "specialty", specialtyId, { rules }, tx);
  });
}

export async function getRules(specialtyId: string) {
  return sql<{ weekday: number; startTime: string; endTime: string }[]>`
    select weekday, to_char(start_time, 'HH24:MI') as start_time, to_char(end_time, 'HH24:MI') as end_time
    from availability_rules where specialty_id = ${specialtyId} order by weekday, start_time`;
}

// ---------------- Bloqueos ----------------

const exceptionSchema = z
  .object({
    specialtyId: z.union([z.literal(""), z.uuid()]).transform((v) => v || null),
    kind: z.enum(["block", "vacation", "holiday", "pause"]),
    startDay: z.string().refine(isValidDay, "Fecha de inicio inválida"),
    endDay: z.string().refine(isValidDay, "Fecha de fin inválida"),
    allDay: z.boolean(),
    startTime: z.string().optional().default(""),
    endTime: z.string().optional().default(""),
    reason: optText(200),
  })
  .superRefine((v, ctx) => {
    if (v.endDay < v.startDay) ctx.addIssue({ code: "custom", message: "La fecha de fin es anterior a la de inicio", path: ["endDay"] });
    if (!v.allDay) {
      if (!timeRe.test(v.startTime)) ctx.addIssue({ code: "custom", message: "Ingresá la hora de inicio", path: ["startTime"] });
      if (!timeRe.test(v.endTime)) ctx.addIssue({ code: "custom", message: "Ingresá la hora de fin", path: ["endTime"] });
      if (v.startDay === v.endDay && v.endTime <= v.startTime)
        ctx.addIssue({ code: "custom", message: "La hora de fin debe ser posterior a la de inicio", path: ["endTime"] });
    }
  });

export async function addException(input: unknown, actor: Actor) {
  const d = parse(exceptionSchema, input);
  const { settings } = await loadSiteConfig();
  const tz = settings.timezone;
  const startsAt = d.allDay ? zonedToInstant(d.startDay, "00:00", tz) : zonedToInstant(d.startDay, d.startTime, tz);
  const endsAt = d.allDay ? zonedToInstant(addDays(d.endDay, 1), "00:00", tz) : zonedToInstant(d.endDay, d.endTime, tz);
  const [row] = await sql<{ id: string }[]>`
    insert into availability_exceptions (specialty_id, kind, starts_at, ends_at, reason, created_by)
    values (${d.specialtyId}, ${d.kind}::exception_kind, ${startsAt}, ${endsAt}, ${d.reason}, ${actor.type === "admin" ? actor.userId : null})
    returning id`;
  await audit(actor, "availability.exception_added", "availability_exception", row.id, { kind: d.kind, startsAt, endsAt });
  // Los turnos ya confirmados dentro del bloqueo no se cancelan solos: se informan para que la médica decida.
  const affected = await sql<{ id: string; startsAt: Date; patientName: string; specialtyName: string }[]>`
    select a.id, a.starts_at, p.full_name as patient_name, s.name as specialty_name
    from appointments a join patients p on p.id = a.patient_id join specialties s on s.id = a.specialty_id
    where a.status = 'confirmed'
      and (${d.specialtyId}::uuid is null or a.specialty_id = ${d.specialtyId})
      and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(${startsAt}, ${endsAt}, '[)')
    order by a.starts_at`;
  return { id: row.id, affected };
}

export async function deleteException(id: string, actor: Actor) {
  const rows = await sql`delete from availability_exceptions where id = ${id} returning id`;
  if (!rows.length) throw new AdminError("El bloqueo no existe.");
  await audit(actor, "availability.exception_deleted", "availability_exception", id, {});
}

// ---------------- Configuración general ----------------

const settingsSchema = z.object({
  appName: z.string().trim().min(1, "Ingresá el nombre del sitio").max(80),
  honorific: z.string().trim().max(20),
  fullName: optText(120),
  licenseNumber: optText(60),
  bio: optText(1500),
  photoUrl: httpsUrl,
  addressLine: optText(200),
  addressDetails: optText(200),
  city: optText(120),
  mapsUrl: httpsUrl,
  arrivalInstructions: optText(1500),
  publicHoursText: optText(600),
  showPublicHours: z.boolean(),
  contactPhone: optText(40),
  contactWhatsapp: optText(40),
  contactEmail: z.preprocess((v) => (v == null ? "" : v), z
    .string()
    .trim()
    .toLowerCase()
    .refine((s) => s === "" || z.email().safeParse(s).success, "Revisá el correo de contacto")
    .transform((s) => s || null)),
  phoneRequired: z.boolean(),
  requireEmailVerification: z.boolean(),
  allowPatientCancel: z.boolean(),
  allowPatientReschedule: z.boolean(),
  patientChangeMinHours: z.coerce.number().int().min(0).max(720),
  reminderHoursBefore: z.coerce.number().int().min(1, "Mínimo 1 hora").max(336, "Máximo 336 horas (14 días)"),
  holdMinutes: z.coerce.number().int().min(5).max(60),
  cancellationPolicyText: optText(1500),
  privacyControllerName: optText(200),
  privacyControllerContact: optText(300),
});

export async function updateSettings(input: unknown, actor: Actor) {
  const d = parse(settingsSchema, input);
  const { settings } = await loadSiteConfig();
  await sql.begin(async (tx) => {
    await tx`
      update profiles set honorific = ${d.honorific}, full_name = ${d.fullName}, license_number = ${d.licenseNumber},
             bio = ${d.bio}, photo_url = ${d.photoUrl}
      where id = ${settings.profileId}`;
    await tx`
      update clinic_settings set
        app_name = ${d.appName}, address_line = ${d.addressLine}, address_details = ${d.addressDetails}, city = ${d.city},
        maps_url = ${d.mapsUrl}, arrival_instructions = ${d.arrivalInstructions}, public_hours_text = ${d.publicHoursText},
        show_public_hours = ${d.showPublicHours}, contact_phone = ${d.contactPhone}, contact_whatsapp = ${d.contactWhatsapp},
        contact_email = ${d.contactEmail}, phone_required = ${d.phoneRequired},
        require_email_verification = ${d.requireEmailVerification}, allow_patient_cancel = ${d.allowPatientCancel},
        allow_patient_reschedule = ${d.allowPatientReschedule}, patient_change_min_hours = ${d.patientChangeMinHours},
        reminder_hours_before = ${d.reminderHoursBefore}, hold_minutes = ${d.holdMinutes},
        cancellation_policy_text = ${d.cancellationPolicyText}, privacy_controller_name = ${d.privacyControllerName},
        privacy_controller_contact = ${d.privacyControllerContact}
      where id`;
    if (d.reminderHoursBefore !== settings.reminderHoursBefore) {
      // Recalcula los recordatorios pendientes con la nueva anticipación.
      await tx`
        update notification_jobs j
           set run_at = a.starts_at - make_interval(hours => ${d.reminderHoursBefore}),
               payload = j.payload || jsonb_build_object('hoursBefore', ${d.reminderHoursBefore}::int)
          from appointments a
         where a.id = j.appointment_id and j.kind = 'reminder' and j.status = 'pending'
           and a.starts_at - make_interval(hours => ${d.reminderHoursBefore}) > now()`;
      await tx`
        update notification_jobs j
           set status = 'skipped', last_error = 'Con la nueva anticipación el recordatorio quedaría atrasado'
          from appointments a
         where a.id = j.appointment_id and j.kind = 'reminder' and j.status = 'pending'
           and a.starts_at - make_interval(hours => ${d.reminderHoursBefore}) <= now()`;
    }
    await audit(actor, "settings.updated", "clinic_settings", null, {}, tx);
  });
}

export async function updateTemplate(kind: string, input: { subject: unknown; body: unknown }, actor: Actor) {
  const d = parse(
    z.object({
      subject: z.string().trim().min(3, "Ingresá un asunto").max(150),
      body: z.string().trim().min(1, "Ingresá el texto del correo").max(4000),
    }),
    input,
  );
  const rows = await sql`update email_templates set subject = ${d.subject}, body = ${d.body}
                         where kind = ${kind}::notification_kind returning kind`;
  if (!rows.length) throw new AdminError("Plantilla inexistente");
  await audit(actor, "email_template.updated", "email_template", null, { kind });
}
