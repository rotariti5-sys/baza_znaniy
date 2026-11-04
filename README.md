# База знаний MusicDream

Админка для наполнения базы знаний Dance MMO «MusicDream». Сайта здесь пока нет:
только редактор и данные, из которых базу потом соберём.

## Как открыть админку

https://rotariti5-sys.github.io/baza_znaniy/admin/

Вход — кнопка «Войти с помощью токена доступа». Токен создаётся один раз:
GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens →
Generate new token, репозиторий `baza_znaniy`, права **Contents: Read and write**.

Каждое «Сохранить» в админке — коммит в этот репозиторий.

## Где лежат данные

| Файл | Что это |
|---|---|
| `content/sections.yml` | разделы заглавной страницы, в нужном порядке |
| `content/home.md` | заголовок и вступление заглавной |
| `content/pages/*.md` | статьи: `title`, `section`, `order`, `hidden` + текст в Markdown |

Ссылка на другую статью в тексте: `[[Название]]` или `[[Название|текст ссылки]]`.

`admin/` — сама админка (Sveltia CMS, настройки полей в `admin/config.yml`).
