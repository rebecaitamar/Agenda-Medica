/**
 * Pruebas de integración contra PostgreSQL real (migraciones reales) y un
 * servidor de prueba que imita la API de Resend. Cubren el motor de
 * disponibilidad, reservas, concurrencia, notificaciones, reintentos,
 * aislamiento de datos y zona horaria.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "@/lib/db";
import { getSlots } from "@/lib/availability";
import {
  BookingError, cancelByPatient, findByManageToken, rescheduleByPatient, resendVerificationCode, startOnlineBooking, verifyBooking,
} from "@/lib/booking";
import { cancelAppointment, createManualAppointment, rescheduleAppointment } from "@/lib/admin/appointments";
import { addException, getRules, replaceRules, updateSettings, updateSpecialty } from "@/lib/admin/config";
import { dispatchJobs, retryJob, runDueNotifications } from "@/lib/notifications/worker";
import { loadSiteConfig } from "@/lib/settings";
import { addDays, formatDate, formatTime, localDate } from "@/lib/time";
import { actor, at, futureWeekday, patient, resetData, specialty, startMail, TZ } from "./helpers";
import type { MockResend } from "../support/mock-resend";

let mail: MockResend;
const BASE = "https://turnos.example.test";

async function weekdayRules(slug: "medicina-clinica" | "dermatologia", ranges = [["09:00", "13:00"], ["14:00", "18:00"]]) {
  const s = await specialty(slug);
  await replaceRules(
    s.id,
    [1, 2, 3, 4, 5].flatMap((wd) => ranges.map(([startTime, endTime]) => ({ weekday: wd, startTime, endTime }))),
    actor,
  );
  return s;
}

/** Reserva online completa: formulario → código por correo → verificación. */
async function bookOnline(slug: string, startsAt: Date, n = 1) {
  const p = patient(n);
  const r = await startOnlineBooking({ specialty: slug, startsAt: startsAt.toISOString(), ...p }, BASE);
  if (r.state !== "verify") throw new Error("se esperaba verificación");
  const code = mail.lastCode(p.email);
  expect(code).toMatch(/^\d{6}$/);
  const v = await verifyBooking({ bookingId: r.bookingId, code }, BASE);
  await dispatchJobs(v.jobIds);
  return { id: r.bookingId, ...v, email: p.email };
}

const jobsOf = (id: string) =>
  sql<{ kind: string; status: string; runAt: Date; idempotencyKey: string; attempts: number; lastError: string | null }[]>`
    select kind, status, run_at, idempotency_key, attempts, last_error from notification_jobs where appointment_id = ${id} order by created_at`;

beforeAll(async () => {
  mail = await startMail();
});
afterAll(async () => {
  await mail.stop();
  await sql.end();
});
beforeEach(async () => {
  await resetData();
  mail.reset();
});

describe("1. Configuración de horarios por especialidad", () => {
  it("guarda franjas y parámetros independientes para cada especialidad", async () => {
    const clin = await weekdayRules("medicina-clinica", [["09:00", "12:00"]]);
    const derm = await weekdayRules("dermatologia", [["15:00", "19:00"]]);
    await updateSpecialty(derm.id, { name: "Dermatología", description: "", durationMinutes: 15, bufferMinutes: 5, minNoticeHours: 4, maxAdvanceDays: 30, active: true }, actor);
    expect(await getRules(clin.id)).toHaveLength(5);
    expect((await getRules(derm.id))[0]).toEqual({ weekday: 1, startTime: "15:00", endTime: "19:00" });

    const day = futureWeekday(3);
    const c = await getSlots(clin.id, day, day);
    const d = await getSlots(derm.id, day, day);
    expect(c.map((s) => formatTime(s.startsAt, TZ))).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
    // 15 min + 5 de descanso → cada 20 min, el último que termina antes de las 19:00 empieza 18:40
    expect(d.map((s) => formatTime(s.startsAt, TZ)).slice(0, 4)).toEqual(["15:00", "15:20", "15:40", "16:00"]);
    expect(formatTime(d.at(-1)!.startsAt, TZ)).toBe("18:40");
    expect((d[0].endsAt.getTime() - d[0].startsAt.getTime()) / 60000).toBe(15);
  });

  it("rechaza franjas superpuestas y horas inválidas", async () => {
    const s = await specialty("medicina-clinica");
    await expect(replaceRules(s.id, [{ weekday: 1, startTime: "09:00", endTime: "12:00" }, { weekday: 1, startTime: "11:00", endTime: "13:00" }], actor)).rejects.toThrow(/superpuestas/);
    await expect(replaceRules(s.id, [{ weekday: 1, startTime: "12:00", endTime: "09:00" }], actor)).rejects.toThrow(/posterior/);
  });

  it("respeta anticipación mínima y horizonte máximo", async () => {
    const s = await weekdayRules("medicina-clinica");
    await sql`update specialties set max_advance_days = 10 where id = ${s.id}`;
    const far = futureWeekday(20);
    expect(await getSlots(s.id, far, far)).toHaveLength(0);
    await sql`update specialties set min_notice_hours = 720 where id = ${s.id}`;
    const near = futureWeekday(3);
    expect(await getSlots(s.id, near, near)).toHaveLength(0);
  });
});

