-- Create a private bucket for weighment evidence photos.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('weighment-photos', 'weighment-photos', false, 524288, array['image/jpeg'])
on conflict (id) do nothing;

create policy p_photo_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'weighment-photos');

create policy p_photo_read on storage.objects for select to authenticated
  using (bucket_id = 'weighment-photos' and is_supervisor_up());

-- No update policy and no delete policy means nobody, including the owner, can alter
-- or remove a photo through the API. The retention purge runs with the service key
-- from a GitHub Action.
-- file_size_limit of 512 KB is a hard backstop against an uncompressed upload
-- slipping through and eating the storage tier.
-- Path convention: weighment-photos/{yyyy}/{mm}/{client_uuid}.jpg
