import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { getSiteConfig } from "@/lib/settings";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { saveSettingsAction } from "../../actions";

export const metadata: Metadata = { title: "Configuración" };

function Text({ name, label, value, hint, type = "text", max, textarea, rows = 3 }: { name: string; label: string; value: string | number | null; hint?: string; type?: string; max?: number; textarea?: boolean; rows?: number }) {
  const id = `f-${name}`;
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      {textarea ? (
        <textarea id={id} name={name} defaultValue={value ?? ""} rows={rows} maxLength={max} className="input" aria-describedby={hint ? `${id}-h` : undefined} />
      ) : (
        <input id={id} name={name} type={type} defaultValue={value ?? ""} maxLength={max} className="input" aria-describedby={hint ? `${id}-h` : undefined} />
      )}
      {hint && <p id={`${id}-h`} className="field-hint">{hint}</p>}
    </div>
  );
}

function Check({ name, label, checked, hint }: { name: string; label: string; checked: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-3 text-[15px]">
      <input type="checkbox" name={name} defaultChecked={checked} className="mt-0.5 h-4 w-4 shrink-0 accent-sage-700" />
      <span>
        {label}
        {hint && <span className="block text-sm text-ink-soft">{hint}</span>}
      </span>
    </label>
  );
}

export default async function SettingsPage() {
  await requireAdmin();
  const { settings: s, profile: p } = await getSiteConfig();

  return (
    <div className="max-w-3xl">
      <h1 className="font-serif text-3xl font-semibold">Configuración</h1>
      <p className="mt-1 text-ink-soft">Estos datos se muestran en la web y en los correos. Lo que dejes vacío no se publica.</p>

      <ActionForm action={saveSettingsAction} className="mt-6 space-y-8">
        <fieldset className="panel space-y-5 p-5 sm:p-6">
          <legend className="px-1 font-semibold">Datos profesionales</legend>
          <Text name="appName" label="Nombre del sitio" value={s.appName} max={80} hint="Aparece en el encabezado y en los correos." />
          <div className="grid gap-5 sm:grid-cols-[8rem_1fr]">
            <Text name="honorific" label="Tratamiento" value={p.honorific} max={20} hint="Ej.: Dra." />
            <Text name="fullName" label="Nombre y apellido" value={p.fullName} max={120} />
          </div>
          <Text name="licenseNumber" label="Matrícula" value={p.licenseNumber} max={60} hint="Ej.: M.P. 12345 / M.N. 67890" />
          <Text name="bio" label="Presentación breve" value={p.bio} max={1500} textarea rows={4} />
          <Text name="photoUrl" label="Fotografía (enlace https, opcional)" value={p.photoUrl} type="url" hint="Dirección pública de la imagen. Dejalo vacío para no mostrar foto." />
        </fieldset>

        <fieldset className="panel space-y-5 p-5 sm:p-6">
          <legend className="px-1 font-semibold">Consultorio y contacto</legend>
          <Text name="addressLine" label="Dirección" value={s.addressLine} max={200} hint="Calle y número." />
          <div className="grid gap-5 sm:grid-cols-2">
            <Text name="addressDetails" label="Piso, departamento, timbre" value={s.addressDetails} max={200} />
            <Text name="city" label="Localidad" value={s.city} max={120} />
          </div>
          <Text name="mapsUrl" label="Enlace al mapa (opcional)" value={s.mapsUrl} type="url" hint="Ej.: el enlace de “Compartir” de Google Maps." />
          <Text name="arrivalInstructions" label="Indicaciones para asistir" value={s.arrivalInstructions} max={1500} textarea hint="Se muestran al confirmar el turno y en el correo. Ej.: llegar 10 minutos antes, traer credencial de la obra social." />
          <div className="grid gap-5 sm:grid-cols-3">
            <Text name="contactPhone" label="Teléfono" value={s.contactPhone} type="tel" max={40} />
            <Text name="contactWhatsapp" label="WhatsApp" value={s.contactWhatsapp} type="tel" max={40} hint="Con código de país: 54 9 …" />
            <Text name="contactEmail" label="Correo de contacto" value={s.contactEmail} type="email" max={200} />
          </div>
          <Text name="publicHoursText" label="Días y horarios generales" value={s.publicHoursText} max={600} textarea rows={3} hint="Texto libre. Ej.: Lunes y miércoles de 9 a 13 h." />
          <Check name="showPublicHours" label="Publicar los días y horarios generales en la web" checked={s.showPublicHours} />
        </fieldset>

        <fieldset className="panel space-y-5 p-5 sm:p-6">
          <legend className="px-1 font-semibold">Reservas online</legend>
          <Check name="requireEmailVerification" label="Verificar el correo del paciente con un código antes de confirmar" checked={s.requireEmailVerification} hint="Recomendado: evita reservas falsas y correos mal escritos." />
          <Check name="phoneRequired" label="Pedir teléfono como dato obligatorio" checked={s.phoneRequired} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Text name="holdMinutes" label="Minutos para ingresar el código" value={s.holdMinutes} type="number" hint="El horario queda reservado mientras tanto (5 a 60)." />
            <Text name="reminderHoursBefore" label="Recordatorio (horas antes del turno)" value={s.reminderHoursBefore} type="number" hint="48 h por defecto." />
          </div>
        </fieldset>

        <fieldset className="panel space-y-5 p-5 sm:p-6">
          <legend className="px-1 font-semibold">Cancelaciones y cambios</legend>
          <Check name="allowPatientCancel" label="Permitir que el paciente cancele desde el enlace del correo" checked={s.allowPatientCancel} />
          <Check name="allowPatientReschedule" label="Permitir que el paciente cambie el día u horario desde el enlace" checked={s.allowPatientReschedule} />
          <Text name="patientChangeMinHours" label="Anticipación mínima para cambios online (horas)" value={s.patientChangeMinHours} type="number" hint="Pasado ese plazo, el paciente debe comunicarse con el consultorio." />
          <Text name="cancellationPolicyText" label="Política de cancelación (texto público)" value={s.cancellationPolicyText} max={1500} textarea />
        </fieldset>

        <fieldset className="panel space-y-5 p-5 sm:p-6">
          <legend className="px-1 font-semibold">Privacidad</legend>
          <Text name="privacyControllerName" label="Responsable de los datos" value={s.privacyControllerName} max={200} hint="Si lo dejás vacío se usa el nombre de la profesional." />
          <Text name="privacyControllerContact" label="Contacto para consultas de privacidad" value={s.privacyControllerContact} max={300} hint="Correo o dirección donde los pacientes pueden ejercer sus derechos." />
        </fieldset>

        <div className="sticky bottom-0 -mx-4 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
          <SubmitButton>Guardar configuración</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
