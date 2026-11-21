-- Onboarding: owner self-signup, one-time invite links (supervisor / worker) and per-business
-- onboarding state. Run in the Supabase SQL editor after the earlier migrations.
--
-- `businesses` and `members` have no INSERT grants, so every write that creates a membership goes through
-- the SECURITY DEFINER functions below. They only ever act for the calling user (auth.uid()), never for a
-- user id passed in by the client. No service-role key is needed.

-- ----------------------------------------------------------------- columns

alter table public.businesses add column if not exists business_type text not null default '';
alter table public.businesses add column if not exists city text not null default '';
alter table public.businesses add column if not exists team_size text not null default '';
-- { step, completed_at, ... } Empty until a business goes through the wizard; completed_at set when done.
alter table public.businesses add column if not exists onboarding jsonb not null default '{}'::jsonb;

-- Every business that exists today skips the wizard.
update public.businesses
   set onboarding = jsonb_build_object('completed_at', now())
 where onboarding = '{}'::jsonb;

-- Shown to the owner when assigning workers to supervisors (auth.users is not readable by the app).
alter table public.members add column if not exists display_name text not null default '';
update public.members m
   set display_name = coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), u.email, '')
  from auth.users u
 where u.id = m.user_id and m.display_name = '';

-- The app (dal.ts) reads one membership per user.
create unique index if not exists members_one_business_per_user on public.members (user_id);

-- ------------------------------------------------------------------ invites

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  role text not null check (role in ('supervisor', 'worker')),
  -- Worker invites are bound to one worker record in the app data (e.g. 'w1').
  worker_ref text,
  invitee_name text not null default '',
  -- SHA-256 of the token; the raw token exists only in the link that was handed out.
  token_hash text not null unique,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  constraint invites_worker_ref_matches_role check ((role = 'worker') = (worker_ref is not null))
);
create index if not exists invites_business_idx on public.invites (business_id, created_at desc);
create index if not exists invites_created_by_idx on public.invites (created_by);
create index if not exists invites_used_by_idx on public.invites (used_by);

alter table public.invites enable row level security;

drop policy if exists "owners read their invites" on public.invites;
create policy "owners read their invites" on public.invites
  for select to authenticated
  using ((select private.has_role(business_id, array['owner'])));

revoke all on public.invites from anon, authenticated;
grant select on public.invites to authenticated;

-- ---------------------------------------------------------------- functions

-- Creates a business with the caller as its owner.
create or replace function public.create_business(
  p_name text,
  p_type text default '',
  p_city text default '',
  p_team_size text default '',
  p_period_days int default 14
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  nm text := btrim(coalesce(p_name, ''));
  dn text;
  biz uuid;
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if char_length(nm) < 2 or char_length(nm) > 80 then raise exception 'invalid_name' using errcode = '22023'; end if;
  if p_period_days is null or p_period_days not between 1 and 31 then raise exception 'invalid_period' using errcode = '22023'; end if;
  if exists (select 1 from public.members where user_id = uid) then raise exception 'already_member' using errcode = '23505'; end if;

  select coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), u.email, '') into dn
    from auth.users u where u.id = uid;

  insert into public.businesses (name, currency, period_anchor, period_length_days, business_type, city, team_size, onboarding)
  values (nm, 'INR', current_date, p_period_days,
          left(btrim(coalesce(p_type, '')), 40), left(btrim(coalesce(p_city, '')), 60), left(btrim(coalesce(p_team_size, '')), 20),
          jsonb_build_object('step', 'pay'))
  returning id into biz;

  insert into public.incentive_rules (business_id) values (biz);
  insert into public.members (business_id, user_id, role, display_name) values (biz, uid, 'owner', coalesce(dn, ''));
  return biz;
end;
$$;

