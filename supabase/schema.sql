-- База знаний MusicDream: таблицы, роли и права.
-- Запуск: Supabase → SQL Editor → вставить весь файл → Run. Повторный запуск безопасен.
--
-- Роли: admin — всё, включая пользователей и их пароли;
--       editor — всё, кроме аккаунтов: статьи, разделы, заглавная;
--       none — аккаунт создан, но доступа нет (ждёт роли от админа);
--       blocked — отключён.
-- Самый первый зарегистрированный аккаунт автоматически становится admin.

-- ---------- таблицы ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  login      text unique,
  name       text,
  role       text not null default 'none' check (role in ('admin', 'editor', 'none', 'blocked')),
  created_at timestamptz not null default now()
);

create table if not exists public.sections (
  id       bigint generated always as identity primary key,
  name     text not null unique,
  position int  not null default 0
);

create table if not exists public.articles (
  id         bigint generated always as identity primary key,
  title      text not null unique,
  section_id bigint references public.sections on delete set null,
  position   int,
  hidden     boolean not null default false,
  body       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null
);

create table if not exists public.home (
  id    int primary key default 1 check (id = 1),
  title text not null default '',
  body  text not null default ''
);

-- ---------- служебные функции ----------
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'none');
$$;

-- Есть ли уже админ (нужно странице входа, чтобы показать «создать аккаунт админа»).
create or replace function public.has_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where role = 'admin');
$$;
grant execute on function public.has_admin() to anon, authenticated;
grant execute on function public.my_role() to authenticated;

-- Новый аккаунт → профиль. Первый — admin, остальные без доступа до решения админа.
create or replace function public.on_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, login, name, role)
  values (
    new.id,
    new.raw_user_meta_data ->> 'login',
    new.raw_user_meta_data ->> 'name',
    case when exists (select 1 from public.profiles where role = 'admin') then 'none' else 'admin' end
  );
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.on_new_user();

-- Кто и когда последним правил статью — ставит база, не страница.
create or replace function public.touch_article() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists articles_touch on public.articles;
create trigger articles_touch before insert or update on public.articles
  for each row execute function public.touch_article();

-- ---------- права (RLS) ----------
alter table public.profiles enable row level security;
alter table public.sections enable row level security;
alter table public.articles enable row level security;
alter table public.home     enable row level security;

drop policy if exists profiles_read  on public.profiles;
drop policy if exists profiles_admin on public.profiles;
create policy profiles_read  on public.profiles for select to authenticated
  using (id = auth.uid() or public.my_role() in ('admin', 'editor'));
create policy profiles_admin on public.profiles for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- Разделы и заглавная читаются всеми (из них потом соберётся сама вики), правит команда.
drop policy if exists sections_read  on public.sections;
drop policy if exists sections_admin on public.sections;
drop policy if exists sections_team  on public.sections;
create policy sections_read  on public.sections for select using (true);
create policy sections_team  on public.sections for all to authenticated
  using (public.my_role() in ('admin', 'editor')) with check (public.my_role() in ('admin', 'editor'));

drop policy if exists home_read  on public.home;
drop policy if exists home_admin on public.home;
drop policy if exists home_team  on public.home;
create policy home_read  on public.home for select using (true);
create policy home_team  on public.home for all to authenticated
  using (public.my_role() in ('admin', 'editor')) with check (public.my_role() in ('admin', 'editor'));

-- Статьи: открытые видят все, скрытые — только команда. Пишет и удаляет команда (editor и admin).
drop policy if exists articles_read   on public.articles;
drop policy if exists articles_insert on public.articles;
drop policy if exists articles_update on public.articles;
drop policy if exists articles_delete on public.articles;
create policy articles_read   on public.articles for select
  using (not hidden or public.my_role() in ('admin', 'editor'));
create policy articles_insert on public.articles for insert to authenticated
  with check (public.my_role() in ('admin', 'editor'));
create policy articles_update on public.articles for update to authenticated
  using (public.my_role() in ('admin', 'editor')) with check (public.my_role() in ('admin', 'editor'));
create policy articles_delete on public.articles for delete to authenticated
  using (public.my_role() in ('admin', 'editor'));

-- ---------- стартовые данные ----------
insert into public.home (id, title, body) values (1,
  'Добро пожаловать в базу знаний Dance MMO «MusicDream»',
  '**База знаний** — место, где собрана информация об игре MusicDream: предметы, события, режимы танцев и ответы на частые вопросы.')
on conflict (id) do nothing;

insert into public.sections (name, position) values
  ('Общая информация', 1), ('Техническая часть', 2), ('Персонаж', 3), ('Игровой процесс', 4),
  ('Развлечения', 5), ('События', 6), ('Предметы', 7), ('Игровые покупки', 8),
  ('Танцы', 9), ('Чат', 10), ('Прочее', 11)
on conflict (name) do nothing;
