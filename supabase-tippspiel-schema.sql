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

drop table if exists public.tippspiel_predictions cascade;
drop table if exists public.tippspiel_players cascade;

create table public.tippspiel_players (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  display_name_key text not null unique,
  pin_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tippspiel_predictions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.tippspiel_matches(id) on delete cascade,
  player_id uuid not null references public.tippspiel_players(id) on delete cascade,
  player_name text not null,
  player_key text not null,
  predicted_home_score integer not null check (predicted_home_score between 0 and 20),
  predicted_away_score integer not null check (predicted_away_score between 0 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, player_id)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_tippspiel_player_fields()
returns trigger
language plpgsql
as $$
begin
  new.display_name = trim(regexp_replace(coalesce(new.display_name, ''), '\s+', ' ', 'g'));
  new.display_name_key = public.normalize_tippspiel_name(new.display_name);

  if length(new.display_name) < 2 then
    raise exception 'Name zu kurz.';
  end if;

  return new;
end;
$$;

create or replace function public.submit_tippspiel_prediction(
  p_match_id uuid,
  p_player_name text,
  p_pin text,
  p_predicted_home_score integer,
  p_predicted_away_score integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  player_record public.tippspiel_players;
  match_record public.tippspiel_matches;
  normalized_name text;
begin
  normalized_name := public.normalize_tippspiel_name(p_player_name);

  if normalized_name = '' then
    raise exception 'Name fehlt.';
  end if;

  if coalesce(length(trim(p_pin)), 0) < 4 then
    raise exception 'PIN ungueltig.';
  end if;

  select *
    into player_record
    from public.tippspiel_players
   where display_name_key = normalized_name
     and is_active = true;

  if not found then
    raise exception 'Name nicht gefunden.';
  end if;

  if crypt(p_pin, player_record.pin_hash) <> player_record.pin_hash then
    raise exception 'PIN falsch.';
  end if;

  select *
    into match_record
    from public.tippspiel_matches
   where id = p_match_id;

  if not found then
    raise exception 'Spiel nicht gefunden.';
  end if;

  if match_record.starts_at <= now() then
    raise exception 'Spiel bereits geschlossen.';
  end if;

  insert into public.tippspiel_predictions (
    match_id,
    player_id,
    player_name,
    player_key,
    predicted_home_score,
    predicted_away_score
  )
  values (
    match_record.id,
    player_record.id,
    player_record.display_name,
    player_record.display_name_key,
    greatest(0, least(20, p_predicted_home_score)),
    greatest(0, least(20, p_predicted_away_score))
  )
  on conflict (match_id, player_id)
  do update set
    player_name = excluded.player_name,
    player_key = excluded.player_key,
    predicted_home_score = excluded.predicted_home_score,
    predicted_away_score = excluded.predicted_away_score,
    updated_at = now();

  return jsonb_build_object(
    'player_name', player_record.display_name,
    'match_id', match_record.id,
    'predicted_home_score', greatest(0, least(20, p_predicted_home_score)),
    'predicted_away_score', greatest(0, least(20, p_predicted_away_score))
  );
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

drop trigger if exists set_tippspiel_players_fields on public.tippspiel_players;
create trigger set_tippspiel_players_fields
before insert or update on public.tippspiel_players
for each row execute function public.set_tippspiel_player_fields();

drop trigger if exists set_tippspiel_predictions_updated_at on public.tippspiel_predictions;
create trigger set_tippspiel_predictions_updated_at
before update on public.tippspiel_predictions
for each row execute function public.set_updated_at();

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

drop policy if exists "Tippspiel players are readable" on public.tippspiel_players;

drop policy if exists "Tippspiel predictions are readable" on public.tippspiel_predictions;
create policy "Tippspiel predictions are readable"
on public.tippspiel_predictions
for select
to anon, authenticated
using (true);

drop policy if exists "Tippspiel predictions are insertable by owner" on public.tippspiel_predictions;
drop policy if exists "Tippspiel predictions are updatable by owner" on public.tippspiel_predictions;
drop policy if exists "Tippspiel predictions are deletable by owner" on public.tippspiel_predictions;

revoke all on public.tippspiel_players from anon, authenticated;
revoke all on public.tippspiel_predictions from anon, authenticated;
grant execute on function public.submit_tippspiel_prediction(uuid, text, text, integer, integer) to anon, authenticated;

-- Beispiel fuer Spieler:
-- insert into public.tippspiel_players (display_name, pin_hash)
-- values ('Max Muster', crypt('1234', gen_salt('bf')));
--
-- PIN aendern:
-- update public.tippspiel_players
-- set pin_hash = crypt('4321', gen_salt('bf'))
-- where display_name = 'Max Muster';
