-- P8a: recruiting pipeline status vocabulary + a more realistic logo size cap.

-- Recruiting statuses renamed to match how leaders actually describe the
-- pipeline stage-by-stage, plus a new 'certified' stage between recruited
-- and licensed. Renaming (rather than add+backfill+drop) keeps every
-- existing recruiting_logs row pointed at the same stage with zero data
-- migration. Final order: contacted, marketing_presented, recruited,
-- certified, licensed, declined.
alter type public.recruit_status rename value 'interviewed' to 'marketing_presented';
alter type public.recruit_status rename value 'joined' to 'recruited';
alter type public.recruit_status add value if not exists 'certified' after 'recruited';

-- 2MB was tight for a logo straight off a phone camera. 5MB matches the
-- client-side check in uploadOrgLogoAction.
update storage.buckets set file_size_limit = 5242880 where id = 'org-logos';
