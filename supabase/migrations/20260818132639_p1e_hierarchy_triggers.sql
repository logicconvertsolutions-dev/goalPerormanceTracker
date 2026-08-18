-- An upline must live in the same organization. Hard fence, checked on write.
create or replace function public.enforce_same_org()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.upline_id is not null
     and (select a.org_id from public.agents a where a.id = new.upline_id) <> new.org_id
  then raise exception 'upline_id crosses organization boundary';
  end if;
  return new;
end $$;

create trigger agents_same_org
  before insert or update of upline_id, org_id on public.agents
  for each row execute function public.enforce_same_org();

-- Closure maintenance. Self-row at depth 0 means is_upline_of() covers self.
create or replace function public.closure_on_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.agent_closure (ancestor_id, descendant_id, depth)
  values (new.id, new.id, 0);

  if new.upline_id is not null then
    insert into public.agent_closure (ancestor_id, descendant_id, depth)
    select c.ancestor_id, new.id, c.depth + 1
    from public.agent_closure c
    where c.descendant_id = new.upline_id
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger agents_closure_insert
  after insert on public.agents
  for each row execute function public.closure_on_insert();

-- Moving an agent rebuilds the whole subtree's edges above it.
create or replace function public.closure_on_move()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.upline_id is not distinct from old.upline_id then
    return new;
  end if;

  -- Cycle guard: the new upline must not already be inside our own subtree.
  if new.upline_id is not null and exists (
    select 1 from public.agent_closure
    where ancestor_id = new.id and descendant_id = new.upline_id
  ) then
    raise exception 'cycle: % is already a descendant of %', new.upline_id, new.id;
  end if;

  -- Drop every edge from outside the subtree into the subtree.
  delete from public.agent_closure c
  using public.agent_closure sub
  where sub.ancestor_id = new.id
    and c.descendant_id = sub.descendant_id
    and c.ancestor_id not in (
      select descendant_id from public.agent_closure where ancestor_id = new.id
    );

  -- Rebuild them from the new upline's ancestor chain.
  if new.upline_id is not null then
    insert into public.agent_closure (ancestor_id, descendant_id, depth)
    select up.ancestor_id, sub.descendant_id, up.depth + sub.depth + 1
    from public.agent_closure up
    cross join public.agent_closure sub
    where up.descendant_id = new.upline_id
      and sub.ancestor_id  = new.id
    on conflict (ancestor_id, descendant_id) do update
      set depth = excluded.depth;
  end if;
  return new;
end $$;

create trigger agents_closure_move
  after update of upline_id on public.agents
  for each row execute function public.closure_on_move();

-- org_id on child rows is derived from the owning agent, never client input.
create or replace function public.set_org_from_agent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.org_id := (select a.org_id from public.agents a where a.id = new.agent_id);
  if new.org_id is null then
    raise exception 'agent % has no organization', new.agent_id;
  end if;
  return new;
end $$;

create trigger contacts_org        before insert or update of agent_id on public.contacts
  for each row execute function public.set_org_from_agent();
create trigger call_logs_org       before insert or update of agent_id on public.call_logs
  for each row execute function public.set_org_from_agent();
create trigger appointments_org    before insert or update of agent_id on public.appointments
  for each row execute function public.set_org_from_agent();
create trigger sales_org           before insert or update of agent_id on public.sales
  for each row execute function public.set_org_from_agent();
create trigger recruiting_org      before insert or update of agent_id on public.recruiting_logs
  for each row execute function public.set_org_from_agent();
