# Pruebas ejecutadas

Fecha: 23/10/2026. Entorno: PostgreSQL 16 local con las migraciones reales, Node 22, Next.js 16.4.3 compilado en modo producción, Chromium sin interfaz.

- `npm test`: **34/34** pruebas de integración aprobadas.
- `npm run test:e2e`: **19/19** escenarios de punta a punta aprobados (celular 390×844 y escritorio 1280×900).
- `npx tsc --noEmit` y `npx eslint`: sin errores.

## Qué es real y qué es un doble de prueba

Reales: base de datos, migraciones, RLS, motor de disponibilidad, restricciones, transacciones, servidor Next.js compilado, páginas, Server Actions, API, cola de notificaciones, tarea programada (llamada HTTP al endpoint con `CRON_SECRET`), plantillas de correo.

Dobles de prueba (solo en `tests/`): un servidor que imita la API de **Resend** (para leer los correos y simular caídas) y otro que imita la API de **Supabase Auth** (iniciar sesión, usuario, cierre de sesión). En las pruebas, el paso del tiempo hasta las 48 h previas se simula adelantando `run_at` en la base.

**Falta verificar con los servicios reales** (requiere credenciales): entrega efectiva en Resend con dominio verificado, inicio de sesión y recuperación de contraseña con Supabase Auth, y ejecución de `pg_cron` en Supabase. La guía de puesta en marcha incluye la prueba final para cada uno.

## Escenarios obligatorios

| # | Escenario | Resultado | Cómo se verificó |
|---|---|---|---|
| 1 | La médica inicia sesión y configura los horarios de ambas especialidades | ✅ | E2E: login, Configuración y Horarios completados desde la interfaz; reglas verificadas en la base. Integración: duraciones y descansos distintos por especialidad |
| 2 | Un paciente consulta la disponibilidad real | ✅ | E2E en celular: inicio con "próximo turno disponible" real; la API devuelve solo `startsAt`/`endsAt` |
| 3 | El paciente reserva un turno correctamente | ✅ | E2E en celular: calendario → horario → datos → código recibido por correo → "Turno confirmado" |
| 4 | El turno queda guardado en la base de datos | ✅ | Estado `confirmed`, paciente y hora exactos en la base |
| 5 | Se envía el correo de confirmación | ✅ | Asunto "Confirmación de turno médico" con profesional, especialidad, fecha, hora, dirección, indicaciones, contacto y enlace de gestión |
| 6 | Se programa el recordatorio 48 h antes | ✅ | `run_at = inicio − 48 h` exacto |
| 7 | El recordatorio se envía por la tarea del servidor | ✅ | No se envía antes de tiempo; al vencer, `POST /api/cron/notifications` lo envía una sola vez aunque se ejecute varias veces |
| 8 | No se envían recordatorios de turnos cancelados | ✅ | El recordatorio queda `cancelled`; aunque se lo fuerce a pendiente, el procesador verifica el turno y no envía |
| 9 | Una reprogramación actualiza el recordatorio | ✅ | E2E desde el panel: recordatorio anterior cancelado, nuevo `reminder:<id>:v2` con el nuevo horario, aviso al paciente con fecha anterior y nueva |
| 10 | Dos pacientes reservan el mismo horario a la vez: solo uno lo obtiene | ✅ | 5 solicitudes HTTP simultáneas → una 202, cuatro 409. Integración: también con especialidades superpuestas y con inserción directa en la base (restricción de exclusión) |
| 11 | La médica bloquea un horario y deja de estar disponible | ✅ | E2E: bloqueo desde la interfaz; la API deja de ofrecer 11:00 y 11:30 y sigue ofreciendo 12:00 |
| 12 | Los horarios cancelados se liberan | ✅ | E2E: el paciente cancela desde su enlace en el celular y el horario vuelve a ofrecerse. Integración: cancelación desde el panel |
| 13 | Un usuario no autorizado no puede acceder al panel | ✅ | Sin sesión, todas las rutas del panel redirigen al login; un usuario válido de Auth sin permiso es rechazado; contraseña incorrecta; tarea programada sin secreto → 401 |
| 14 | Un paciente no puede ver ni modificar datos de otros | ✅ | Tokens inventados o alterados no dan acceso; solicitudes de otros sitios → 403; la disponibilidad no expone nombres; con roles `anon`/`authenticated` todas las tablas y funciones dan "permiso denegado" |
| 15 | Los datos persisten tras recargar y reiniciar | ✅ | E2E: se detiene y vuelve a iniciar el servidor; turnos y agenda intactos |
| 16 | Los correos fallidos se registran y reintentan sin duplicar | ✅ | Caída simulada del proveedor: intentos registrados `failed, failed, sent`, espera creciente, un único correo; reintento manual después de falta de configuración; tres procesadores en paralelo no duplican |
| 17 | Funciona en celulares | ✅ | Sin desplazamiento horizontal en páginas públicas y del panel a 390 px; todos los campos con etiqueta |
| 18 | Los horarios respetan la zona horaria de Argentina | ✅ | Navegador en hora de Madrid ve los horarios del consultorio en hora argentina; 09:00 local = 12:00 UTC; franja de 21:00 que cruza la medianoche UTC; feriados de día completo desde las 00:00 locales |

## Otras pruebas de integración

- Validación del formulario en el servidor (correo, nombre, aceptación de privacidad, teléfono obligatorio configurable, horario inexistente).
- Límite de 5 intentos de código; retención vencida libera el horario; reenvío de código limitado a 3.
- Turno reservado con menos de 48 h: el recordatorio se registra como omitido y no se envía.
- Recordatorio atrasado más de 6 h (servidor caído): se omite en lugar de enviarse tarde.
- Cambiar la anticipación del recordatorio recalcula los pendientes.
- Bloqueo sobre turnos existentes: se informan para que la médica decida.
- Turno manual sin correo: los avisos quedan registrados como omitidos con el motivo.
- Sobreturno fuera de agenda permitido, pero nunca superpuesto.
- Plazo y habilitación de cancelación online del paciente.
- Si el código de verificación no se puede enviar, se libera el horario y se informa al paciente.
