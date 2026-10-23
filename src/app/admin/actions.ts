"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { assertAdmin, UnauthorizedError } from "@/lib/auth";
import {
  AdminError,
  cancelAppointment,
  createManualAppointment,
  rescheduleAppointment,
  setAttendance,
  updateAdminNote,
  updatePatientContact,
} from "@/lib/admin/appointments";
import { addException, deleteException, replaceRules, updateSettings, updateSpecialty, updateTemplate } from "@/lib/admin/config";
import { getSlots } from "@/lib/availability";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { dispatchJobs, retryJob } from "@/lib/notifications/worker";
import { clientIp, rateLimit } from "@/lib/request";
import { loadSiteConfig } from "@/lib/settings";
import { createSupabaseServer } from "@/lib/supabase/server";
import { formatLongDate, formatTime, isValidDay, zonedToInstant } from "@/lib/time";

export type ActionState = { ok: boolean; message: string; field?: string; data?: unknown } | null;

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const bool = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true";

/** Ejecuta una acción del panel verificando la sesión de administración en el servidor. */
async function guarded(fn: (actor: { type: "admin"; userId: string }) => Promise<ActionState>): Promise<ActionState> {
  try {
    const admin = await assertAdmin();
    const result = await fn({ type: "admin", userId: admin.userId });
    revalidatePath("/admin", "layout");
    return result;
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, message: "Tu sesión venció. Volvé a iniciar sesión." };
    if (e instanceof AdminError) return { ok: false, message: e.message, field: e.field };
    if (e && typeof e === "object" && "digest" in e) throw e; // redirect()/notFound()
    console.error("[panel] error inesperado:", e instanceof Error ? e.message : e);
    return { ok: false, message: "Ocurrió un error inesperado. Intentá de nuevo." };
  }
}

function dispatchLater(jobIds: string[]) {
  if (jobIds.length) after(() => dispatchJobs(jobIds).catch((e) => console.error("[panel] envío diferido falló", (e as Error).message)));
}

