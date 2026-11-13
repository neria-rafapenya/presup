-- Deja una única pregunta de medidas personalizadas justo después del formato.
do $$
declare
  p_service_id uuid := 'fc2216b4-2d3f-4470-97f8-c68e72332462';
  p_tenant_id uuid := '00000000-0000-0000-0000-000000000001';
  active_id uuid;
  active_version integer;
  active_fields jsonb;
  format_field jsonb;
  custom_dimensions_field jsonb;
  remaining_fields jsonb;
  next_fields jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('horekia-blueprint:' || p_tenant_id || ':' || p_service_id, 0));

  select id, version, fields
    into active_id, active_version, active_fields
  from public.horekia_intake_schemas
  where public.horekia_intake_schemas.tenant_id = p_tenant_id
    and public.horekia_intake_schemas.job_type_id = p_service_id
    and status = 'active'
  order by version desc
  limit 1;

  if active_id is null then
    return;
  end if;

  select element.value
    into format_field
  from jsonb_array_elements(active_fields) with ordinality as element(value, ordinality)
  where element.value->>'key' = 'format_type'
  limit 1;

  select element.value || '{"required":true,"visible_when":{"field":"format_type","equals":"Personalizado"}}'::jsonb
    into custom_dimensions_field
  from jsonb_array_elements(active_fields) with ordinality as element(value, ordinality)
  where element.value->>'key' = 'que_ancho_y_alto_tendra_el_formato_personalizado'
  limit 1;

  if format_field is null or custom_dimensions_field is null then
    return;
  end if;

  select coalesce(jsonb_agg(element.value order by element.ordinality), '[]'::jsonb)
    into remaining_fields
  from jsonb_array_elements(active_fields) with ordinality as element(value, ordinality)
  where element.value->>'key' not in ('custom_dimensions', 'que_ancho_y_alto_tendra_el_formato_personalizado');

  select coalesce(jsonb_agg(ordered_fields.value order by ordered_fields.ordinality), '[]'::jsonb)
    into next_fields
  from (
    select value, ordinality
    from jsonb_array_elements(remaining_fields) with ordinality
    where value->>'key' <> 'format_type'
    union all
    select format_field, 1
    union all
    select custom_dimensions_field, 2
  ) ordered_fields;

  update public.horekia_intake_schemas
  set status = 'archived'
  where public.horekia_intake_schemas.tenant_id = p_tenant_id and id = active_id;

  insert into public.horekia_intake_schemas (tenant_id, job_type_id, version, fields)
  values (p_tenant_id, p_service_id, active_version + 1, next_fields);
end;
$$;