-- Creates a one-time invite and returns the raw token (the only time it is ever visible).
-- Owners may invite supervisors and workers; supervisors may invite workers.
-- Whether a supervisor's worker is on their team is checked by the app, which owns that data.
create or replace function public.create_invite(
  p_role text,
  p_worker_ref text default null,
  p_name text default ''
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  m record;
  token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  select business_id, role into m from public.members where user_id = uid;
  if m is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if p_role not in ('supervisor', 'worker') then raise exception 'invalid_role' using errcode = '22023'; end if;
  if p_role = 'supervisor' and m.role <> 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role = 'worker' and m.role not in ('owner', 'supervisor') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role = 'worker' then
    if p_worker_ref is null or btrim(p_worker_ref) = '' then raise exception 'worker_required' using errcode = '22023'; end if;
    if exists (select 1 from public.members where business_id = m.business_id and worker_ref = p_worker_ref) then
      raise exception 'already_linked' using errcode = '23505';
    end if;
    -- Only the newest link for a worker stays valid.
    update public.invites set revoked_at = now()
     where business_id = m.business_id and worker_ref = p_worker_ref and used_at is null and revoked_at is null;
  end if;

  insert into public.invites (business_id, role, worker_ref, invitee_name, token_hash)
  values (m.business_id, p_role, case when p_role = 'worker' then btrim(p_worker_ref) end,
          left(btrim(coalesce(p_name, '')), 80),
          encode(sha256(convert_to(token, 'UTF8')), 'hex'));
  return token;
end;
$$;

-- What the join page shows before the invitee has an account. Callable signed out; it reveals only the
-- business name, role and the name the inviter typed, and only for a token that is still valid.
create or replace function public.preview_invite(p_token text)
returns table (business_name text, role text, invitee_name text, inviter_name text)
language sql stable security definer set search_path = ''
as $$
  select b.name, i.role, i.invitee_name,
         coalesce((select m.display_name from public.members m where m.user_id = i.created_by), '')
    from public.invites i
    join public.businesses b on b.id = i.business_id
   where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
     and i.used_at is null and i.revoked_at is null and i.expires_at > now()
   limit 1;
$$;

-- Consumes an invite for the calling user: makes them a member with the role the invite fixed.
create or replace function public.accept_invite(p_token text)
returns table (business_id uuid, role text, worker_ref text)
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  inv record;
  dn text;
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;

  select * into inv from public.invites i
   where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
     and i.used_at is null and i.revoked_at is null and i.expires_at > now()
   for update;
  if inv is null then raise exception 'invalid_invite' using errcode = '22023'; end if;

  if exists (select 1 from public.members where user_id = uid) then raise exception 'already_member' using errcode = '23505'; end if;
  if inv.role = 'worker' and exists (
    select 1 from public.members m where m.business_id = inv.business_id and m.worker_ref = inv.worker_ref
  ) then raise exception 'already_linked' using errcode = '23505'; end if;

  select coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), u.email, '') into dn
    from auth.users u where u.id = uid;

  insert into public.members (business_id, user_id, role, worker_ref, display_name)
  values (inv.business_id, uid, inv.role, inv.worker_ref, coalesce(dn, ''));

  update public.invites set used_at = now(), used_by = uid where id = inv.id;
  return query select inv.business_id, inv.role, inv.worker_ref;
end;
$$;

-- Owner-only: withdraws an unused invite.
create or replace function public.revoke_invite(p_invite_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  update public.invites i set revoked_at = now()
   where i.id = p_invite_id and i.used_at is null and i.revoked_at is null
     and (select private.has_role(i.business_id, array['owner']));
end;
$$;

-- -------------------------------------------------------------------- grants
-- Functions are executable by PUBLIC by default; lock each one to the roles that need it.

revoke all on function public.create_business(text, text, text, text, int) from public, anon;
revoke all on function public.create_invite(text, text, text) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
revoke all on function public.revoke_invite(uuid) from public, anon;
revoke all on function public.preview_invite(text) from public;

grant execute on function public.create_business(text, text, text, text, int) to authenticated;
grant execute on function public.create_invite(text, text, text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
grant execute on function public.preview_invite(text) to anon, authenticated;