/** Convierte fecha + hora local del formulario a instante ISO, en la zona del consultorio. */
async function instantFrom(form: FormData) {
  const day = str(form, "day");
  const time = str(form, "time");
  if (!isValidDay(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new AdminError("Elegí fecha y horario.", "startsAt");
  const { settings } = await loadSiteConfig();
  return zonedToInstant(day, time, settings.timezone).toISOString();
}

// ---------------------------------------------------------------- Autenticación

export async function loginAction(_: ActionState, form: FormData): Promise<ActionState> {
  const email = str(form, "email").trim().toLowerCase();
  const password = str(form, "password");
  if (!email || !password) return { ok: false, message: "Ingresá tu correo y tu contraseña." };
  if (!(await rateLimit("login:ip", await clientIp(), 10, 900)) || !(await rateLimit("login:email", email, 8, 900))) {
    return { ok: false, message: "Demasiados intentos. Esperá 15 minutos e intentá de nuevo." };
  }
  let supabase;
  try {
    supabase = await createSupabaseServer();
  } catch {
    return { ok: false, message: "La autenticación no está configurada (faltan las variables de Supabase)." };
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { ok: false, message: "Correo o contraseña incorrectos." };
  const [row] = await sql`select 1 from admin_users where user_id = ${data.user.id}`;
  if (!row) {
    await supabase.auth.signOut();
    return { ok: false, message: "Esta cuenta no tiene acceso al panel." };
  }
  redirect("/admin");
}

export async function logoutAction() {
  try {
    const supabase = await createSupabaseServer();
    await supabase.auth.signOut();
  } catch {
    /* sin configuración: no hay sesión que cerrar */
  }
  redirect("/admin/login");
}

export async function requestResetAction(_: ActionState, form: FormData): Promise<ActionState> {
  const email = str(form, "email").trim().toLowerCase();
  if (!email) return { ok: false, message: "Ingresá tu correo." };
  if (!(await rateLimit("reset:ip", await clientIp(), 5, 3600))) {
    return { ok: false, message: "Demasiadas solicitudes. Intentá más tarde." };
  }
  try {
    const supabase = await createSupabaseServer();
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${env.appUrl}/auth/confirm?next=/admin/actualizar-clave` });
  } catch (e) {
    console.error("[auth] recuperación falló", (e as Error).message);
  }
  // Mismo mensaje exista o no la cuenta, para no revelar qué correos están registrados.
  return { ok: true, message: "Si el correo corresponde a una cuenta del panel, vas a recibir un enlace para crear una nueva contraseña." };
}

export async function updatePasswordAction(_: ActionState, form: FormData): Promise<ActionState> {
  const password = str(form, "password");
  const confirm = str(form, "confirm");
  if (password.length < 10) return { ok: false, message: "La contraseña debe tener al menos 10 caracteres.", field: "password" };
  if (password !== confirm) return { ok: false, message: "Las contraseñas no coinciden.", field: "confirm" };
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, message: "El enlace venció. Pedí uno nuevo desde “Olvidé mi contraseña”." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, message: "No se pudo actualizar la contraseña. Probá con otra más segura." };
  redirect("/admin");
}

// ---------------------------------------------------------------- Turnos

export async function adminSlotsAction(specialtyId: string, day: string, ignoreAppointmentId?: string) {
  await assertAdmin();
  if (!isValidDay(day)) return [];
  const { settings } = await loadSiteConfig();
  const slots = await getSlots(specialtyId, day, day, { enforceBookingWindow: false, ignoreAppointmentId: ignoreAppointmentId ?? null });
  return slots.map((s) => ({ time: formatTime(s.startsAt, settings.timezone), startsAt: s.startsAt.toISOString() }));
}

export async function createAppointmentAction(_: ActionState, form: FormData): Promise<ActionState> {
  let createdId: string | null = null;
  const res = await guarded(async (actor) => {
    const { id, jobIds } = await createManualAppointment(
      {
        specialtyId: str(form, "specialtyId"),
        startsAt: await instantFrom(form),
        fullName: str(form, "fullName"),
        email: str(form, "email"),
        phone: str(form, "phone"),
        adminNote: str(form, "adminNote"),
        allowOutsideRules: bool(form, "allowOutsideRules"),
        notify: bool(form, "notify"),
      },
      actor,
    );
    dispatchLater(jobIds);
    createdId = id;
    return { ok: true, message: "Turno creado." };
  });
  if (createdId) redirect(`/admin/turnos/${createdId}?creado=1`);
  return res;
}

export async function rescheduleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded(async (actor) => {
    const startsAt = await instantFrom(form);
    const { jobIds } = await rescheduleAppointment(
      str(form, "id"),
      {
        startsAt,
        specialtyId: str(form, "specialtyId") || undefined,
        allowOutsideRules: bool(form, "allowOutsideRules"),
        notify: bool(form, "notify"),
      },
      actor,
    );
    dispatchLater(jobIds);
    const { settings } = await loadSiteConfig();
    return { ok: true, message: `Turno reprogramado para el ${formatLongDate(startsAt, settings.timezone)} a las ${formatTime(startsAt, settings.timezone)} h.` };
  });
}

export async function cancelAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded(async (actor) => {
    const { jobIds } = await cancelAppointment(str(form, "id"), { reason: str(form, "reason"), notify: bool(form, "notify") }, actor);
    dispatchLater(jobIds);
    return { ok: true, message: "Turno cancelado. El horario quedó libre." };
  });
}

export async function attendanceAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded(async (actor) => {
    const status = str(form, "status") as "completed" | "no_show" | "confirmed";
    if (!["completed", "no_show", "confirmed"].includes(status)) throw new AdminError("Estado inválido");
    await setAttendance(str(form, "id"), status, actor);
    return { ok: true, message: status === "completed" ? "Consulta marcada como realizada." : status === "no_show" ? "Ausencia registrada." : "El turno volvió a estado confirmado." };
  });
}

export async function noteAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded(async (actor) => {
    await updateAdminNote(str(form, "id"), str(form, "adminNote"), actor);
    return { ok: true, message: "Nota guardada." };
  });
}

export async function patientContactAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded(async (actor) => {
    await updatePatientContact(str(form, "patientId"), { fullName: str(form, "fullName"), email: str(form, "email"), phone: str(form, "phone") }, actor);
    return { ok: true, message: "Datos del paciente actualizados." };
  });
}

// ---------------------------------------------------------------- Agenda

export async function saveSpecialtyAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded(async (actor) => {
    await updateSpecialty(
      str(form, "id"),
      {
        name: str(form, "name"),
        description: str(form, "description"),
        durationMinutes: str(form, "durationMinutes"),
        bufferMinutes: str(form, "bufferMinutes"),
        minNoticeHours: str(form, "minNoticeHours"),
        maxAdvanceDays: str(form, "maxAdvanceDays"),
        active: bool(form, "active"),
      },
      actor,
    );
    return { ok: true, message: "Especialidad guardada." };
  });
}

export async function saveRulesAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded(async (actor) => {
    const weekdays = form.getAll("weekday").map(String);
    const starts = form.getAll("startTime").map(String);
    const ends = form.getAll("endTime").map(String);
    const rules = weekdays
      .map((w, i) => ({ weekday: w, startTime: starts[i] ?? "", endTime: ends[i] ?? "" }))
      .filter((r) => r.startTime || r.endTime);
    await replaceRules(str(form, "specialtyId"), rules, actor);
    return { ok: true, message: "Horarios de atención guardados." };
  });
}

export async function addExceptionAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded(async (actor) => {
    const startDay = str(form, "startDay");
    const { affected } = await addException(
      {
        specialtyId: str(form, "specialtyId"),
        kind: str(form, "kind"),
        startDay,
        endDay: str(form, "endDay") || startDay,
        allDay: bool(form, "allDay"),
        startTime: str(form, "startTime"),
        endTime: str(form, "endTime"),
        reason: str(form, "reason"),
      },
      actor,
    );
    const { settings } = await loadSiteConfig();
    if (affected.length) {
      return {
        ok: true,
        message: `Bloqueo agregado. Atención: hay ${affected.length} ${affected.length === 1 ? "turno confirmado" : "turnos confirmados"} en ese período que siguen vigentes. Revisalos para reprogramarlos o cancelarlos.`,
        data: affected.map((a) => ({ id: a.id, label: `${formatLongDate(a.startsAt, settings.timezone)} ${formatTime(a.startsAt, settings.timezone)} h, ${a.patientName} (${a.specialtyName})` })),
      };
    }
    return { ok: true, message: "Bloqueo agregado. Esos horarios ya no se ofrecen a los pacientes." };
  });
}

export async function deleteExceptionAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded(async (actor) => {
    await deleteException(str(form, "id"), actor);
    return { ok: true, message: "Bloqueo eliminado. Los horarios volvieron a estar disponibles." };
  });
}

// ---------------------------------------------------------------- Configuración

const SETTINGS_TEXT = [
  "appName", "honorific", "fullName", "licenseNumber", "bio", "photoUrl", "addressLine", "addressDetails", "city", "mapsUrl",
  "arrivalInstructions", "publicHoursText", "contactPhone", "contactWhatsapp", "contactEmail", "patientChangeMinHours",
  "reminderHoursBefore", "holdMinutes", "cancellationPolicyText", "privacyControllerName", "privacyControllerContact",
];
const SETTINGS_BOOL = ["showPublicHours", "phoneRequired", "requireEmailVerification", "allowPatientCancel", "allowPatientReschedule"];

export async function saveSettingsAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded(async (actor) => {
    const input: Record<string, unknown> = {};
    for (const k of SETTINGS_TEXT) input[k] = str(form, k);
    for (const k of SETTINGS_BOOL) input[k] = bool(form, k);
    await updateSettings(input, actor);
    return { ok: true, message: "Configuración guardada." };
  });
}

export async function saveTemplateAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded(async (actor) => {
    await updateTemplate(str(form, "kind"), { subject: str(form, "subject"), body: str(form, "body") }, actor);
    return { ok: true, message: "Plantilla guardada." };
  });
}

export async function retryNotificationAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded(async () => {
    const r = await retryJob(str(form, "id"));
    if (!r) throw new AdminError("Solo se pueden reintentar notificaciones fallidas.");
    return r.sent
      ? { ok: true, message: "Correo enviado." }
      : { ok: false, message: "El reintento volvió a fallar. Revisá el detalle del error." };
  });
}
