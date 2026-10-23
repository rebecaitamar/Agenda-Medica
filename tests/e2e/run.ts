/**
 * Pruebas de punta a punta: compila y levanta la aplicación real (next build +
 * next start) contra PostgreSQL, y la recorre con un navegador Chromium en
 * tamaño de celular y de escritorio.
 *
 * Dobles de prueba (solo aquí): MockResend imita la API de Resend y AuthStub
 * imita el subconjunto de Supabase Auth que usa el panel. Todo lo demás
 * (base de datos, reglas, reservas, cola de correos, tarea programada) es real.
 *
 *   npm run test:e2e            (requiere PostgreSQL local en 127.0.0.1:5432)
 */
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import chromium from "@sparticuz/chromium";
import { chromium as pw, type Browser, type Page } from "playwright-core";
import { MockResend } from "../support/mock-resend";
import { AuthStub } from "../support/auth-stub";
import { freshDatabase } from "../support/db";

const PORT = 3210;
const AUTH_PORT = 54329;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.E2E_SCREENSHOTS ?? join(process.cwd(), "tests/e2e/screenshots");
const ADMIN = { email: "dra.prueba@example.test", password: "clave-segura-de-prueba", id: "00000000-0000-4000-8000-0000000000a1" };
const TZ = "America/Argentina/Buenos_Aires";
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

type Result = { n: string; name: string; ok: boolean; detail?: string };
const results: Result[] = [];
let server: ChildProcess | null = null;
let serverOutput = "";

