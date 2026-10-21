-- A volume's summary, kept once read from monde-aquilon.com: NULL until then, '' when the
-- site has none.
ALTER TABLE books ADD COLUMN summary TEXT;
