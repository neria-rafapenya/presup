-- Icono ilustrativo opcional para cada servicio público.
alter table public.horekia_job_types
  add column if not exists image_url text;
