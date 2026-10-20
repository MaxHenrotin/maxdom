-- Rows keep their date until the next TVmaze fetch fills in the full UTC timestamp.
ALTER TABLE episodes RENAME COLUMN airdate TO airstamp;
