-- Which model generates an asset, and which one actually did.
--
-- Two workspace-level defaults plus a record of what produced each creative. Deliberately plain
-- `text` with NO check constraint: the set of available models is a product decision that changes
-- whenever a provider ships or retires one, and a CHECK would turn every catalog edit into a
-- migration — and worse, would make a row unreadable the day a model is dropped. Validation lives
-- in lib/generationModels.ts's resolveModel(), which SKIPS an unrecognised id and falls back to
-- the default rather than failing. Same call already made for blog_settings.index_layout, which is
-- clamped on read instead of constrained on write.
--
-- NULL means "no explicit choice" and resolves to DEFAULT_MODEL_BY_KIND — byte-identical to the
-- hardcoded behaviour before models were selectable, so every existing workspace is unaffected.

alter table public.workspaces
  add column if not exists default_image_model text,
  add column if not exists default_video_model text;

comment on column public.workspaces.default_image_model is
  'lib/generationModels.ts model id. NULL = use DEFAULT_MODEL_BY_KIND. Unvalidated by design; resolveModel() falls back on an unknown id.';
comment on column public.workspaces.default_video_model is
  'lib/generationModels.ts model id. NULL = use DEFAULT_MODEL_BY_KIND. Unvalidated by design; resolveModel() falls back on an unknown id.';

-- Which model actually produced this asset. Not the same as the workspace default or even the
-- requested model: an account-level failure (quota, billing, auth) falls the job over to another
-- provider mid-flight, and without this the operator cannot tell why one clip looks different from
-- the next, or that they are being billed to a second account.
alter table public.campaign_creatives
  add column if not exists model text;

comment on column public.campaign_creatives.model is
  'Model id that produced this asset — the one that SUCCEEDED, which may differ from the one requested if fallback ran.';
