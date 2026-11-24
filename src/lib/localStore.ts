import { Category, Item, LiveStockRow, Payment, StockMovement, Vendor, VendorItem, Bill } from './types';
import { saveFile, getFile, deleteFile, fileToDataUrl, dataUrlToBlob } from './fileStorage';

const STORAGE_KEY = 'floorstock_data_v1';

interface DBState {
  categories: Category[];
  vendors: Vendor[];
  items: Item[];
  vendor_items: VendorItem[];
  stock_movements: StockMovement[];
  payments: Payment[];
  bills: Bill[];
}

const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat-1', name: 'Fasteners', created_at: '2026-11-01T00:00:00Z' },
  { id: 'cat-2', name: 'Assembly Components', created_at: '2026-11-01T00:00:00Z' },
  { id: 'cat-3', name: 'Panels / Boxes', created_at: '2026-11-01T00:00:00Z' },
  { id: 'cat-4', name: 'Consumables', created_at: '2026-11-01T00:00:00Z' },
  { id: 'cat-5', name: 'Tools', created_at: '2026-11-01T00:00:00Z' },
];

const DEFAULT_VENDORS: Vendor[] = [
  {
    id: 'ven-1',
    name: 'Apex Fasteners & Hardware Ltd',
    contact_person: 'Rajesh Kumar',
    phone: '+91 98765 43210',
    email: 'sales@apexfasteners.com',
    address: 'Plot 42, Phase 2, Industrial Estate, Chennai',
    gst_number: '27AAACA1234A1Z5',
    notes: 'Primary hardware & fasteners supplier. Net 30 days.',
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
  },
  {
    id: 'ven-2',
    name: 'Metro Electricals & Controls',
    contact_person: 'Anita Sharma',
    phone: '+91 91234 56789',
    email: 'orders@metroelec.com',
    address: '18 Electronic City, Bangalore',
    gst_number: '29BBBCB5678B1Z2',
    notes: 'Enclosures, brackets, wiring components.',
    created_at: '2026-11-02T00:00:00Z',
    updated_at: '2026-11-02T00:00:00Z',
  },
  {
    id: 'ven-3',
    name: 'Precision Polymers & Chemicals',
    contact_person: 'Vikram Patel',
    phone: '+91 98111 22334',
    email: 'info@precisiontools.in',
    address: 'GIDC Estate, Vatva, Ahmedabad',
    gst_number: '24CCCC9876C1Z3',
    notes: 'Adhesives, compounds, cutting tools.',
    created_at: '2026-11-03T00:00:00Z',
    updated_at: '2026-11-03T00:00:00Z',
  },
];

const DEFAULT_ITEMS: Item[] = [
  {
    id: 'item-1',
    name: 'M8 Hex Bolt 50mm (SS304)',
    part_number: 'FAST-M8-50',
    unit: 'pcs',
    category_id: 'cat-1',
    reorder_level: 100,
    notes: 'High-tensile stainless steel fasteners',
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
  },
  {
    id: 'item-2',
    name: 'M6 Nyloc Nut Grade 8',
    part_number: 'FAST-M6-NY',
    unit: 'pcs',
    category_id: 'cat-1',
    reorder_level: 150,
    notes: 'Self-locking nylon insert nuts',
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
  },
  {
    id: 'item-3',
    name: 'Heavy Duty Mounting Bracket 120mm',
    part_number: 'ASY-BRKT-01',
    unit: 'pcs',
    category_id: 'cat-2',
    reorder_level: 25,
    notes: 'Galvanized steel motor mounting brackets',
    created_at: '2026-11-02T00:00:00Z',
    updated_at: '2026-11-02T00:00:00Z',
  },
  {
    id: 'item-4',
    name: 'Control Panel Enclosure IP65 (400x300x200)',
    part_number: 'PNL-ENC-65',
    unit: 'box',
    category_id: 'cat-3',
    reorder_level: 8,
    notes: 'Wall-mount dustproof & waterproof junction enclosure',
    created_at: '2026-11-02T00:00:00Z',
    updated_at: '2026-11-02T00:00:00Z',
  },
  {
    id: 'item-5',
    name: 'Industrial Threadlock Compound 50ml',
    part_number: 'CON-THRD-50',
    unit: 'bottle',
    category_id: 'cat-4',
    reorder_level: 10,
    notes: 'Medium strength anaerobic threadlocker',
    created_at: '2026-11-03T00:00:00Z',
    updated_at: '2026-11-03T00:00:00Z',
  },
];

