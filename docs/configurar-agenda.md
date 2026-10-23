# Cómo configurar la agenda (guía para la médica)

Todo se hace desde el panel: `https://TU-DOMINIO/admin`.

## 1. Configuración

- **Datos profesionales**: tratamiento (Dra.), nombre y apellido, matrícula, presentación breve y, si querés, el enlace a una foto.
- **Consultorio y contacto**: dirección, piso/timbre, localidad, enlace al mapa, indicaciones para asistir (ej.: "llegá 10 minutos antes"), teléfono, WhatsApp y correo.
- **Días y horarios generales**: un texto libre que podés publicar o no en la página de inicio.
- **Reservas online**: verificación del correo con código (recomendado), teléfono obligatorio u opcional, minutos que se retiene el horario mientras el paciente ingresa el código, y cuántas horas antes se envía el recordatorio (48 por defecto).
- **Cancelaciones y cambios**: si el paciente puede cancelar o cambiar el turno desde el enlace del correo, y hasta cuántas horas antes.
- **Privacidad**: responsable de los datos y contacto para consultas.

Lo que dejes vacío no se muestra en la web.

## 2. Horarios

Para **cada especialidad** por separado:

- **Duración** de la consulta y **descanso** entre turnos.
- **Anticipación mínima**: por ejemplo, 2 horas impide reservar para dentro de una hora.
- **Reservas hasta**: cuántos días hacia adelante se ofrece la agenda.
- **Días y franjas**: tocá "Agregar horario" en cada día. Para hacer una pausa fija (por ejemplo, almuerzo), agregá dos franjas: 09:00 a 13:00 y 14:00 a 18:00.

Si las dos especialidades atienden en el mismo horario, se ofrecen las dos y, cuando alguien reserva una, ese tiempo deja de estar disponible para la otra (nunca hay dos pacientes a la vez).

## 3. Bloqueos

Para días u horarios en los que no atendés: bloqueo de unas horas, pausa, feriado o vacaciones; para toda la agenda o solo para una especialidad. Si ya había turnos confirmados en ese período, el sistema te los lista para que los reprogrames o canceles (no los cancela solo).

## 4. Agenda del día a día

- **Inicio**: turnos de hoy, horarios libres, próximos 7 días, cancelaciones y estado de los correos.
- **Agenda**: vistas de día, semana y mes. En la vista de día, cada horario libre tiene "Agendar".
- **Nuevo turno**: para turnos pedidos por teléfono. El correo del paciente es opcional; sin correo no se envían avisos. Podés cargar un sobreturno con "Horario fuera de la agenda" (nunca superpuesto a otro turno).
- **Detalle de un turno**: reprogramar o cambiar de especialidad, cancelar (con motivo opcional para el paciente), marcar como realizada o ausente, editar datos de contacto, nota administrativa, ver los correos enviados y el historial de cambios.

> La nota administrativa es solo para datos de gestión. No registres diagnósticos ni información clínica: el sistema no está pensado como historia clínica.

## 5. Correos

En **Correos** ves cada confirmación, recordatorio y aviso con su estado (programado, enviado, falló, omitido, cancelado). Si uno falla, el sistema lo reintenta solo varias veces; si igual falla, aparece el botón **Reintentar**. Ahí también podés editar el texto de cada correo usando las variables (`{{paciente}}`, `{{fecha}}`, `{{hora}}`, etc.).
