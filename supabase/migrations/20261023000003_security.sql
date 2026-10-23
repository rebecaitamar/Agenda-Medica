-- =====================================================================
-- Seguridad: Row Level Security y permisos
--
-- Modelo: el navegador NUNCA accede a la base de datos directamente. Todas las
-- lecturas y escrituras pasan por el servidor de Next.js, que se conecta con
-- DATABASE_URL, valida los datos y verifica la sesión de la médica.
--
-- Por eso:
--  * RLS está activado en todas las tablas y no existe ninguna política para
--    los roles anon y authenticated: la API de datos de Supabase (PostgREST)
--    no devuelve ni modifica nada aunque alguien use la clave pública.
--  * Además se revocan todos los privilegios de esos roles (defensa en
--    profundidad).
-- =====================================================================

alter table public.profiles                enable row level security;
alter table public.clinic_settings         enable row level security;
alter table public.admin_users             enable row level security;
alter table public.specialties             enable row level security;
alter table public.availability_rules      enable row level security;
alter table public.availability_exceptions enable row level security;
alter table public.patients                enable row level security;
alter table public.appointments            enable row level security;
alter table public.notification_jobs       enable row level security;
alter table public.notification_logs       enable row level security;
alter table public.email_templates         enable row level security;
alter table public.audit_logs              enable row level security;
alter table public.rate_limits             enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Objetos que se creen más adelante por el mismo propietario tampoco quedan expuestos.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