const DEFAULT_MOVEMENTS: StockMovement[] = [
  {
    id: 'mov-1',
    item_id: 'item-1',
    type: 'in',
    quantity: 350,
    vendor_id: 'ven-1',
    bill_number: 'APX-2026-104',
    bill_id: null,
    issued_to: null,
    rate: 12.5,
    notes: 'Batch #B-991 receipt',
    movement_date: '2026-11-10',
    created_at: '2026-11-10T10:00:00Z',
  },
  {
    id: 'mov-2',
    item_id: 'item-1',
    type: 'out',
    quantity: 270,
    vendor_id: null,
    bill_number: null,
    bill_id: null,
    issued_to: 'Assembly Line 1',
    rate: null,
    notes: 'Chassis production run',
    movement_date: '2026-11-12',
    created_at: '2026-11-12T14:30:00Z',
  },
  {
    id: 'mov-3',
    item_id: 'item-3',
    type: 'in',
    quantity: 60,
    vendor_id: 'ven-2',
    bill_number: 'MET-8891',
    bill_id: null,
    issued_to: null,
    rate: 450.0,
    notes: 'Quarterly restock',
    movement_date: '2026-11-14',
    created_at: '2026-11-14T09:15:00Z',
  },
  {
    id: 'mov-4',
    item_id: 'item-3',
    type: 'out',
    quantity: 15,
    vendor_id: null,
    bill_number: null,
    bill_id: null,
    issued_to: 'Fabrication Bay B',
    rate: null,
    notes: 'Conveyor frame assembly',
    movement_date: '2026-11-15',
    created_at: '2026-11-15T11:00:00Z',
  },
  {
    id: 'mov-5',
    item_id: 'item-4',
    type: 'in',
    quantity: 10,
    vendor_id: 'ven-2',
    bill_number: 'MET-8891',
    bill_id: null,
    issued_to: null,
    rate: 1850.0,
    notes: 'Control box restock',
    movement_date: '2026-11-14',
    created_at: '2026-11-14T09:20:00Z',
  },
  {
    id: 'mov-6',
    item_id: 'item-4',
    type: 'out',
    quantity: 6,
    vendor_id: null,
    bill_number: null,
    bill_id: null,
    issued_to: 'Electrical Automation Lab',
    rate: null,
    notes: 'PLC panels dispatch',
    movement_date: '2026-11-16',
    created_at: '2026-11-16T15:45:00Z',
  },
];

const DEFAULT_VENDOR_ITEMS: VendorItem[] = [
  {
    id: 'vi-1',
    vendor_id: 'ven-1',
    item_id: 'item-1',
    last_rate: 12.5,
    created_at: '2026-11-10T10:00:00Z',
  },
  {
    id: 'vi-2',
    vendor_id: 'ven-2',
    item_id: 'item-3',
    last_rate: 450.0,
    created_at: '2026-11-14T09:15:00Z',
  },
  {
    id: 'vi-3',
    vendor_id: 'ven-2',
    item_id: 'item-4',
    last_rate: 1850.0,
    created_at: '2026-11-14T09:20:00Z',
  },
];

const DEFAULT_PAYMENTS: Payment[] = [
  {
    id: 'pay-1',
    vendor_id: 'ven-1',
    bill_number: 'APX-2026-104',
    amount: 4375,
    due_date: '2026-11-28',
    paid: false,
    paid_date: null,
    notes: 'Payment for 350x M8 bolts',
    created_at: '2026-11-10T10:00:00Z',
  },
  {
    id: 'pay-2',
    vendor_id: 'ven-2',
    bill_number: 'MET-8891',
    amount: 45500,
    due_date: '2026-11-14',
    paid: false,
    paid_date: null,
    notes: 'Brackets & enclosures delivery - Pending clearance',
    created_at: '2026-11-14T09:20:00Z',
  },
  {
    id: 'pay-3',
    vendor_id: 'ven-3',
    bill_number: 'PPT-5520',
    amount: 8200,
    due_date: '2026-11-05',
    paid: true,
    paid_date: '2026-11-04',
    notes: 'Settled via NEFT / Ref 8839120',
    created_at: '2026-11-01T00:00:00Z',
  },
];

