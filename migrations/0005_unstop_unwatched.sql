-- A show with nothing watched is "À voir", so it can't be stopped. The TV Time import left
-- the flag on a few of them, which would move them to "Arrêtées" at their first episode.
UPDATE user_shows SET stopped = 0
WHERE stopped = 1 AND NOT EXISTS (
  SELECT 1 FROM watched w JOIN episodes e ON e.id = w.episode_id
  WHERE w.user_id = user_shows.user_id AND e.show_id = user_shows.show_id
);
