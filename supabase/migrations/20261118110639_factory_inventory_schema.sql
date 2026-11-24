/*
# Factory Inventory Management Schema

Single-tenant, no-auth in-house factory inventory app. All data is shared internally.
No user_id columns, no auth.uid() checks. Policies use TO anon, authenticated with USING(true).

## New Tables

1. `categories` - classification of items (fasteners, assembly components, panels/boxes, etc.)
   - id (uuid pk), name (text unique), created_at

2. `items` - the catalog of stock-kept materials
   - id (uuid pk)
   - name (text, not null)
   - part_number (text) - optional internal/SKU code
   - unit (text, not null) - e.g. pcs, kg, m, box
   - category_id (uuid fk -> categories)
   - reorder_level (integer, default 0) - when stock falls at/below this, item is low-stock
   - notes (text)
   - created_at, updated_at

3. `vendors` - suppliers
   - id (uuid pk)
   - name (text, not null)
   - contact_person (text)
   - phone (text)
   - email (text)
   - address (text)
   - gst_number (text)
   - notes (text)
   - created_at, updated_at

4. `vendor_items` - many-to-many link of which materials a vendor supplies
   - id (uuid pk)
   - vendor_id (uuid fk -> vendors, cascade)
   - item_id (uuid fk -> items, cascade)
   - last_rate (numeric(12,2)) - last known purchase rate per unit
   - unique (vendor_id, item_id)

5. `stock_movements` - ledger of every material entry (in) and issue (out)
   - id (uuid pk)
   - item_id (uuid fk -> items, cascade)
   - type (text check in 'in','out') - in = receipt from vendor, out = issue to staff
   - quantity (integer, not null) - always positive; sign derived from type
   - vendor_id (uuid fk -> vendors, null) - set for 'in' movements
   - bill_number (text) - vendor bill reference, optional
   - bill_id (uuid fk -> bills, null) - link to uploaded bill
   - issued_to (text) - staff name/department for 'out' movements
   - rate (numeric(12,2)) - unit rate for 'in' movements
   - notes (text)
   - movement_date (date, not null, default today)
   - created_at

6. `bills` - uploaded vendor bill files + extracted data
   - id (uuid pk)
   - vendor_id (uuid fk -> vendors, null)
   - file_name (text)
   - storage_path (text) - path in supabase storage
   - bill_number (text)
   - bill_date (date)
   - amount (numeric(12,2))
   - status (text default 'pending') - pending | processed | error
   - extracted_text (text) - raw OCR/extracted content
   - created_at

7. `payments` - payment reminders owed to vendors
   - id (uuid pk)
   - vendor_id (uuid fk -> vendors, cascade)
   - bill_number (text)
   - amount (numeric(12,2), not null)
   - due_date (date, not null)
   - paid (boolean default false)
   - paid_date (date)
   - notes (text)
   - created_at

## Security
- RLS enabled on all tables.
- Grants of full CRUD to anon + authenticated (intentionally shared in-house data).
- Storage bucket 'bills' created and made public for upload (in-house, no auth).
*/

-- ---------- categories ----------
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON categories TO anon, authenticated;
DROP POLICY IF EXISTS "anon_crud_categories" ON categories;
CREATE POLICY "anon_crud_categories" ON categories FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_ins_categories" ON categories FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_upd_categories" ON categories FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_del_categories" ON categories FOR DELETE TO anon, authenticated USING (true);

-- ---------- vendors ----------
CREATE TABLE IF NOT EXISTS vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  address text,
  gst_number text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON vendors TO anon, authenticated;
DROP POLICY IF EXISTS "anon_sel_vendors" ON vendors;
CREATE POLICY "anon_sel_vendors" ON vendors FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_ins_vendors" ON vendors FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_upd_vendors" ON vendors FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_del_vendors" ON vendors FOR DELETE TO anon, authenticated USING (true);

-- ---------- items ----------
CREATE TABLE IF NOT EXISTS items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  part_number text,
  unit text NOT NULL DEFAULT 'pcs',
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  reorder_level integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON items TO anon, authenticated;
DROP POLICY IF EXISTS "anon_sel_items" ON items;
CREATE POLICY "anon_sel_items" ON items FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_ins_items" ON items FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_upd_items" ON items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_del_items" ON items FOR DELETE TO anon, authenticated USING (true);

