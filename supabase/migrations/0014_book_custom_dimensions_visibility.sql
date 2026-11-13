-- Hace condicional la pregunta de medidas personalizadas del servicio de libros.
do $$
declare
  p_service_id uuid := 'fc2216b4-2d3f-4470-97f8-c68e72332462';
  p_tenant_id uuid := '00000000-0000-0000-0000-000000000001';
  active_id uuid;
  active_version integer;
  active_fields jsonb;
  next_fields jsonb;
begin
  select id, version, fields
    into active_id, active_version, active_fields
  from public.horekia_intake_schemas
  where public.horekia_intake_schemas.tenant_id = p_tenant_id
    and public.horekia_intake_schemas.job_type_id = p_service_id
    and status = 'active'
  order by version desc
  limit 1;

  if active_id is not null and active_fields @> '[{"key":"que_ancho_y_alto_tendra_el_formato_personalizado"}]'::jsonb then
    perform pg_advisory_xact_lock(hashtextextended('horekia-blueprint:' || p_tenant_id || ':' || p_service_id, 0));
    select jsonb_agg(
      case
        when element.value->>'key' = 'que_ancho_y_alto_tendra_el_formato_personalizado'
          then element.value || '{"required":true,"visible_when":{"field":"format_type","equals":"Personalizado"}}'::jsonb
        else element.value
      end
      order by element.ordinality
    )
      into next_fields
    from jsonb_array_elements(active_fields) with ordinality as element(value, ordinality);

    update public.horekia_intake_schemas
    set status = 'archived'
    where public.horekia_intake_schemas.tenant_id = p_tenant_id and id = active_id;

    insert into public.horekia_intake_schemas (tenant_id, job_type_id, version, fields)
    values (p_tenant_id, p_service_id, active_version + 1, next_fields);
  end if;
end;
$$;
