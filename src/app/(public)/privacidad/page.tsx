import type { Metadata } from "next";
import { doctorDisplayName, fullAddress, getSiteConfig } from "@/lib/settings";

export const metadata: Metadata = { title: "Política de privacidad" };

export default async function PrivacyPage() {
  const { settings, profile } = await getSiteConfig();
  const controller = settings.privacyControllerName ?? doctorDisplayName(profile) ?? settings.appName;
  const contact =
    settings.privacyControllerContact ??
    ([settings.contactEmail, settings.contactPhone, fullAddress(settings)].filter(Boolean).join(", ") || null);

  return (
    <article className="mx-auto max-w-[68ch] px-4 py-10 leading-relaxed sm:px-6 [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:font-serif [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
      <h1 className="font-serif text-3xl font-semibold">Política de privacidad</h1>
      <p className="text-ink-soft">
        Cómo tratamos tus datos personales cuando solicitás un turno en {settings.appName}, de acuerdo con la Ley 25.326 de Protección de los
        Datos Personales de la República Argentina.
      </p>

      <h2>Responsable de los datos</h2>
      <p>
        {controller}
        {contact ? `. Contacto: ${contact}.` : "."}
      </p>

      <h2>Qué datos pedimos</h2>
      <ul>
        <li>Nombre y apellido.</li>
        <li>Correo electrónico.</li>
        <li>Teléfono{settings.phoneRequired ? "" : ", si decidís indicarlo"}.</li>
        <li>La especialidad, la fecha y la hora del turno.</li>
      </ul>
      <p>
        No pedimos DNI, motivo de consulta ni información sobre tu salud para reservar un turno. Este sitio no guarda historias clínicas,
        diagnósticos, recetas ni fotografías.
      </p>

      <h2>Para qué los usamos</h2>
      <ul>
        <li>Registrar y administrar tu turno.</li>
        <li>Enviarte la confirmación, el recordatorio y los avisos de cambios o cancelaciones.</li>
        <li>Comunicarnos con vos si hay que modificar la agenda.</li>
      </ul>
      <p>No usamos tus datos con fines publicitarios ni los cedemos a terceros.</p>

      <h2>Con quién se comparten</h2>
      <p>
        Para funcionar, el sitio utiliza proveedores que procesan los datos por cuenta del consultorio: el servicio de base de datos y
        alojamiento, y el servicio de envío de correos electrónicos. Solo reciben la información necesaria para prestar ese servicio.
      </p>

      <h2>Cuánto tiempo los conservamos</h2>
      <p>Conservamos los datos de los turnos mientras sean necesarios para la atención y la administración del consultorio. Podés pedir su eliminación en cualquier momento.</p>

      <h2>Seguridad</h2>
      <p>
        La conexión es cifrada (HTTPS), el acceso a la agenda está restringido a la profesional mediante usuario y contraseña, y el enlace
        para gestionar tu turno es único y no contiene tus datos.
      </p>

      <h2>Tus derechos</h2>
      <p>
        Podés pedir acceso a tus datos, su rectificación, actualización o supresión escribiendo al contacto indicado arriba. El acceso es
        gratuito a intervalos no inferiores a seis meses, salvo que acredites un interés legítimo (art. 14, Ley 25.326), y la
        rectificación o supresión se realiza dentro de los cinco días hábiles de recibido el pedido (art. 16).
      </p>
      <p>
        La Agencia de Acceso a la Información Pública, en su carácter de órgano de control de la Ley 25.326, tiene la atribución de
        atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas
        vigentes en materia de protección de datos personales.
      </p>
    </article>
  );
}
