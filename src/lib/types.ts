export interface Category {
  id: string;
  name: string;
  created_at: string;
}

export interface Vendor {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gst_number: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Item {
  id: string;
  name: string;
  part_number: string | null;
  unit: string;
  category_id: string | null;
  reorder_level: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface VendorItem {
  id: string;
  vendor_id: string;
  item_id: string;
  last_rate: number | null;
  created_at: string;
  vendor?: Vendor;
  item?: Item;
}

export interface StockMovement {
  id: string;
  item_id: string;
  type: 'in' | 'out';
  quantity: number;
  vendor_id: string | null;
  bill_number: string | null;
  bill_id: string | null;
  issued_to: string | null;
  rate: number | null;
  notes: string | null;
  movement_date: string;
  created_at: string;
  item?: Item;
  vendor?: Vendor;
}

export interface LiveStockRow {
  id: string;
  name: string;
  part_number: string | null;
  unit: string;
  category_id: string | null;
  reorder_level: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  stock: number;
  is_low_stock: boolean;
}

export interface BillLineItem {
  num?: string;
  name: string;
  qty: number;
  rate: number;
  amount: number;
  unit?: string;
  sku?: string;
  category_id?: string | null;
  reorder_level?: number;
  rack_location?: string;
  raw_ocr?: string;
  matched_item_id?: string;
}

export interface Bill {
  id: string;
  vendor_id: string | null;
  file_name: string;
  storage_path: string;
  bill_number: string | null;
  bill_date: string | null;
  amount: number | null; // Grand Total (Payable amount inclusive of GST)
  subtotal?: number | null; // Taxable Value / Base amount
  cgst?: number | null; // Central GST
  sgst?: number | null; // State GST
  igst?: number | null; // Integrated GST
  tax_amount?: number | null; // Total GST
  rounding?: number | null; // Rounding off adjustment
  credit_days?: number | null;
  notes?: string | null;
  due_date?: string | null;
  status: 'pending' | 'processed' | 'error';
  extracted_text: string | null;
  created_at: string;
  vendor?: Vendor;
  line_items?: BillLineItem[];
}

export interface Payment {
  id: string;
  vendor_id: string;
  bill_number: string | null;
  amount: number;
  due_date: string;
  paid: boolean;
  paid_date: string | null;
  notes: string | null;
  created_at: string;
  vendor?: Vendor;
}

export type PageKey =
  | 'dashboard'
  | 'items'
  | 'material-entry'
  | 'material-issue'
  | 'live-stock'
  | 'vendors'
  | 'payments'
  | 'bills';
