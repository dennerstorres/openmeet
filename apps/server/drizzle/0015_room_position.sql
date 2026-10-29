-- Rooms keep the order the server managers choose. Existing rooms keep their creation order.
alter table rooms add column position integer not null default 0;

update rooms r
set position = ordered.n
from (select id, row_number() over (partition by server_id order by created_at, id) - 1 as n from rooms) ordered
where ordered.id = r.id;
