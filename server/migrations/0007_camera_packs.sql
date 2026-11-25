CREATE TABLE camera_checkin_packs (
  fridge_id TEXT NOT NULL REFERENCES fridges(id) ON DELETE CASCADE,
  photo_path TEXT NOT NULL,
  unit_count INTEGER NOT NULL CHECK (unit_count BETWEEN 2 AND 48),
  PRIMARY KEY (fridge_id, photo_path)
);
ALTER TABLE inventory_operations ADD COLUMN pack_photo_path TEXT;
CREATE UNIQUE INDEX inventory_operations_unique_pack
ON inventory_operations(fridge_id, pack_photo_path) WHERE pack_photo_path IS NOT NULL;
