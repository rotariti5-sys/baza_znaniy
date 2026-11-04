-- Редакторы получают всё, кроме аккаунтов: статьи (включая удаление), разделы, заглавную.
-- Пользователи и пароли остаются только у админа. Повторный запуск безопасен.

drop policy if exists sections_admin on public.sections;
drop policy if exists sections_team  on public.sections;
create policy sections_team on public.sections for all to authenticated
  using (public.my_role() in ('admin', 'editor')) with check (public.my_role() in ('admin', 'editor'));

drop policy if exists home_admin on public.home;
drop policy if exists home_team  on public.home;
create policy home_team on public.home for all to authenticated
  using (public.my_role() in ('admin', 'editor')) with check (public.my_role() in ('admin', 'editor'));

drop policy if exists articles_delete on public.articles;
create policy articles_delete on public.articles for delete to authenticated
  using (public.my_role() in ('admin', 'editor'));
