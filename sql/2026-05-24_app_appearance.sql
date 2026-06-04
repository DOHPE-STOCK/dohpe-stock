alter table public.app_settings
add column if not exists ui_theme text not null default 'dark';

alter table public.app_settings
drop constraint if exists app_settings_ui_theme_check;

alter table public.app_settings
add constraint app_settings_ui_theme_check
check (ui_theme in ('light', 'dark'));

update public.app_settings
set ui_theme = coalesce(nullif(ui_theme, ''), 'dark')
where id = 'default';