function loadState(): DBState {
  if (typeof window === 'undefined') {
    return {
      categories: DEFAULT_CATEGORIES,
      vendors: DEFAULT_VENDORS,
      items: DEFAULT_ITEMS,
      vendor_items: DEFAULT_VENDOR_ITEMS,
      stock_movements: DEFAULT_MOVEMENTS,
      payments: DEFAULT_PAYMENTS,
      bills: [],
    };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        categories: parsed.categories?.length ? parsed.categories : DEFAULT_CATEGORIES,
        vendors: parsed.vendors ?? DEFAULT_VENDORS,
        items: parsed.items ?? DEFAULT_ITEMS,
        vendor_items: parsed.vendor_items ?? DEFAULT_VENDOR_ITEMS,
        stock_movements: parsed.stock_movements ?? DEFAULT_MOVEMENTS,
        payments: parsed.payments ?? DEFAULT_PAYMENTS,
        bills: parsed.bills ?? [],
      };
    }
  } catch (err) {
    console.warn('Failed to parse local state, resetting to defaults:', err);
  }

  const initial: DBState = {
    categories: DEFAULT_CATEGORIES,
    vendors: DEFAULT_VENDORS,
    items: DEFAULT_ITEMS,
    vendor_items: DEFAULT_VENDOR_ITEMS,
    stock_movements: DEFAULT_MOVEMENTS,
    payments: DEFAULT_PAYMENTS,
    bills: [],
  };
  saveState(initial);
  return initial;
}

function saveState(state: DBState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Failed to save local state to localStorage:', err);
  }
}

export function computeLiveStock(items: Item[], movements: StockMovement[]): LiveStockRow[] {
  return items.map((item) => {
    const inQty = movements
      .filter((m) => m.item_id === item.id && m.type === 'in')
      .reduce((sum, m) => sum + Number(m.quantity || 0), 0);
    const outQty = movements
      .filter((m) => m.item_id === item.id && m.type === 'out')
      .reduce((sum, m) => sum + Number(m.quantity || 0), 0);
    const stock = inQty - outQty;
    const is_low_stock = stock <= (item.reorder_level ?? 0);
    return {
      ...item,
      stock,
      is_low_stock,
    };
  });
}

function expandRelations(item: any, table: string, state: DBState): any {
  const result = { ...item };
  if (table === 'items') {
    if (result.category_id) {
      result.category = state.categories.find((c) => c.id === result.category_id) || null;
    }
  } else if (table === 'vendor_items') {
    if (result.item_id) {
      result.item = state.items.find((i) => i.id === result.item_id) || null;
    }
    if (result.vendor_id) {
      result.vendor = state.vendors.find((v) => v.id === result.vendor_id) || null;
    }
  } else if (table === 'stock_movements') {
    if (result.item_id) {
      result.item = state.items.find((i) => i.id === result.item_id) || null;
    }
    if (result.vendor_id) {
      result.vendor = state.vendors.find((v) => v.id === result.vendor_id) || null;
    }
  } else if (table === 'payments' || table === 'bills') {
    if (result.vendor_id) {
      result.vendor = state.vendors.find((v) => v.id === result.vendor_id) || null;
    }
  }
  return result;
}

export class LocalQueryBuilder {
  private table: string;
  private filters: Array<(row: any) => boolean> = [];
  private orderColumn: string | null = null;
  private orderAscending = true;
  private limitCount: number | null = null;
  private isSingle = false;
  private isMaybeSingle = false;
  private operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private payload: any = null;
  private upsertOptions?: { onConflict?: string };

  constructor(table: string) {
    this.table = table;
  }

  select(_columns = '*'): this {
    if (this.operation === 'select') {
      this.operation = 'select';
    }
    return this;
  }

  insert(data: any): this {
    this.operation = 'insert';
    this.payload = data;
    return this;
  }

  update(patch: any): this {
    this.operation = 'update';
    this.payload = patch;
    return this;
  }

  delete(): this {
    this.operation = 'delete';
    return this;
  }

  upsert(data: any, options?: { onConflict?: string }): this {
    this.operation = 'upsert';
    this.payload = data;
    this.upsertOptions = options;
    return this;
  }

  eq(column: string, value: any): this {
    this.filters.push((row) => String(row[column]) === String(value));
    return this;
  }

