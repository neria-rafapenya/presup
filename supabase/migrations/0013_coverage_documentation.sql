-- Documentación interna sobre la cobertura geográfica configurable por tenant.
do $$
declare
  existing_id uuid;
begin
  select id into existing_id
  from public.horekia_knowledge_entries
  where tenant_id = '00000000-0000-0000-0000-000000000001'
    and title = 'Cobertura geográfica del tenant'
    and status = 'active'
  order by created_at desc
  limit 1;

  if existing_id is not null then
    update public.horekia_knowledge_entries
    set content = 'La cobertura geográfica se configura en Empresa. Ciudad de referencia es el punto de partida y Radio de acción (km) define la distancia máxima que el tenant quiere atender. Las instalaciones existentes parten de 100 km. El chat pregunta primero dónde debe prestarse el servicio y compara esa ubicación con la ciudad de referencia mediante un cálculo determinista. Si está fuera del radio, la solicitud se cierra y se informa al cliente. Gemini solo normaliza una ciudad o código postal no reconocido localmente; no calcula coordenadas, distancias ni decide la viabilidad.',
        metadata = '{"scope":"backoffice","topic":"coverage","managed_by":"horekia"}'::jsonb,
        source_type = 'manual',
        source_name = 'Documentación Horekia',
        updated_at = now()
    where id = existing_id;
  else
    insert into public.horekia_knowledge_entries
      (tenant_id, kind, title, content, metadata, source_type, source_name)
    values
      ('00000000-0000-0000-0000-000000000001', 'document', 'Cobertura geográfica del tenant',
       'La cobertura geográfica se configura en Empresa. Ciudad de referencia es el punto de partida y Radio de acción (km) define la distancia máxima que el tenant quiere atender. Las instalaciones existentes parten de 100 km. El chat pregunta primero dónde debe prestarse el servicio y compara esa ubicación con la ciudad de referencia mediante un cálculo determinista. Si está fuera del radio, la solicitud se cierra y se informa al cliente. Gemini solo normaliza una ciudad o código postal no reconocido localmente; no calcula coordenadas, distancias ni decide la viabilidad.',
       '{"scope":"backoffice","topic":"coverage","managed_by":"horekia"}'::jsonb,
       'manual', 'Documentación Horekia');
  end if;
end;
$$;