async function step(n: string, name: string, fn: () => Promise<void>) {
  const t = Date.now();
  try {
    await fn();
    results.push({ n, name, ok: true, detail: `${Date.now() - t} ms` });
    console.log(`  ✓ ${n} ${name}`);
  } catch (e) {
    results.push({ n, name, ok: false, detail: (e as Error).message.split("\n").slice(0, 4).join(" ") });
    console.log(`  ✗ ${n} ${name}\n      ${(e as Error).message.split("\n").slice(0, 6).join("\n      ")}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | null | undefined | false>, ms = 10_000, label = "condición"): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  throw new Error(`Tiempo agotado esperando ${label}`);
}

function env(dbUrl: string, mail: MockResend): NodeJS.ProcessEnv & Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    NODE_ENV: "production" as const,
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: dbUrl,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${AUTH_PORT}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "stub-anon-key",
    APP_URL: BASE,
    APP_SECRET: "e2e-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
    CRON_SECRET: "e2e-cron-secret-0123456789",
    RESEND_API_KEY: "re_test_key",
    EMAIL_FROM: "Consultorio <turnos@example.test>",
    RESEND_API_BASE_URL: `http://127.0.0.1:${mail.port}`,
    PORT: String(PORT),
  };
}

async function startServer(e: NodeJS.ProcessEnv) {
  if (await fetch(`${BASE}/privacidad`).catch(() => null)) throw new Error(`El puerto ${PORT} ya está en uso`);
  // Proceso en su propio grupo para poder detener next-server y sus hijos juntos.
  server = spawn(join(process.cwd(), "node_modules/.bin/next"), ["start", "-p", String(PORT), "-H", "127.0.0.1"], { env: e, stdio: ["ignore", "pipe", "pipe"], detached: true });
  server.stdout!.on("data", (d) => (serverOutput += d));
  server.stderr!.on("data", (d) => (serverOutput += d));
  await until(async () => (await fetch(`${BASE}/privacidad`).catch(() => null))?.ok, 60_000, "el servidor");
  return () => serverOutput;
}

async function stopServer() {
  if (!server) return;
  const done = new Promise((r) => server!.once("exit", r));
  try {
    process.kill(-server.pid!, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
  await done;
  server = null;
}

function futureWeekday(min: number) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const d = new Date(Date.now() + min * 86_400_000);
  while ([0, 6].includes(new Date(`${fmt.format(d)}T12:00:00Z`).getUTCDay())) d.setTime(d.getTime() + 86_400_000);
  return fmt.format(d);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

async function noHorizontalScroll(page: Page, label: string) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  assert.ok(r.sw <= r.w + 1, `${label}: hay desplazamiento horizontal (${r.sw}px > ${r.w}px)`);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  console.log("Preparando base de datos, dobles de prueba y compilación…");
  const dbUrl = await freshDatabase("agenda_e2e");
  const sql = postgres(dbUrl, { max: 2, onnotice: () => {} });
  await sql`insert into auth.users (id, email) values (${ADMIN.id}, ${ADMIN.email})`;
  await sql`insert into admin_users (user_id, profile_id) select ${ADMIN.id}, profile_id from clinic_settings`;
  const mail = await new MockResend().start();
  // El doble de Auth escucha en un puerto fijo porque NEXT_PUBLIC_SUPABASE_URL se fija al compilar.
  const fixedAuth = new AuthStub();
  fixedAuth.addUser(ADMIN.email, ADMIN.password, ADMIN.id);
  fixedAuth.addUser("intruso@example.test", "otra-clave-cualquiera"); // existe en Auth pero no es administradora
  await fixedAuth.start(AUTH_PORT);
  const e = env(dbUrl, mail);

  if (!process.argv.includes("--no-build")) execFileSync("npx", ["next", "build"], { env: e, stdio: "pipe" });
  let serverLog = await startServer(e);

  let browser: Browser | null = null;
  try {
    browser = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter((a) => a !== "--single-process"), headless: true });
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-AR", timezoneId: TZ });
    desktop.setDefaultTimeout(15_000);
    const admin = await desktop.newPage();
    const day = futureWeekday(5);

    console.log("Escenarios:");

    await step("13", "Un usuario no autorizado no puede acceder al panel", async () => {
      const anon = await browser!.newContext();
      const p = await anon.newPage();
      for (const path of ["/admin", "/admin/agenda", "/admin/configuracion", "/admin/turnos/00000000-0000-0000-0000-000000000000"]) {
        await p.goto(`${BASE}${path}`);
        assert.match(p.url(), /\/admin\/login$/, `${path} no redirigió al login`);
      }
      // Usuario válido en Auth pero sin permiso de administración
      await p.fill("#email", "intruso@example.test");
      await p.fill("#password", "otra-clave-cualquiera");
      await p.click("button[type=submit]");
      await p.getByText("Esta cuenta no tiene acceso al panel.").waitFor();
      await p.goto(`${BASE}/admin`);
      assert.match(p.url(), /\/admin\/login$/);
      // Contraseña incorrecta
      await p.fill("#email", ADMIN.email);
      await p.fill("#password", "incorrecta");
      await p.click("button[type=submit]");
      await p.getByText("Correo o contraseña incorrectos.").waitFor();
      // Tarea programada sin secreto
      assert.equal((await fetch(`${BASE}/api/cron/notifications`, { method: "POST" })).status, 401);
      assert.equal((await fetch(`${BASE}/api/cron/notifications`, { method: "POST", headers: { Authorization: "Bearer incorrecto" } })).status, 401);
      await anon.close();
    });

    await step("1", "La médica inicia sesión y configura los horarios de ambas especialidades", async () => {
      await admin.goto(`${BASE}/admin/login`);
      await admin.fill("#email", ADMIN.email);
      await admin.fill("#password", ADMIN.password);
      await admin.click("button[type=submit]");
      await admin.waitForURL(`${BASE}/admin`);
      await admin.getByText("Para terminar la puesta en marcha").waitFor();
      await shot(admin, "01-panel-inicio-sin-configurar");

      await admin.goto(`${BASE}/admin/configuracion`);
      await admin.fill("#f-fullName", "Laura Ejemplo");
      await admin.fill("#f-licenseNumber", "M.P. 00000");
      await admin.fill("#f-bio", "Atención clínica y dermatológica para adultos.");
      await admin.fill("#f-addressLine", "Calle de Prueba 123");
      await admin.fill("#f-city", "Rosario, Santa Fe");
      await admin.fill("#f-arrivalInstructions", "Llegá 10 minutos antes.");
      await admin.fill("#f-contactPhone", "341 000-0000");
      await admin.click("button:has-text('Guardar configuración')");
      await admin.getByText("Configuración guardada.").waitFor();

      await admin.goto(`${BASE}/admin/horarios`);
      const sections = admin.locator("section[aria-labelledby^=sp-]");
      assert.equal(await sections.count(), 2);
      const plan = [
        { idx: 0, from: "09:00", to: "13:00" }, // Medicina Clínica, lunes a viernes 9 a 13
        { idx: 1, from: "14:00", to: "18:00" }, // Dermatología, lunes a viernes 14 a 18
      ];
      for (const { idx, from, to } of plan) {
        const sec = sections.nth(idx);
        for (let d = 0; d < 5; d++) {
          await sec.getByRole("button", { name: "Agregar horario" }).first().click();
        }
        const starts = sec.locator("input[name=startTime]");
        const ends = sec.locator("input[name=endTime]");
        assert.equal(await starts.count(), 5);
        for (let i = 0; i < 5; i++) {
          await starts.nth(i).fill(from);
          await ends.nth(i).fill(to);
        }
        await sec.getByRole("button", { name: /^Guardar horarios de/ }).click();
        await sec.getByText("Horarios de atención guardados.").waitFor();
      }
      const rules = await sql`select s.slug, count(*)::int as n, min(to_char(r.start_time,'HH24:MI')) as s, max(to_char(r.end_time,'HH24:MI')) as e
                              from availability_rules r join specialties s on s.id = r.specialty_id group by s.slug order by s.slug`;
      assert.deepEqual(rules.map((r) => [r.slug, r.n, r.s, r.e]), [["dermatologia", 5, "14:00", "18:00"], ["medicina-clinica", 5, "09:00", "13:00"]]);
      await shot(admin, "02-panel-horarios");
    });

    const mobile = await browser.newContext({ ...MOBILE, locale: "es-AR", timezoneId: TZ });
    mobile.setDefaultTimeout(15_000);
    const pat = await mobile.newPage();
    let bookedStart = "";
    let manageUrl = "";

    await step("2", "Un paciente consulta la disponibilidad real", async () => {
      await pat.goto(BASE);
      await pat.getByRole("heading", { name: "Dra. Laura Ejemplo" }).waitFor();
      assert.equal(await pat.getByText("Próximo turno disponible").count(), 2);
      await shot(pat, "03-movil-inicio");
      const r = await fetch(`${BASE}/api/public/availability?specialty=medicina-clinica&day=${day}`).then((x) => x.json());
      assert.equal(r.slots.length, 8);
      assert.deepEqual(Object.keys(r.slots[0]).sort(), ["endsAt", "startsAt"]);
    });

    await step("3", "El paciente reserva un turno correctamente (desde el celular)", async () => {
      await pat.getByRole("link", { name: "Solicitar un turno de Medicina Clínica" }).click();
      await pat.getByRole("heading", { name: "Elegí día y horario" }).waitFor();
      if (day.slice(0, 7) !== (await pat.evaluate(() => new Date().toISOString().slice(0, 7))) && !(await pat.getByRole("button", { name: new RegExp(`${day.split("-").reverse().join("/")}`) }).isVisible())) {
        await pat.getByRole("button", { name: "Mes siguiente" }).click();
      }
      const dayLabel = day.split("-").reverse().join("/");
      await pat.getByRole("button", { name: new RegExp(`${dayLabel}, 8 horarios libres`) }).click();
      await pat.getByRole("button", { name: "10:30", exact: true }).click();
      await shot(pat, "04-movil-calendario");
      await pat.getByRole("button", { name: "Continuar" }).click();
      await pat.fill("#fullName", "Carla Paciente");
      await pat.fill("#email", "carla@example.test");
      await pat.fill("#phone", "341 555-1111");
      await pat.locator("input[type=checkbox]").check();
      await shot(pat, "05-movil-datos");
      await sleep(2600); // el formulario rechaza envíos instantáneos (protección antibots)
      console.log("    · enviando formulario");
      await pat.getByRole("button", { name: "Reservar turno" }).click();
      await pat.getByRole("heading", { name: "Revisá tu correo" }).waitFor();
      console.log("    · esperando código");
      const code = await until(async () => mail.lastCode("carla@example.test"), 10_000, "el código");
      await pat.fill("#code", code);
      await shot(pat, "06-movil-codigo");
      await pat.getByRole("button", { name: "Confirmar turno" }).click();
      await pat.getByRole("heading", { name: "Turno confirmado" }).waitFor();
      await pat.locator("section[aria-labelledby=paso-listo]").getByText("Calle de Prueba 123").waitFor();
      await shot(pat, "07-movil-confirmado");
      manageUrl = (await pat.getByRole("link", { name: "Ver o modificar mi turno" }).getAttribute("href"))!;
      assert.match(manageUrl, new RegExp(`^${BASE}/turno/[A-Za-z0-9_-]{30,}$`));
      assert.ok(!/carla|Carla|example/.test(manageUrl), "el enlace no debe contener datos personales");
    });

    await step("4", "El turno queda guardado en la base de datos", async () => {
      const [a] = await sql`select a.id, a.status, a.starts_at, p.full_name, p.email, p.phone from appointments a join patients p on p.id = a.patient_id`;
      assert.equal(a.status, "confirmed");
      assert.equal(a.full_name, "Carla Paciente");
      assert.equal(a.email, "carla@example.test");
      assert.equal(new Date(a.starts_at).toISOString(), new Date(`${day}T10:30:00-03:00`).toISOString());
      bookedStart = new Date(a.starts_at).toISOString();
    });

    await step("5", "Se envía el correo de confirmación", async () => {
      const m = await until(async () => mail.to("carla@example.test").find((x) => x.subject === "Confirmación de turno médico"), 10_000, "la confirmación");
      for (const t of ["Dra. Laura Ejemplo", "Medicina Clínica", day.split("-").reverse().join("/"), "10:30", "Calle de Prueba 123", "Llegá 10 minutos antes.", "Tel. 341 000-0000", manageUrl]) {
        assert.ok(m.text.includes(t), `falta "${t}" en la confirmación`);
      }
    });

    await step("6", "El sistema programa el recordatorio para 48 horas antes", async () => {
      const [j] = await sql`select run_at, status from notification_jobs where kind = 'reminder'`;
      assert.equal(j.status, "pending");
      assert.equal(new Date(j.run_at).getTime(), new Date(bookedStart).getTime() - 48 * 3600_000);
    });

    await step("7", "El recordatorio se envía cuando corresponde, mediante la tarea del servidor", async () => {
      const cron = () => fetch(`${BASE}/api/cron/notifications`, { method: "POST", headers: { Authorization: `Bearer ${e.CRON_SECRET}` } }).then((r) => r.json());
      const r0 = await cron();
      assert.equal(r0.sent, 0, "no debe enviarse antes de tiempo");
      await sql`update notification_jobs set run_at = now() - interval '1 minute' where kind = 'reminder'`;
      const r1 = await cron();
      assert.equal(r1.sent, 1);
      const rem = mail.to("carla@example.test").filter((x) => x.subject === "Recordatorio de tu turno médico");
      assert.equal(rem.length, 1);
      await cron();
      assert.equal(mail.to("carla@example.test").filter((x) => x.subject === "Recordatorio de tu turno médico").length, 1, "sin duplicados");
    });

    await step("10", "Dos pacientes intentan reservar el mismo horario a la vez y solo uno lo obtiene", async () => {
      const html = await fetch(`${BASE}/reservar/dermatologia`).then((r) => r.text());
      const token = html.match(/formToken\\?":\\?"([0-9]+\.[A-Za-z0-9_-]+)/)?.[1];
      assert.ok(token, "no se encontró el token del formulario");
      await sleep(2600);
      const slot = new Date(`${day}T15:00:00-03:00`).toISOString();
      const body = (n: number) => JSON.stringify({ specialty: "dermatologia", startsAt: slot, fullName: `Persona Concurrente ${"ABCDEFGH"[n]}`, email: `concurrente${n}@example.test`, phone: "", acceptPrivacy: true, formToken: token, website: "" });
      const rs = await Promise.all([1, 2, 3, 4, 5].map((n) => fetch(`${BASE}/api/public/bookings`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.0.0.${n}` }, body: body(n) })));
      const statuses = rs.map((r) => r.status).sort();
      assert.deepEqual(statuses, [202, 409, 409, 409, 409], `estados: ${statuses}. Servidor: ${serverOutput.split("\n").filter((l) => /error/i.test(l)).slice(-3).join(" | ")}`);
      const [n] = await sql`select count(*)::int as n from appointments where starts_at = ${slot} and status in ('pending_verification','confirmed')`;
      assert.equal(n.n, 1);
    });

    await step("11", "La médica bloquea un horario y deja de estar disponible", async () => {
      const before = await fetch(`${BASE}/api/public/availability?specialty=medicina-clinica&day=${day}`).then((r) => r.json());
      assert.ok(before.slots.some((s: { startsAt: string }) => s.startsAt === new Date(`${day}T11:00:00-03:00`).toISOString()));
      await admin.goto(`${BASE}/admin/bloqueos`);
      await admin.locator("input[name=allDay]").uncheck();
      await admin.fill("#startDay", day);
      await admin.fill("#startTime", "11:00");
      await admin.fill("#endDay", day);
      await admin.fill("#endTime", "12:00");
      await admin.fill("#reason", "Reunión");
      await admin.getByRole("button", { name: "Agregar bloqueo" }).click();
      await admin.getByText(/Bloqueo agregado/).waitFor();
      const after = await fetch(`${BASE}/api/public/availability?specialty=medicina-clinica&day=${day}`).then((r) => r.json());
      const times = after.slots.map((s: { startsAt: string }) => s.startsAt);
      assert.ok(!times.includes(new Date(`${day}T11:00:00-03:00`).toISOString()));
      assert.ok(!times.includes(new Date(`${day}T11:30:00-03:00`).toISOString()));
      assert.ok(times.includes(new Date(`${day}T12:00:00-03:00`).toISOString()));
      await shot(admin, "08-panel-bloqueos");
    });

    let apptId = "";
    await step("9", "Una reprogramación desde el panel actualiza el recordatorio y avisa al paciente", async () => {
      [{ id: apptId }] = await sql`select id from appointments where status = 'confirmed' and source = 'online'`;
      // Recordatorio ya enviado para v1: lo dejamos como estaba y comprobamos que se programe uno nuevo para v2
      await admin.goto(`${BASE}/admin/turnos/${apptId}`);
      await admin.getByRole("heading", { name: "Carla Paciente" }).waitFor();
      const day2 = futureWeekday(9);
      await admin.fill("#day", day2);
      await admin.getByText("09:30", { exact: true }).click();
      await admin.getByRole("button", { name: "Reprogramar turno" }).click();
      await admin.getByText(/Turno reprogramado para el/).waitFor();
      const jobs = await sql`select status, run_at, idempotency_key from notification_jobs where appointment_id = ${apptId} and kind = 'reminder' order by created_at`;
      const v2 = jobs.find((j) => j.idempotency_key.endsWith(":v2"))!;
      assert.equal(v2.status, "pending");
      assert.equal(new Date(v2.run_at).getTime(), new Date(`${day2}T09:30:00-03:00`).getTime() - 48 * 3600_000);
      await until(async () => mail.to("carla@example.test").find((x) => x.subject === "Tu turno médico fue reprogramado"), 10_000, "el aviso de reprogramación");
      await shot(admin, "09-panel-detalle-turno");
    });

    await step("12", "Los horarios cancelados se liberan (cancelación por el paciente desde su enlace, en el celular)", async () => {
      const [{ starts_at }] = await sql`select starts_at from appointments where id = ${apptId}`;
      const d2 = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(starts_at));
      const slotFree = async () =>
        (await fetch(`${BASE}/api/public/availability?specialty=medicina-clinica&day=${d2}`).then((r) => r.json())).slots.some((s: { startsAt: string }) => s.startsAt === new Date(starts_at).toISOString());
      assert.equal(await slotFree(), false);
      await pat.goto(manageUrl);
      await pat.getByRole("heading", { name: "Hola, Carla" }).waitFor();
      await shot(pat, "10-movil-mi-turno");
      await pat.getByRole("button", { name: "Cancelar turno" }).click();
      await pat.getByRole("button", { name: "Sí, cancelar turno" }).click();
      await pat.getByText("Cancelamos tu turno").waitFor();
      assert.equal(await slotFree(), true);
      await until(async () => mail.to("carla@example.test").find((x) => x.subject === "Tu turno médico fue cancelado"), 10_000, "el aviso de cancelación");
    });

    await step("8", "No se envían recordatorios de turnos cancelados", async () => {
      const jobs = await sql`select status from notification_jobs where appointment_id = ${apptId} and kind = 'reminder' and idempotency_key like '%:v2'`;
      assert.equal(jobs[0].status, "cancelled");
      await sql`update notification_jobs set status = 'pending', run_at = now() - interval '1 minute' where appointment_id = ${apptId} and kind = 'reminder' and idempotency_key like '%:v2'`;
      const before = mail.emails.length;
      await fetch(`${BASE}/api/cron/notifications`, { method: "POST", headers: { Authorization: `Bearer ${e.CRON_SECRET}` } });
      assert.equal(mail.emails.length, before);
    });

    await step("14", "Un paciente no puede consultar ni modificar datos de otros pacientes", async () => {
      // Token inexistente
      const p = await mobile.newPage();
      await p.goto(`${BASE}/turno/${"x".repeat(43)}`);
      await p.getByRole("heading", { name: "Enlace no válido" }).waitFor();
      const r = await fetch(`${BASE}/api/public/manage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "y".repeat(43), action: "cancel" }) });
      assert.equal(r.status, 404);
      // La disponibilidad pública no expone nombres
      const txt = await fetch(`${BASE}/api/public/availability?specialty=dermatologia&day=${day}`).then((x) => x.text());
      assert.ok(!/Concurrente|Carla|example\.test/.test(txt));
      // Solicitudes de otro sitio se rechazan
      const x = await fetch(`${BASE}/api/public/manage`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://sitio-malicioso.example" }, body: "{}" });
      assert.equal(x.status, 403);
      await p.close();
    });

    await step("16", "Los correos fallidos quedan registrados y se reintentan sin duplicar", async () => {
      mail.failNext = 2;
      await admin.goto(`${BASE}/admin/turnos/nuevo`);
      await admin.selectOption("#specialtyId", { label: "Dermatología (20 min)" });
      await admin.fill("#day", day);
      await admin.getByText("16:00", { exact: true }).click();
      await admin.fill("#fullName", "Roberto Telefónico");
      await admin.fill("#email", "roberto@example.test");
      await admin.getByRole("button", { name: "Crear turno" }).click();
      await admin.waitForURL(/\/admin\/turnos\/[0-9a-f-]+\?creado=1/);
      const id = admin.url().match(/turnos\/([0-9a-f-]+)/)![1];
      const job = await until(async () => {
        const [j] = await sql`select id, status, attempts, last_error from notification_jobs where appointment_id = ${id} and kind = 'confirmation'`;
        return j && j.attempts >= 1 && j.status === "pending" ? j : null;
      }, 10_000, "el primer intento fallido");
      assert.match(job.last_error, /500/);
      await sql`update notification_jobs set run_at = now() where id = ${job.id}`;
      await fetch(`${BASE}/api/cron/notifications`, { method: "POST", headers: { Authorization: `Bearer ${e.CRON_SECRET}` } }); // falla de nuevo
      await sql`update notification_jobs set run_at = now() where id = ${job.id}`;
      await fetch(`${BASE}/api/cron/notifications`, { method: "POST", headers: { Authorization: `Bearer ${e.CRON_SECRET}` } }); // se envía
      await fetch(`${BASE}/api/cron/notifications`, { method: "POST", headers: { Authorization: `Bearer ${e.CRON_SECRET}` } });
      const logs = await sql`select outcome from notification_logs where job_id = ${job.id} order by id`;
      assert.deepEqual(logs.map((l) => l.outcome), ["failed", "failed", "sent"]);
      assert.equal(mail.to("roberto@example.test").filter((m) => m.subject === "Confirmación de turno médico").length, 1);
      await admin.goto(`${BASE}/admin/correos`);
      await admin.getByRole("heading", { name: "Registro de envíos" }).waitFor();
      await shot(admin, "11-panel-correos");
    });

    await step("15", "Los datos persisten después de recargar la página y reiniciar la aplicación", async () => {
      const [{ n: before }] = await sql`select count(*)::int as n from appointments`;
      await stopServer();
      serverLog = await startServer(e);
      const fresh = postgres(dbUrl, { max: 1 });
      const [{ n: after }] = await fresh`select count(*)::int as n from appointments`;
      await fresh.end();
      assert.equal(after, before);
      await admin.goto(`${BASE}/admin/agenda?vista=dia&fecha=${day}`);
      await admin.getByText("Roberto Telefónico").waitFor();
      await admin.reload();
      await admin.getByText("Roberto Telefónico").waitFor();
      await shot(admin, "12-panel-agenda-dia");
      await admin.goto(`${BASE}/admin/agenda?vista=semana&fecha=${day}`);
      await admin.getByText("Roberto Telefónico").waitFor();
      await admin.goto(`${BASE}/admin/agenda?vista=mes&fecha=${day}`);
      await shot(admin, "13-panel-agenda-mes");
    });

    await step("17", "El sistema funciona correctamente en dispositivos móviles", async () => {
      const m = await mobile.newPage();
      for (const path of ["/", "/reservar", "/reservar/dermatologia", "/privacidad", manageUrl.replace(BASE, "")]) {
        await m.goto(`${BASE}${path}`);
        await m.waitForLoadState("networkidle");
        await noHorizontalScroll(m, path);
      }
      // Panel en el celular
      const madm = await browser!.newContext({ ...MOBILE, locale: "es-AR", timezoneId: TZ });
      const mp = await madm.newPage();
      await mp.goto(`${BASE}/admin/login`);
      await mp.fill("#email", ADMIN.email);
      await mp.fill("#password", ADMIN.password);
      await mp.click("button[type=submit]");
      await mp.waitForURL(`${BASE}/admin`);
      for (const path of ["/admin", "/admin/agenda", `/admin/agenda?vista=semana&fecha=${day}`, "/admin/horarios", "/admin/bloqueos", "/admin/configuracion", "/admin/turnos/nuevo"]) {
        await mp.goto(`${BASE}${path}`);
        await noHorizontalScroll(mp, path);
      }
      await mp.goto(`${BASE}/admin`);
      await shot(mp, "14-movil-panel");
      // Accesibilidad básica: todos los campos visibles tienen etiqueta
      await m.goto(`${BASE}/reservar/medicina-clinica`);
      const unlabeled = await m.evaluate(() =>
        [...document.querySelectorAll("input:not([type=hidden]), select, textarea")]
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .filter((el) => !(el.id && document.querySelector(`label[for="${el.id}"]`)) && !el.closest("label") && !el.getAttribute("aria-label")).length,
      );
      assert.equal(unlabeled, 0);
      await madm.close();
    });

    await step("18", "Los horarios respetan la zona horaria de Argentina (navegador en otra zona)", async () => {
      // Un paciente con el teléfono en hora de Madrid ve los horarios del consultorio en hora argentina
      const far = await browser!.newContext({ ...MOBILE, locale: "es-ES", timezoneId: "Europe/Madrid" });
      const p = await far.newPage();
      await p.goto(`${BASE}/reservar/dermatologia`);
      const dayLabel = day.split("-").reverse().join("/");
      if (!(await p.getByRole("button", { name: new RegExp(dayLabel) }).isVisible())) await p.getByRole("button", { name: "Mes siguiente" }).click();
      await p.getByRole("button", { name: new RegExp(`${dayLabel}, \\d+ horarios libres`) }).click();
      await p.getByRole("button", { name: "14:00", exact: true }).waitFor();
      assert.equal(await p.getByRole("button", { name: "18:00", exact: true }).count(), 0);
      await far.close();
      const r = await fetch(`${BASE}/api/public/availability?specialty=dermatologia&day=${day}`).then((x) => x.json());
      assert.equal(r.slots[0].startsAt, new Date(`${day}T14:00:00-03:00`).toISOString());
    });

    await step("extra", "Cierre de sesión", async () => {
      await admin.goto(`${BASE}/admin`);
      await admin.getByRole("button", { name: "Salir" }).click();
      await admin.waitForURL(/\/admin\/login/);
      await admin.goto(`${BASE}/admin`);
      assert.match(admin.url(), /\/admin\/login$/);
    });
  } finally {
    await browser?.close();
    const log = serverLog();
    await stopServer();
    await mail.stop();
    await fixedAuth.stop();
    await sql.end();
    writeFileSync(join(SHOTS, "server.log"), log);
  }

  const failed = results.filter((r) => !r.ok);
  writeFileSync(join(SHOTS, "results.json"), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} escenarios aprobados.`);
  if (failed.length) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await stopServer();
  process.exit(1);
});
