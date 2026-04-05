create extension if not exists pgcrypto;
create extension if not exists unaccent;

create or replace function public.normalize_tippspiel_name(raw_value text)
returns text
language sql
immutable
as $$
  select lower(trim(regexp_replace(unaccent(coalesce(raw_value, '')), '\s+', ' ', 'g')));
$$;

create table if not exists public.tippspiel_matches (
  id uuid primary key default gen_random_uuid(),
  match_uid text not null unique,
  season text not null,
  starts_at timestamptz not null,
  competition text,
  league text,
  is_home boolean not null default true,
  opponent text not null,
  location text,
  home_team text not null,
  away_team text not null,
  home_score integer check (home_score between 0 and 30),
  away_score integer check (away_score between 0 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tippspiel_players (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  display_name_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tippspiel_players
  add column if not exists display_name_key text;

create unique index if not exists tippspiel_players_display_name_key_idx
  on public.tippspiel_players (display_name_key);

create table if not exists public.tippspiel_predictions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.tippspiel_matches(id) on delete cascade,
  user_id uuid,
  player_name text not null,
  player_key text not null,
  predicted_home_score integer not null check (predicted_home_score between 0 and 20),
  predicted_away_score integer not null check (predicted_away_score between 0 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, player_key)
);

alter table public.tippspiel_predictions
  add column if not exists user_id uuid;

create unique index if not exists tippspiel_predictions_match_user_idx
  on public.tippspiel_predictions (match_id, user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_tippspiel_player_identity()
returns trigger
language plpgsql
as $$
begin
  new.user_id = auth.uid();
  new.display_name = trim(regexp_replace(coalesce(new.display_name, ''), '\s+', ' ', 'g'));
  new.display_name_key = public.normalize_tippspiel_name(new.display_name);

  if length(new.display_name) < 2 then
    raise exception 'Anzeigename zu kurz.';
  end if;

  return new;
end;
$$;

create or replace function public.set_tippspiel_prediction_identity()
returns trigger
language plpgsql
as $$
declare
  player_profile public.tippspiel_players;
begin
  if auth.uid() is null then
    raise exception 'Authentifizierung erforderlich.';
  end if;

  select *
    into player_profile
    from public.tippspiel_players
   where user_id = auth.uid();

  if not found then
    raise exception 'Tippspiel-Profil fehlt.';
  end if;

  new.user_id = auth.uid();
  new.player_name = player_profile.display_name;
  new.player_key = player_profile.display_name_key;
  return new;
end;
$$;

drop trigger if exists set_tippspiel_matches_updated_at on public.tippspiel_matches;
create trigger set_tippspiel_matches_updated_at
before update on public.tippspiel_matches
for each row execute function public.set_updated_at();

drop trigger if exists set_tippspiel_players_updated_at on public.tippspiel_players;
create trigger set_tippspiel_players_updated_at
before update on public.tippspiel_players
for each row execute function public.set_updated_at();

drop trigger if exists set_tippspiel_players_identity on public.tippspiel_players;
create trigger set_tippspiel_players_identity
before insert or update on public.tippspiel_players
for each row execute function public.set_tippspiel_player_identity();

drop trigger if exists set_tippspiel_predictions_updated_at on public.tippspiel_predictions;
create trigger set_tippspiel_predictions_updated_at
before update on public.tippspiel_predictions
for each row execute function public.set_updated_at();

drop trigger if exists set_tippspiel_predictions_identity on public.tippspiel_predictions;
create trigger set_tippspiel_predictions_identity
before insert or update on public.tippspiel_predictions
for each row execute function public.set_tippspiel_prediction_identity();

alter table public.tippspiel_matches enable row level security;
alter table public.tippspiel_players enable row level security;
alter table public.tippspiel_predictions enable row level security;

drop policy if exists "Tippspiel matches are readable" on public.tippspiel_matches;
create policy "Tippspiel matches are readable"
on public.tippspiel_matches
for select
to anon, authenticated
using (true);

drop policy if exists "Tippspiel matches are writable" on public.tippspiel_matches;

drop policy if exists "Tippspiel players are readable by owner" on public.tippspiel_players;
create policy "Tippspiel players are readable by owner"
on public.tippspiel_players
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Tippspiel players are insertable by owner" on public.tippspiel_players;
create policy "Tippspiel players are insertable by owner"
on public.tippspiel_players
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Tippspiel players are updatable by owner" on public.tippspiel_players;
create policy "Tippspiel players are updatable by owner"
on public.tippspiel_players
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Tippspiel predictions are readable" on public.tippspiel_predictions;
create policy "Tippspiel predictions are readable"
on public.tippspiel_predictions
for select
to anon, authenticated
using (true);

drop policy if exists "Tippspiel predictions are writable" on public.tippspiel_predictions;

drop policy if exists "Tippspiel predictions are insertable by owner" on public.tippspiel_predictions;
create policy "Tippspiel predictions are insertable by owner"
on public.tippspiel_predictions
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Tippspiel predictions are updatable by owner" on public.tippspiel_predictions;
create policy "Tippspiel predictions are updatable by owner"
on public.tippspiel_predictions
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Tippspiel predictions are deletable by owner" on public.tippspiel_predictions;
create policy "Tippspiel predictions are deletable by owner"
on public.tippspiel_predictions
for delete
to authenticated
using (auth.uid() = user_id);