describe("2–5. Consulta de disponibilidad, reserva y confirmación", () => {
  it("muestra solo horarios libres reales y la reserva queda guardada y confirmada", async () => {
    await weekdayRules("medicina-clinica");
    const s = await specialty("medicina-clinica");
    const day = futureWeekday(5);
    const before = await getSlots(s.id, day, day);
    expect(before.length).toBe(16); // 8 de mañana + 8 de tarde
    const start = at(day, "10:00");

    const r = await startOnlineBooking({ specialty: s.slug, startsAt: start.toISOString(), ...patient(1) }, BASE);
    expect(r.state).toBe("verify");
    // Retenido mientras se verifica: ya no se ofrece a otros
    expect((await getSlots(s.id, day, day)).some((x) => x.startsAt.getTime() === start.getTime())).toBe(false);
    const [hold] = await sql`select status from appointments where id = ${r.state === "verify" ? r.bookingId : ""}`;
    expect(hold.status).toBe("pending_verification");

    const codeMail = mail.to("paciente1@example.test")[0];
    expect(codeMail.subject).toBe("Tu código para confirmar el turno");
    const code = mail.lastCode("paciente1@example.test")!;
    const v = await verifyBooking({ bookingId: (r as { bookingId: string }).bookingId, code }, BASE);
    expect(v.summary.specialtyName).toBe("Medicina Clínica");
    expect(v.summary.address).toBe("Av. Siempreviva 742, Rosario");
    expect(v.summary.manageUrl).toMatch(/^https:\/\/turnos\.example\.test\/turno\/[A-Za-z0-9_-]{30,}$/);

    const [row] = await sql<{ status: string; startsAt: Date; endsAt: Date; patientEmail: string }[]>`
      select a.status, a.starts_at, a.ends_at, p.email as patient_email from appointments a join patients p on p.id = a.patient_id`;
    expect(row.status).toBe("confirmed");
    expect(row.startsAt.toISOString()).toBe(start.toISOString());
    expect(row.endsAt.getTime() - row.startsAt.getTime()).toBe(30 * 60000);

    // 5. Correo de confirmación con los datos exigidos
    await dispatchJobs(v.jobIds);
    const conf = mail.to("paciente1@example.test").find((m) => m.subject === "Confirmación de turno médico")!;
    expect(conf).toBeTruthy();
    for (const txt of ["Dra. Ana Prueba", "Medicina Clínica", formatDate(start, TZ), "10:00", "Av. Siempreviva 742, Rosario", "Ver o modificar mi turno"]) {
      expect(conf.text).toContain(txt);
    }
    const jobs = await jobsOf(row ? (r as { bookingId: string }).bookingId : "");
    expect(jobs.find((j) => j.kind === "confirmation")!.status).toBe("sent");
  });

  it("valida en el servidor los datos del formulario", async () => {
    await weekdayRules("medicina-clinica");
    const start = at(futureWeekday(5), "10:00").toISOString();
    const bad = (over: Record<string, unknown>) =>
      startOnlineBooking({ specialty: "medicina-clinica", startsAt: start, ...patient(1), ...over }, BASE).catch((e: BookingError) => e);
    expect(((await bad({ email: "no-es-correo" })) as BookingError).field).toBe("email");
    expect(((await bad({ fullName: "Ana" })) as BookingError).field).toBe("fullName");
    expect(((await bad({ acceptPrivacy: false })) as BookingError).field).toBe("acceptPrivacy");
    expect(((await bad({ startsAt: at(futureWeekday(5), "10:10").toISOString() })) as BookingError).code).toBe("slot_unavailable");
    await sql`update clinic_settings set phone_required = true`;
    expect(((await bad({ phone: "" })) as BookingError).field).toBe("phone");
  });

  it("limita los intentos de código y libera el horario al agotarse", async () => {
    await weekdayRules("medicina-clinica");
    const s = await specialty("medicina-clinica");
    const day = futureWeekday(5);
    const start = at(day, "11:00");
    const r = (await startOnlineBooking({ specialty: s.slug, startsAt: start.toISOString(), ...patient(1) }, BASE)) as { bookingId: string };
    const good = mail.lastCode("paciente1@example.test")!;
    const wrong = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) await expect(verifyBooking({ bookingId: r.bookingId, code: wrong }, BASE)).rejects.toMatchObject({ code: "wrong_code" });
    await expect(verifyBooking({ bookingId: r.bookingId, code: wrong }, BASE)).rejects.toMatchObject({ code: "too_many_attempts" });
    await expect(verifyBooking({ bookingId: r.bookingId, code: good }, BASE)).rejects.toMatchObject({ code: "not_found" });
    expect((await getSlots(s.id, day, day)).some((x) => x.startsAt.getTime() === start.getTime())).toBe(true);
  });

  it("una retención vencida libera el horario y no se puede confirmar", async () => {
    await weekdayRules("medicina-clinica");
    const s = await specialty("medicina-clinica");
    const day = futureWeekday(5);
    const start = at(day, "12:00");
    const r = (await startOnlineBooking({ specialty: s.slug, startsAt: start.toISOString(), ...patient(1) }, BASE)) as { bookingId: string };
    await sql`update appointments set hold_expires_at = now() - interval '1 minute' where id = ${r.bookingId}`;
    expect((await getSlots(s.id, day, day)).some((x) => x.startsAt.getTime() === start.getTime())).toBe(true);
    await expect(verifyBooking({ bookingId: r.bookingId, code: mail.lastCode("paciente1@example.test") }, BASE)).rejects.toMatchObject({ code: "expired" });
    // Otro paciente puede reservarlo
    await bookOnline(s.slug, start, 2);
  });

  it("reenvía el código con un límite", async () => {
    await weekdayRules("medicina-clinica");
    const r = (await startOnlineBooking({ specialty: "medicina-clinica", startsAt: at(futureWeekday(5), "09:00").toISOString(), ...patient(1) }, BASE)) as { bookingId: string };
    await resendVerificationCode({ bookingId: r.bookingId });
    await resendVerificationCode({ bookingId: r.bookingId });
    await expect(resendVerificationCode({ bookingId: r.bookingId })).rejects.toMatchObject({ code: "resend_limit" });
    expect(mail.to("paciente1@example.test")).toHaveLength(3);
    // el último código es el válido
    await verifyBooking({ bookingId: r.bookingId, code: mail.lastCode("paciente1@example.test") }, BASE);
  });
});