-- ---------- vendor_items ----------
CREATE TABLE IF NOT EXISTS vendor_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  last_rate numeric(12,2),
  created_at timestamptz DEFAULT now(),
  UNIQUE (vendor_id, item_id)
);
ALTER TABLE vendor_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_items TO anon, authenticated;
DROP POLICY IF EXISTS "anon_sel_vendor_items" ON vendor_items;
CREATE POLICY "anon_sel_vendor_items" ON vendor_items FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_ins_vendor_items" ON vendor_items FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_upd_vendor_items" ON vendor_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_del_vendor_items" ON vendor_items FOR DELETE TO anon, authenticated USING (true);

-- ---------- bills ----------
CREATE TABLE IF NOT EXISTS bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  bill_number text,
  bill_date date,
  amount numeric(12,2),
  status text NOT NULL DEFAULT 'pending',
  extracted_text text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON bills TO anon, authenticated;
DROP POLICY IF EXISTS "anon_sel_bills" ON bills;
CREATE POLICY "anon_sel_bills" ON bills FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_ins_bills" ON bills FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_upd_bills" ON bills FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_del_bills" ON bills FOR DELETE TO anon, authenticated USING (true);

-- ---------- stock_movements ----------
CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('in','out')),
  quantity integer NOT NULL CHECK (quantity > 0),
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  bill_number text,
  bill_id uuid REFERENCES bills(id) ON DELETE SET NULL,
  issued_to text,
  rate numeric(12,2),
  notes text,
  movement_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_movements TO anon, authenticated;
DROP POLICY IF EXISTS "anon_sel_movements" ON stock_movements;
CREATE POLICY "anon_sel_movements" ON stock_movements FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_ins_movements" ON stock_movements FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_upd_movements" ON stock_movements FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_del_movements" ON stock_movements FOR DELETE TO anon, authenticated USING (true);

-- ---------- payments ----------
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  bill_number text,
  amount numeric(12,2) NOT NULL,
  due_date date NOT NULL,
  paid boolean NOT NULL DEFAULT false,
  paid_date date,
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON payments TO anon, authenticated;
DROP POLICY IF EXISTS "anon_sel_payments" ON payments;
CREATE POLICY "anon_sel_payments" ON payments FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_ins_payments" ON payments FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_upd_payments" ON payments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_del_payments" ON payments FOR DELETE TO anon, authenticated USING (true);

-- ---------- indexes ----------
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
CREATE INDEX IF NOT EXISTS idx_movements_item ON stock_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_movements_type_date ON stock_movements(type, movement_date);
CREATE INDEX IF NOT EXISTS idx_vendor_items_vendor ON vendor_items(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_items_item ON vendor_items(item_id);
CREATE INDEX IF NOT EXISTS idx_payments_vendor ON payments(vendor_id);
CREATE INDEX IF NOT EXISTS idx_payments_due_paid ON payments(due_date, paid);
CREATE INDEX IF NOT EXISTS idx_bills_vendor ON bills(vendor_id);

-- ---------- live stock view ----------
CREATE OR REPLACE VIEW live_stock AS
SELECT
  i.id,
  i.name,
  i.part_number,
  i.unit,
  i.category_id,
  i.reorder_level,
  i.notes,
  i.created_at,
  i.updated_at,
  COALESCE(SUM(CASE WHEN m.type = 'in' THEN m.quantity ELSE -m.quantity END), 0) AS stock,
  CASE
    WHEN COALESCE(SUM(CASE WHEN m.type = 'in' THEN m.quantity ELSE -m.quantity END), 0) <= i.reorder_level
    THEN true ELSE false
  END AS is_low_stock
FROM items i
LEFT JOIN stock_movements m ON m.item_id = i.id
GROUP BY i.id, i.name, i.part_number, i.unit, i.category_id, i.reorder_level, i.notes, i.created_at, i.updated_at;
GRANT SELECT ON live_stock TO anon, authenticated;

-- ---------- seed categories ----------
INSERT INTO categories (name)
SELECT 'Fasteners' WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Fasteners');
INSERT INTO categories (name)
SELECT 'Assembly Components' WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Assembly Components');
INSERT INTO categories (name)
SELECT 'Panels / Boxes' WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Panels / Boxes');
INSERT INTO categories (name)
SELECT 'Consumables' WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Consumables');
INSERT INTO categories (name)
SELECT 'Tools' WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Tools');
