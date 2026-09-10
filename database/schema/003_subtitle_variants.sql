-- Additive metadata only: existing READY assets and their object keys are unchanged.
alter table public.subtitle_tracks
  add column kind text not null default 'original',
  add column has_speaker_names boolean not null default false,
  add column has_context_hints boolean not null default false,
  add constraint subtitle_tracks_kind_valid check (kind in ('original', 'literal', 'natural'));