describe("6–9. Recordatorios", () => {
  it("6. programa el recordatorio exactamente 48 h antes", async () => {
    await weekdayRules("medicina-clinica");
    const start = at(futureWeekday(6), "15:30");
    const b = await bookOnline("medicina-clinica", start);
    const rem = (await jobsOf(b.id)).find((j) => j.kind === "reminder")!;
    expect(rem.status).toBe("pending");
    expect(rem.runAt.getTime()).toBe(start.getTime() - 48 * 3600_000);
  });

  it("7. la tarea del servidor envía el recordatorio solo cuando corresponde, una única vez", async () => {
    await weekdayRules("medicina-clinica");
    const start = at(futureWeekday(6), "09:30");
    const b = await bookOnline("medicina-clinica", start);
    mail.reset();
    await runDueNotifications();
    expect(mail.emails).toHaveLength(0); // todavía no es momento
    // Simula el paso del tiempo hasta la hora programada
    await sql`update notification_jobs set run_at = now() - interval '1 minute' where appointment_id = ${b.id} and kind = 'reminder'`;
    const r1 = await runDueNotifications();
    expect(r1.sent).toBe(1);
    const rem = mail.to(b.email)[0];
    expect(rem.subject).toBe("Recordatorio de tu turno médico");
    expect(rem.text).toContain("09:30");
    expect(rem.text).toContain("Av. Siempreviva 742");
    await runDueNotifications();
    await runDueNotifications();
    expect(mail.to(b.email)).toHaveLength(1);
    const [log] = await sql`select count(*)::int as n from notification_logs l join notification_jobs j on j.id = l.job_id where j.appointment_id = ${b.id} and j.kind = 'reminder' and l.outcome = 'sent'`;
    expect(log.n).toBe(1);
  });

  it("8. no envía recordatorios de turnos cancelados", async () => {
    await weekdayRules("medicina-clinica");
    const b = await bookOnline("medicina-clinica", at(futureWeekday(6), "10:30"));
    const { jobIds } = await cancelAppointment(b.id, { reason: "La profesional no atiende ese día", notify: true }, actor);
    await dispatchJobs(jobIds);
    const jobs = await jobsOf(b.id);
    expect(jobs.find((j) => j.kind === "reminder")!.status).toBe("cancelled");
    const cancelMail = mail.to(b.email).find((m) => m.subject === "Tu turno médico fue cancelado")!;
    expect(cancelMail.text).toContain("Motivo: La profesional no atiende ese día");
    // Aunque el trabajo quedara pendiente por error, el procesador verifica el estado del turno.
    await sql`update notification_jobs set status = 'pending', run_at = now() where appointment_id = ${b.id} and kind = 'reminder'`;
    mail.reset();
    await runDueNotifications();
    expect(mail.emails).toHaveLength(0);
    expect((await jobsOf(b.id)).find((j) => j.kind === "reminder")!.lastError).toBe("El turno ya no está vigente");
  });

  it("9. una reprogramación reemplaza el recordatorio y avisa al paciente", async () => {
    await weekdayRules("medicina-clinica");
    const s = await specialty("medicina-clinica");
    const first = at(futureWeekday(6), "11:00");
    const b = await bookOnline("medicina-clinica", first);
    const day2 = futureWeekday(9);
    const second = at(day2, "16:00");
    const { jobIds } = await rescheduleAppointment(b.id, { startsAt: second.toISOString(), notify: true }, actor);
    await dispatchJobs(jobIds);
    const jobs = await jobsOf(b.id);
    const reminders = jobs.filter((j) => j.kind === "reminder");
    expect(reminders.map((j) => j.status)).toEqual(["cancelled", "pending"]);
    expect(reminders[1].runAt.getTime()).toBe(second.getTime() - 48 * 3600_000);
    expect(reminders[1].idempotencyKey).toBe(`reminder:${b.id}:v2`);
    const resch = mail.to(b.email).find((m) => m.subject === "Tu turno médico fue reprogramado")!;
    expect(resch.text).toContain("16:00");
    expect(resch.text).toContain(formatDate(first, TZ)); // fecha anterior
    // El horario viejo quedó libre y el nuevo ocupado
    const firstDay = await getSlots(s.id, futureWeekday(6), futureWeekday(6));
    expect(firstDay.some((x) => x.startsAt.getTime() === first.getTime())).toBe(true);
    expect((await getSlots(s.id, day2, day2)).some((x) => x.startsAt.getTime() === second.getTime())).toBe(false);
  });

  it("turnos con menos de 48 h de anticipación no reciben un recordatorio atrasado", async () => {
    await sql`update clinic_settings set require_email_verification = false`;
    await sql`update specialties set min_notice_hours = 0`;
    const s = await specialty("medicina-clinica");
    await replaceRules(s.id, [1, 2, 3, 4, 5, 6, 7].map((wd) => ({ weekday: wd, startTime: "00:00", endTime: "23:30" })), actor);
    const today = localDate(new Date(), TZ);
    const soon = (await getSlots(s.id, today, addDays(today, 1))).find((x) => x.startsAt.getTime() > Date.now() + 3 * 3600_000)!;
    const r = await startOnlineBooking({ specialty: s.slug, startsAt: soon.startsAt.toISOString(), ...patient(1) }, BASE);
    expect(r.state).toBe("confirmed");
    const [{ id }] = await sql<{ id: string }[]>`select id from appointments`;
    const rem = (await jobsOf(id)).find((j) => j.kind === "reminder")!;
    expect(rem.status).toBe("skipped");
    expect(rem.lastError).toMatch(/menos de 48 h/);
    await runDueNotifications();
    expect(mail.emails.filter((m) => m.subject.startsWith("Recordatorio"))).toHaveLength(0);
  });

  it("un recordatorio muy atrasado (servidor caído) se omite en lugar de enviarse tarde", async () => {
    await weekdayRules("medicina-clinica");
    const b = await bookOnline("medicina-clinica", at(futureWeekday(6), "14:00"));
    await sql`update notification_jobs set run_at = now() - interval '7 hours' where appointment_id = ${b.id} and kind = 'reminder'`;
    mail.reset();
    await runDueNotifications();
    expect(mail.emails).toHaveLength(0);
    expect((await jobsOf(b.id)).find((j) => j.kind === "reminder")!.status).toBe("skipped");
  });

  it("cambiar la anticipación de los recordatorios recalcula los pendientes", async () => {
    await weekdayRules("medicina-clinica");
    const start = at(futureWeekday(8), "10:00");
    const b = await bookOnline("medicina-clinica", start);
    const { settings, profile } = await loadSiteConfig();
    await updateSettings({ ...settings, ...profile, fullName: profile.fullName, reminderHoursBefore: 24 }, actor);
    const rem = (await jobsOf(b.id)).find((j) => j.kind === "reminder" && j.status === "pending")!;
    expect(rem.runAt.getTime()).toBe(start.getTime() - 24 * 3600_000);
  });
});

