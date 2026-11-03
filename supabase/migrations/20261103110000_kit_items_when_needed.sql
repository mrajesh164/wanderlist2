-- When a thing is needed, not just that you own it.
--
-- Assignment 4 feedback asked for weather conditions and scenarios per item,
-- and for separating what you always need from what you sometimes need. The
-- point isn't labelling: it is that the generator can then put the right things
-- on the right trips without being told twice.
--
-- The vocabulary is closed on purpose, and every tag is something the app can
-- actually decide about a trip: cold / hot / wet come from the climate normals
-- the list is already built from, and weekend / long come from the dates. A
-- free-text tag would let someone write "beach" and then wonder why it never
-- fired, because nothing can evaluate it.
--
-- Defaults are both "no opinion": not always-needed, no conditions. An item you
-- listed but never qualified keeps behaving exactly as it did before.
alter table public.kit_items
  add column always_needed boolean not null default false,
  add column when_tags     text[]  not null default '{}',
  add constraint kit_items_when_tags_known
    check (when_tags <@ array['cold','hot','wet','weekend','long']::text[]);
