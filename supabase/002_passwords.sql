-- Пароли редакторов для админа. Выполнить после schema.sql: SQL Editor → вставить → Run.
-- Повторный запуск безопасен.
--
-- Сами пароли Supabase хранит только хэшем — прочитать их нельзя. Поэтому админу виден
-- пароль, который ВЫДАЛ админ (при создании или смене). Когда человек меняет пароль сам,
-- запись стирается, и админ видит «сменён пользователем».

create table if not exists public.issued_passwords (
  user_id  uuid primary key references public.profiles on delete cascade,
  password text not null,
  set_at   timestamptz not null default now()
);
alter table public.issued_passwords enable row level security;

drop policy if exists issued_admin on public.issued_passwords;
create policy issued_admin on public.issued_passwords for select to authenticated
  using (public.my_role() = 'admin');

-- Админ задаёт пароль любому аккаунту. Старые входы этого аккаунта сбрасываются.
create or replace function public.admin_set_password(target uuid, new_password text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if public.my_role() <> 'admin' then
    raise exception 'permission denied: only admin';
  end if;
  if length(new_password) < 8 then
    raise exception 'Password should be at least 8 characters';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = target;
  if not found then
    raise exception 'user not found';
  end if;
  if target <> auth.uid() then
    delete from auth.sessions where user_id = target;
  end if;
  insert into public.issued_passwords (user_id, password, set_at)
  values (target, new_password, now())
  on conflict (user_id) do update set password = excluded.password, set_at = excluded.set_at;
end $$;
revoke all on function public.admin_set_password(uuid, text) from public, anon;
grant execute on function public.admin_set_password(uuid, text) to authenticated;

-- Человек сменил пароль сам → выданный админом пароль больше не действует, стираем его.
-- (admin_set_password сначала меняет пароль, потом записывает — запись не теряется.)
create or replace function public.on_password_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    delete from public.issued_passwords where user_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_password_changed on auth.users;
create trigger on_auth_password_changed after update of encrypted_password on auth.users
  for each row execute function public.on_password_changed();