describe("10. Reservas simultáneas", () => {
  it("dos pacientes piden el mismo horario a la vez: solo uno lo obtiene (con verificación)", async () => {
    await weekdayRules("medicina-clinica");
    const start = at(futureWeekday(5), "09:30").toISOString();
    const results = await Promise.allSettled([1, 2, 3, 4].map((n) => startOnlineBooking({ specialty: "medicina-clinica", startsAt: start, ...patient(n) }, BASE)));
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(rejected.every((r) => (r.reason as BookingError).code === "slot_unavailable")).toBe(true);
    const [n] = await sql`select count(*)::int as n from appointments where status in ('pending_verification', 'confirmed')`;
    expect(n.n).toBe(1);
  });

  it("sin verificación de correo, tampoco se pueden confirmar dos turnos superpuestos", async () => {
    await weekdayRules("medicina-clinica");
    await weekdayRules("dermatologia");
    await sql`update clinic_settings set require_email_verification = false`;
    const day = futureWeekday(5);
    // Clínica 10:00–10:30 y Dermatología 10:20–10:40 se superponen: misma médica, mismo consultorio.
    const results = await Promise.allSettled([
      startOnlineBooking({ specialty: "medicina-clinica", startsAt: at(day, "10:00").toISOString(), ...patient(1) }, BASE),
      startOnlineBooking({ specialty: "dermatologia", startsAt: at(day, "10:20").toISOString(), ...patient(2) }, BASE),
      startOnlineBooking({ specialty: "medicina-clinica", startsAt: at(day, "10:00").toISOString(), ...patient(3) }, BASE),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("la base rechaza superposiciones aunque se salteen las validaciones de la aplicación", async () => {
    await weekdayRules("medicina-clinica");
    const b = await bookOnline("medicina-clinica", at(futureWeekday(5), "15:00"));
    const [a] = await sql`select specialty_id, patient_id from appointments where id = ${b.id}`;
    await expect(sql`
      insert into appointments (specialty_id, patient_id, starts_at, ends_at, blocked_until, status, source, manage_token_salt, manage_token_hash)
      values (${a.specialtyId}, ${a.patientId}, ${at(futureWeekday(5), "15:15")}, ${at(futureWeekday(5), "15:45")}, ${at(futureWeekday(5), "15:45")}, 'confirmed', 'admin', 'x', 'y')`).rejects.toMatchObject({ code: "23P01" });
  });
});

describe("11–12. Bloqueos y liberación de horarios", () => {
  it("11. un bloqueo hace que el horario deje de estar disponible", async () => {
    await weekdayRules("medicina-clinica");
    await weekdayRules("dermatologia");
    const s = await specialty("medicina-clinica");
    const d = await specialty("dermatologia");
    const day = futureWeekday(5);
    await addException({ specialtyId: "", kind: "block", startDay: day, endDay: day, allDay: false, startTime: "10:00", endTime: "11:00", reason: "Trámite" }, actor);
    const times = (await getSlots(s.id, day, day)).map((x) => formatTime(x.startsAt, TZ));
    expect(times).not.toContain("10:00");
    expect(times).not.toContain("10:30");
    expect(times).toContain("09:30");
    expect(times).toContain("11:00");
    // Bloqueo de día completo solo para Dermatología
    const day2 = futureWeekday(6);
    await addException({ specialtyId: d.id, kind: "vacation", startDay: day2, endDay: day2, allDay: true, reason: "" }, actor);
    expect(await getSlots(d.id, day2, day2)).toHaveLength(0);
    expect((await getSlots(s.id, day2, day2)).length).toBeGreaterThan(0);
    await expect(startOnlineBooking({ specialty: "medicina-clinica", startsAt: at(day, "10:30").toISOString(), ...patient(1) }, BASE)).rejects.toMatchObject({ code: "slot_unavailable" });
  });

  it("un bloqueo sobre turnos existentes los informa para que la médica decida", async () => {
    await weekdayRules("medicina-clinica");
    const day = futureWeekday(5);
    await bookOnline("medicina-clinica", at(day, "09:00"));
    const r = await addException({ specialtyId: "", kind: "holiday", startDay: day, endDay: day, allDay: true, reason: "Feriado" }, actor);
    expect(r.affected).toHaveLength(1);
  });

  it("12. un turno cancelado libera el horario (por la médica o por el paciente)", async () => {
    await weekdayRules("medicina-clinica");
    const s = await specialty("medicina-clinica");
    const day = futureWeekday(5);
    const start = at(day, "16:30");
    const b = await bookOnline("medicina-clinica", start);
    const has = async () => (await getSlots(s.id, day, day)).some((x) => x.startsAt.getTime() === start.getTime());
    expect(await has()).toBe(false);
    await cancelAppointment(b.id, { notify: false }, actor);
    expect(await has()).toBe(true);

    const b2 = await bookOnline("medicina-clinica", start, 2);
    expect(await has()).toBe(false);
    const token = b2.summary.manageUrl.split("/").pop()!;
    await cancelByPatient(token);
    expect(await has()).toBe(true);
  });
});

describe("14. Aislamiento de datos de pacientes", () => {
  it("el enlace de gestión solo da acceso al propio turno y la disponibilidad no expone datos", async () => {
    await weekdayRules("medicina-clinica");
    const day = futureWeekday(5);
    const a = await bookOnline("medicina-clinica", at(day, "09:00"), 1);
    const b = await bookOnline("medicina-clinica", at(day, "09:30"), 2);
    const tokenA = a.summary.manageUrl.split("/").pop()!;
    const found = await findByManageToken(tokenA);
    expect(found?.id).toBe(a.id);
    expect(found?.id).not.toBe(b.id);
    expect(JSON.stringify(found)).not.toContain("paciente2");
    // Token inventado o alterado
    expect(await findByManageToken(tokenA.slice(0, -2) + "xx")).toBeNull();
    expect(await findByManageToken("a".repeat(43))).toBeNull();
    // Reprogramar con el token de A no toca el turno de B
    await rescheduleByPatient(tokenA, at(day, "11:00").toISOString());
    const [rowB] = await sql`select starts_at, status from appointments where id = ${b.id}`;
    expect(rowB.startsAt.toISOString()).toBe(at(day, "09:30").toISOString());
    // La función de disponibilidad solo devuelve horarios
    const slots = await getSlots((await specialty("medicina-clinica")).id, day, day);
    expect(Object.keys(slots[0]).sort()).toEqual(["endsAt", "startsAt"]);
  });

  it("RLS: con la clave pública (roles anon/authenticated) no se puede leer ni escribir ninguna tabla", async () => {
    await weekdayRules("medicina-clinica");
    await bookOnline("medicina-clinica", at(futureWeekday(5), "09:00"));
    const raw = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      const tables = await raw<{ tablename: string; rowsecurity: boolean }[]>`
        select tablename, rowsecurity from pg_tables where schemaname = 'public'`;
      expect(tables.length).toBeGreaterThanOrEqual(13);
      expect(tables.filter((t) => !t.rowsecurity)).toEqual([]);
      for (const role of ["anon", "authenticated"]) {
        for (const t of tables) {
          await expect(raw.begin(async (tx) => {
            await tx.unsafe(`set local role ${role}`);
            await tx.unsafe(`select * from public.${t.tablename} limit 1`);
          })).rejects.toMatchObject({ code: "42501" });
        }
        await expect(raw.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx.unsafe(`select * from public.available_slots(gen_random_uuid(), current_date, current_date)`);
        })).rejects.toMatchObject({ code: "42501" });
      }
    } finally {
      await raw.end();
    }
  });
});

describe("15. Persistencia", () => {
  it("los datos sobreviven a una conexión nueva (reinicio de la aplicación)", async () => {
    await weekdayRules("medicina-clinica");
    const b = await bookOnline("medicina-clinica", at(futureWeekday(5), "10:00"));
    const other = postgres(process.env.DATABASE_URL!, { max: 1 });
    const [row] = await other`select status from appointments where id = ${b.id}`;
    const [job] = await other`select count(*)::int as n from notification_jobs where appointment_id = ${b.id} and kind = 'reminder' and status = 'pending'`;
    await other.end();
    expect(row.status).toBe("confirmed");
    expect(job.n).toBe(1);
  });
});

describe("16. Correos fallidos y reintentos sin duplicados", () => {
  it("registra el fallo, reintenta con espera y no duplica", async () => {
    await weekdayRules("medicina-clinica");
    await sql`update clinic_settings set require_email_verification = false`;
    mail.failNext = 1;
    const r = await startOnlineBooking({ specialty: "medicina-clinica", startsAt: at(futureWeekday(5), "10:00").toISOString(), ...patient(1) }, BASE);
    if (r.state !== "confirmed") throw new Error();
    const s1 = await dispatchJobs(r.jobIds);
    expect(s1.retrying).toBe(1);
    const [job] = await sql<{ id: string; status: string; attempts: number; runAt: Date; lastError: string }[]>`
      select id, status, attempts, run_at, last_error from notification_jobs where kind = 'confirmation'`;
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(1);
    expect(job.lastError).toMatch(/500/);
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000); // espera de ~5 min
    const [l1] = await sql`select outcome, error from notification_logs where job_id = ${job.id}`;
    expect(l1.outcome).toBe("failed");

    await sql`update notification_jobs set run_at = now() where id = ${job.id}`;
    await runDueNotifications();
    await runDueNotifications();
    const confirmations = mail.emails.filter((m) => m.subject === "Confirmación de turno médico");
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0].idempotencyKey).toBe(`confirmation:${(await sql`select appointment_id from notification_jobs where id = ${job.id}`)[0].appointmentId}`);
    const logs = await sql`select outcome from notification_logs where job_id = ${job.id} order by id`;
    expect(logs.map((l) => l.outcome)).toEqual(["failed", "sent"]);
  });

  it("tras agotar los intentos queda como fallido y se puede reintentar manualmente", async () => {
    await weekdayRules("medicina-clinica");
    await sql`update clinic_settings set require_email_verification = false`;
    const saved = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "";
    const r = await startOnlineBooking({ specialty: "medicina-clinica", startsAt: at(futureWeekday(5), "11:00").toISOString(), ...patient(1) }, BASE);
    if (r.state !== "confirmed") throw new Error();
    await dispatchJobs(r.jobIds);
    const [job] = await sql<{ id: string; status: string; lastError: string }[]>`select id, status, last_error from notification_jobs where kind = 'confirmation'`;
    expect(job.status).toBe("failed"); // falta configuración: no se reintenta solo
    expect(job.lastError).toMatch(/RESEND_API_KEY/);
    process.env.RESEND_API_KEY = saved;
    const res = await retryJob(job.id);
    expect(res?.sent).toBe(1);
    expect(await retryJob(job.id)).toBeNull(); // ya enviado: no se puede reenviar
    expect(mail.emails.filter((m) => m.subject === "Confirmación de turno médico")).toHaveLength(1);
  });

  it("dos procesadores en paralelo no envían dos veces el mismo correo", async () => {
    await weekdayRules("medicina-clinica");
    const day = futureWeekday(6);
    const ids: string[] = [];
    for (const [i, t] of ["09:00", "09:30", "10:00", "10:30"].entries()) ids.push((await bookOnline("medicina-clinica", at(day, t), i + 1)).id);
    await sql`update notification_jobs set run_at = now() - interval '1 minute' where kind = 'reminder'`;
    mail.reset();
    await Promise.all([runDueNotifications(), runDueNotifications(), runDueNotifications()]);
    expect(mail.emails.filter((m) => m.subject.startsWith("Recordatorio"))).toHaveLength(4);
    expect(mail.requests).toBe(4);
  });

  it("si el código de verificación no se puede enviar, se libera el horario y se informa", async () => {
    await weekdayRules("medicina-clinica");
    const s = await specialty("medicina-clinica");
    const day = futureWeekday(5);
    const start = at(day, "12:30");
    mail.failNext = 1;
    await expect(startOnlineBooking({ specialty: s.slug, startsAt: start.toISOString(), ...patient(1) }, BASE)).rejects.toMatchObject({ code: "email_failed" });
    expect((await getSlots(s.id, day, day)).some((x) => x.startsAt.getTime() === start.getTime())).toBe(true);
    const [j] = await sql`select status from notification_jobs where kind = 'verification_code'`;
    expect(j.status).toBe("failed");
  });
});

