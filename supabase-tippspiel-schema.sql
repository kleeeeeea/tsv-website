create extension if not exists pgcrypto;

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

create table if not exists public.tippspiel_predictions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.tippspiel_matches(id) on delete cascade,
  player_name text not null,
  player_key text not null,
  predicted_home_score integer not null check (predicted_home_score between 0 and 20),
  predicted_away_score integer not null check (predicted_away_score between 0 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, player_key)
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

drop trigger if exists set_tippspiel_matches_updated_at on public.tippspiel_matches;
create trigger set_tippspiel_matches_updated_at
before update on public.tippspiel_matches
for each row execute function public.set_updated_at();

drop trigger if exists set_tippspiel_predictions_updated_at on public.tippspiel_predictions;
create trigger set_tippspiel_predictions_updated_at
before update on public.tippspiel_predictions
for each row execute function public.set_updated_at();

alter table public.tippspiel_matches enable row level security;
alter table public.tippspiel_predictions enable row level security;

drop policy if exists "Tippspiel matches are readable" on public.tippspiel_matches;
create policy "Tippspiel matches are readable"
on public.tippspiel_matches
for select
to anon, authenticated
using (true);

drop policy if exists "Tippspiel matches are writable" on public.tippspiel_matches;
create policy "Tippspiel matches are writable"
on public.tippspiel_matches
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Tippspiel predictions are readable" on public.tippspiel_predictions;
create policy "Tippspiel predictions are readable"
on public.tippspiel_predictions
for select
to anon, authenticated
using (true);

drop policy if exists "Tippspiel predictions are writable" on public.tippspiel_predictions;
create policy "Tippspiel predictions are writable"
on public.tippspiel_predictions
for all
to anon, authenticated
using (true)
with check (true);
