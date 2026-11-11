-- Prueba con identidades de aplicación Horekia; no usa Supabase Auth.
-- Ejecutar contra una base de pruebas con psql como rol de inicialización.
\set user_one '10000000-0000-0000-0000-000000000001'
\set user_two '10000000-0000-0000-0000-000000000002'

begin;

insert into public.horekia_tenant_users (tenant_id, user_id, role)
values
  ('00000000-0000-0000-0000-000000000001', :'user_one'::uuid, 'owner'),
  ('00000000-0000-0000-0000-000000000002', :'user_two'::uuid, 'owner')
on conflict (tenant_id, user_id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', :'user_one', true);

do $$
begin
  if (select count(*) from public.horekia_job_types
      where tenant_id = '00000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'user_one no ve su tenant';
  end if;
  if (select count(*) from public.horekia_job_types
      where tenant_id = '00000000-0000-0000-0000-000000000002') <> 0 then
    raise exception 'user_one ve el tenant ajeno';
  end if;
end;
$$;

-- Debe fallar por RLS: user_one no puede insertar en el tenant 2.
insert into public.horekia_job_types (tenant_id, slug, name)
values ('00000000-0000-0000-0000-000000000002', 'cross-tenant', 'No permitido');

rollback;