  ilike(column: string, pattern: string): this {
    const cleanPattern = pattern.replace(/%/g, '').toLowerCase();
    this.filters.push((row) => String(row[column] ?? '').toLowerCase().includes(cleanPattern));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderColumn = column;
    this.orderAscending = options?.ascending ?? true;
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  single(): Promise<{ data: any; error: any }> {
    this.isSingle = true;
    return this.execute();
  }

  maybeSingle(): Promise<{ data: any; error: any }> {
    this.isMaybeSingle = true;
    return this.execute();
  }

  then(onfulfilled?: ((value: { data: any; error: any }) => any) | null, onrejected?: ((reason: any) => any) | null): Promise<any> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: any; error: any }> {
    const state = loadState();

    if (this.operation === 'insert') {
      const records = Array.isArray(this.payload) ? this.payload : [this.payload];
      const created = records.map((rec) => ({
        id: rec.id || 'id-' + Math.random().toString(36).slice(2, 10),
        created_at: rec.created_at || new Date().toISOString(),
        updated_at: rec.updated_at || new Date().toISOString(),
        ...rec,
      }));

      const key = this.table as keyof DBState;
      if (Array.isArray(state[key])) {
        (state[key] as any[]).unshift(...created);
        saveState(state);
      }

      const res = Array.isArray(this.payload) ? created : created[0];
      return { data: res, error: null };
    }

    if (this.operation === 'update') {
      const key = this.table as keyof DBState;
      if (Array.isArray(state[key])) {
        const list = state[key] as any[];
        let updatedCount = 0;
        let lastUpdated = null;
        for (let i = 0; i < list.length; i++) {
          const match = this.filters.every((f) => f(list[i]));
          if (match) {
            list[i] = {
              ...list[i],
              ...this.payload,
              updated_at: new Date().toISOString(),
            };
            lastUpdated = list[i];
            updatedCount++;
          }
        }
        if (updatedCount > 0) {
          saveState(state);
        }
        return { data: lastUpdated, error: null };
      }
      return { data: null, error: null };
    }

    if (this.operation === 'delete') {
      const key = this.table as keyof DBState;
      if (Array.isArray(state[key])) {
        const list = state[key] as any[];
        const filtered = list.filter((row) => !this.filters.every((f) => f(row)));
        (state as any)[key] = filtered;
        saveState(state);
      }
      return { data: null, error: null };
    }

    if (this.operation === 'upsert') {
      const key = this.table as keyof DBState;
      if (Array.isArray(state[key])) {
        const list = state[key] as any[];
        const conflictFields = (this.upsertOptions?.onConflict || 'id').split(',').map((s) => s.trim());
        const existingIdx = list.findIndex((row) => conflictFields.every((f) => String(row[f]) === String(this.payload[f])));

        let result;
        if (existingIdx >= 0) {
          list[existingIdx] = {
            ...list[existingIdx],
            ...this.payload,
            updated_at: new Date().toISOString(),
          };
          result = list[existingIdx];
        } else {
          result = {
            id: this.payload.id || 'id-' + Math.random().toString(36).slice(2, 10),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...this.payload,
          };
          list.unshift(result);
        }
        saveState(state);
        return { data: result, error: null };
      }
      return { data: null, error: null };
    }

    // Default: 'select'
    let rows: any[] = [];
    if (this.table === 'live_stock') {
      rows = computeLiveStock(state.items, state.stock_movements);
    } else {
      const key = this.table as keyof DBState;
      rows = (state[key] as any[]) || [];
    }

    // Apply filters
    if (this.filters.length > 0) {
      rows = rows.filter((r) => this.filters.every((f) => f(r)));
    }

    // Expand relations
    rows = rows.map((r) => expandRelations(r, this.table, state));

    // Apply sorting
    if (this.orderColumn) {
      const col = this.orderColumn;
      const asc = this.orderAscending ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const va = a[col];
        const vb = b[col];
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === 'string') return va.localeCompare(vb) * asc;
        return (Number(va) - Number(vb)) * asc;
      });
    }

    // Apply limit
    if (this.limitCount != null) {
      rows = rows.slice(0, this.limitCount);
    }

    if (this.isSingle) {
      return { data: rows[0] || null, error: rows.length ? null : new Error('Row not found') };
    }

    if (this.isMaybeSingle) {
      return { data: rows[0] || null, error: null };
    }

    return { data: rows, error: null };
  }
}

export const localStore = {
  from(table: string) {
    return new LocalQueryBuilder(table);
  },
  storage: {
    from(_bucket: string) {
      return {
        upload: async (path: string, file: File) => {
          try {
            const dataUrl = await fileToDataUrl(file);
            await saveFile(path, dataUrl);
            return { data: { path }, error: null };
          } catch (err: any) {
            return { data: null, error: err };
          }
        },
        getPublicUrl: (path: string) => {
          return { data: { publicUrl: path } };
        },
        download: async (path: string) => {
          try {
            const dataUrl = await getFile(path);
            if (!dataUrl) return { data: null, error: new Error('File not found') };
            const blob = dataUrlToBlob(dataUrl);
            return { data: blob, error: null };
          } catch (err: any) {
            return { data: null, error: err };
          }
        },
        remove: async (paths: string[]) => {
          for (const p of paths) {
            await deleteFile(p);
          }
          return { data: paths, error: null };
        },
      };
    },
  },
};
