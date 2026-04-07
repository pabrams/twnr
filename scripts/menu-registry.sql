SELECT json_agg(menu_row ORDER BY menu_row.id) FROM (
  SELECT
    m.id,
    m.name,
    m.label,
    pm.name as parent_menu,
    COALESCE(
      (SELECT json_agg(cmd ORDER BY cmd.sort_order)
       FROM (
         SELECT
           c.name as command,
           mc.key_pattern as key_pattern,
           COALESCE(mc.label, c.label) as label,
           mc.client_msg_type as client_msg_type,
           tm.name as target_menu,
           mc.sort_order
         FROM menu_command mc
         JOIN command c ON mc.command_id = c.id
         LEFT JOIN menu tm ON mc.target_menu_id = tm.id
         WHERE mc.menu_id = m.id
       ) cmd
      ), '[]'::json
    ) as commands
  FROM menu m
  LEFT JOIN menu pm ON m.parent_menu_id = pm.id
) menu_row;
