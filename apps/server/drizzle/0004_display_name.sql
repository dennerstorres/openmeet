-- S-21: display, room and server names refuse control and bidi characters.
-- Ranges in chr() hold the same in Postgres and PGlite; [[:cntrl:]] follows LC_CTYPE and does not.
-- chr(0) is left out: text already refuses the null byte. A row that breaks the rule fails the migration.

create function openmeet_without_controls(value text) returns text
language sql immutable parallel safe
as $$
  select translate(
    value,
    (
      select string_agg(chr(code), '' order by code)
      from generate_series(1, 159) as code
      where code <= 31 or code >= 127
    ),
    ''
  )
$$;

-- U+2028, U+2029, U+061C, U+200E, U+200F, U+202A-U+202E, U+2066-U+2069.
create function openmeet_is_label(value text) returns boolean
language sql immutable parallel safe
as $$
  select char_length(value) between 1 and 80
    and value = btrim(value)
    and value = openmeet_without_controls(value)
    and value = translate(
      value,
      chr(8232) || chr(8233) || chr(1564) || chr(8206) || chr(8207)
        || chr(8234) || chr(8235) || chr(8236) || chr(8237) || chr(8238)
        || chr(8294) || chr(8295) || chr(8296) || chr(8297),
      ''
    )
$$;

alter table users drop constraint users_display_name_length;
alter table users add constraint users_display_name_safe check (openmeet_is_label(display_name));

alter table rooms drop constraint rooms_name_length;
alter table rooms add constraint rooms_name_safe check (openmeet_is_label(name));

alter table servers drop constraint servers_name_length;
alter table servers add constraint servers_name_safe check (openmeet_is_label(name));