describe("18. Zona horaria de Argentina", () => {
  it("interpreta los horarios de atención en hora de Buenos Aires y los guarda en UTC", async () => {
    await weekdayRules("medicina-clinica", [["09:00", "10:00"]]);
    const s = await specialty("medicina-clinica");
    const day = futureWeekday(5);
    const slots = await getSlots(s.id, day, day);
    expect(slots[0].startsAt.toISOString()).toBe(`${day}T12:00:00.000Z`); // 09:00 −03:00
    expect(formatTime(slots[0].startsAt, TZ)).toBe("09:00");
    expect(formatDate(slots[0].startsAt, TZ)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it("una franja nocturna local que cruza la medianoche UTC queda en el día local correcto", async () => {
    const s = await specialty("medicina-clinica");
    await replaceRules(s.id, [1, 2, 3, 4, 5].map((wd) => ({ weekday: wd, startTime: "21:00", endTime: "22:00" })), actor);
    const day = futureWeekday(5);
    const slots = await getSlots(s.id, day, day);
    expect(slots.map((x) => formatTime(x.startsAt, TZ))).toEqual(["21:00", "21:30"]);
    // 21:00 en Buenos Aires = 00:00 UTC del día siguiente
    expect(slots[0].startsAt.toISOString().slice(11, 16)).toBe("00:00");
    expect(formatDate(slots[0].startsAt, TZ)).toBe(formatDate(at(day, "12:00"), TZ));
  });

  it("los bloqueos de día completo usan la medianoche local", async () => {
    const s = await specialty("medicina-clinica");
    await replaceRules(s.id, [1, 2, 3, 4, 5].map((wd) => ({ weekday: wd, startTime: "00:00", endTime: "23:30" })), actor);
    const day = futureWeekday(5);
    await addException({ specialtyId: "", kind: "holiday", startDay: day, endDay: day, allDay: true, reason: "" }, actor);
    const [e] = await sql`select starts_at, ends_at from availability_exceptions`;
    expect(e.startsAt.toISOString()).toBe(`${day}T03:00:00.000Z`);
    expect(await getSlots(s.id, day, day)).toHaveLength(0);
  });
});

describe("Gestión desde el panel", () => {
  it("crea un turno manual, incluso sin correo, y registra el historial", async () => {
    await weekdayRules("medicina-clinica");
    const s = await specialty("medicina-clinica");
    const start = at(futureWeekday(5), "17:00");
    const { id, jobIds } = await createManualAppointment({ specialtyId: s.id, startsAt: start.toISOString(), fullName: "Pedro Sin Correo", email: "", phone: "341 555 1234" }, actor);
    await dispatchJobs(jobIds);
    expect(mail.emails).toHaveLength(0);
    const jobs = await jobsOf(id);
    expect(jobs.every((j) => j.status === "skipped" && j.lastError === "El paciente no tiene correo registrado")).toBe(true);
    const [h] = await sql`select action, actor_type from audit_logs where entity_id = ${id}`;
    expect(h).toMatchObject({ action: "appointment.created", actorType: "admin" });
  });

  it("permite un sobreturno fuera de agenda pero nunca superpuesto", async () => {
    await weekdayRules("medicina-clinica");
    const s = await specialty("medicina-clinica");
    const day = futureWeekday(5);
    await expect(createManualAppointment({ specialtyId: s.id, startsAt: at(day, "19:00").toISOString(), fullName: "Ana Extra", email: "" }, actor)).rejects.toThrow(/no está disponible/);
    await createManualAppointment({ specialtyId: s.id, startsAt: at(day, "19:00").toISOString(), fullName: "Ana Extra", email: "", allowOutsideRules: true }, actor);
    await expect(createManualAppointment({ specialtyId: s.id, startsAt: at(day, "19:15").toISOString(), fullName: "Otra Persona", email: "", allowOutsideRules: true }, actor)).rejects.toThrow(/superpone/);
  });

  it("el paciente no puede cancelar online fuera del plazo configurado", async () => {
    await weekdayRules("medicina-clinica");
    const b = await bookOnline("medicina-clinica", at(futureWeekday(5), "09:00"));
    await sql`update clinic_settings set patient_change_min_hours = 720`;
    await expect(cancelByPatient(b.summary.manageUrl.split("/").pop()!)).rejects.toMatchObject({ code: "too_late" });
    await sql`update clinic_settings set patient_change_min_hours = 24, allow_patient_cancel = false`;
    await expect(cancelByPatient(b.summary.manageUrl.split("/").pop()!)).rejects.toMatchObject({ code: "not_allowed" });
  });
});
