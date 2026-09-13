-- Devices advertise their exact HTTPS endpoint so peers can reach them through
-- either the shared relay (/h/<hostId>) or a custom public endpoint.
alter table public.devices drop column relay_origin;
alter table public.devices add column public_endpoint text;
