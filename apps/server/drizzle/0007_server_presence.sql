alter table servers add column allow_invisible boolean not null default false;
alter table servers add column managers_see_invisible boolean not null default false;

alter table server_members add column presence_mode text not null default 'visible';
alter table server_members add constraint server_members_presence_mode check (presence_mode in ('visible', 'invisible'));
