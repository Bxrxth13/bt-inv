import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase, isSupabaseConfigured, getBillPreviewUrl } from '@/lib/supabase';
import { getFile, dataUrlToBlob } from '@/lib/fileStorage';
import { scanDocumentFile, parseInvoiceText } from '@/lib/documentScanner';
import {
  DuplicateConflict,
  findDuplicateInBills,
  findDuplicateInMovements,
} from '@/lib/duplicateChecker';
import { Bill, Vendor, Item, Category, BillLineItem, StockMovement } from '@/lib/types';
import { Badge, EmptyState, Spinner, toast } from '@/components/ui';
import { Modal } from '@/components/Modal';
import {
  FileScan,
  Upload,
  Sparkles,
  Trash2,
  FileText,
  AlertTriangle,
  Receipt,
  Plus,
  ExternalLink,
  ZoomIn,
  ZoomOut,
  X,
  CheckCircle2,
  Package,
  Save,
} from 'lucide-react';

interface DuplicateWarningState {
  conflict: DuplicateConflict;
  currentBillId?: string;
  currentFileName: string;
  isPostingAttempt?: boolean;
  pendingFile?: File;
  pendingParsed?: any;
}

export function BillsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [activeBillId, setActiveBillId] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateWarningState | null>(null);
  const [pendingPostCallback, setPendingPostCallback] = useState<(() => void) | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [b, v, it, c] = await Promise.all([
      supabase.from('bills').select('*, vendor:vendor_id(name)').order('created_at', { ascending: false }),
      supabase.from('vendors').select('*').order('name'),
      supabase.from('items').select('*').order('name'),
      supabase.from('categories').select('*').order('name'),
    ]);
    const billList = (b.data as Bill[] | null) ?? [];
    const vendorList = (v.data as Vendor[] | null) ?? [];
    setVendors(vendorList);
    setItems((it.data as Item[] | null) ?? []);
    setCategories((c.data as Category[] | null) ?? []);

    // Auto-heal any bills with uncalculated GST, invalid dates, or math discrepancies (e.g. Subtotal + GST !== Grand Total)
    let healedAny = false;
    for (const item of billList) {
      const sub = Number(item.subtotal) || 0;
      const tax = Number(item.tax_amount) || 0;
      const round = Number(item.rounding) || 0;
      const amt = Number(item.amount) || 0;
      const expectedTotal = Math.round((sub + tax + round) * 100) / 100;

      const hasMathDiscrepancy =
        sub > 0 && tax > 0 && (amt === 0 || Math.abs(amt - sub) < 2 || Math.abs(amt - expectedTotal) > 1);

      if (hasMathDiscrepancy) {
        await supabase.from('bills').update({
          amount: expectedTotal,
        }).eq('id', item.id);
        healedAny = true;
        continue;
      }

      const needsHealing =
        !item.line_items ||
        item.line_items.length === 0 ||
        item.amount == null ||
        item.amount === 0 ||
        item.tax_amount == null ||
        item.tax_amount === 0 ||
        item.bill_number === 'M' ||
        item.bill_date?.includes('2099');

      if (needsHealing) {
        try {
          let text = item.extracted_text;
          if (!text && item.storage_path) {
            const localData = await getFile(item.storage_path);
            if (localData) {
              const fileBlob = dataUrlToBlob(localData);
              const scanned = await scanDocumentFile(fileBlob, item.file_name, vendorList);
              text = scanned.rawText;
            }
          }
          if (text) {
            const healed = parseInvoiceText(text, item.file_name, vendorList);
            if (healed.amount > 0 || healed.lineItems.length > 0) {
              let matchedVenId = item.vendor_id;
              if (healed.vendorName) {
                const foundV = vendorList.find(
                  (v) =>
                    v.name.toLowerCase().includes(healed.vendorName.toLowerCase()) ||
                    healed.vendorName.toLowerCase().includes(v.name.toLowerCase())
                );
                if (foundV) matchedVenId = foundV.id;
              }
              await supabase.from('bills').update({
                vendor_id: matchedVenId || item.vendor_id,
                bill_number: healed.billNumber || item.bill_number,
                bill_date: healed.billDate || item.bill_date,
                subtotal: healed.subtotal,
                cgst: healed.cgst,
                sgst: healed.sgst,
                igst: healed.igst,
                tax_amount: healed.taxAmount,
                rounding: healed.rounding,
                amount: healed.amount,
                line_items: healed.lineItems,
                extracted_text: text,
                status: item.status || 'pending',
              }).eq('id', item.id);
              healedAny = true;
            }
          }
        } catch (e) {
          console.warn('Auto-heal bill failed:', e);
        }
      }
    }

    if (healedAny) {
      const reloaded = await supabase.from('bills').select('*, vendor:vendor_id(name)').order('created_at', { ascending: false });
      const list = (reloaded.data as Bill[] | null) ?? billList;
      setBills(list);
      if (!activeBillId && list.length > 0) setActiveBillId(list[0].id);
    } else {
      setBills(billList);
      if (!activeBillId && billList.length > 0) setActiveBillId(billList[0].id);
    }

    setLoading(false);
  }, [activeBillId]);

  useEffect(() => {
    load();
  }, [load]);

  // Persists a scanned bill to database and opens detailing
  const saveScannedBill = async (file: File, parsed: any, vendorList: Vendor[]) => {
    setUploading(true);
    const ext = file.name.split('.').pop();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const upRes = await supabase.storage.from('bills').upload(path, file);
    if (upRes.error) {
      setUploading(false);
      toast.error('Upload failed: ' + upRes.error.message);
      return;
    }

    let matchedVendorId: string | null = null;
    if (parsed.vendorName) {
      const found = vendorList.find(
        (v) =>
          v.name.toLowerCase() === parsed.vendorName.toLowerCase() ||
          v.name.toLowerCase().includes(parsed.vendorName.toLowerCase()) ||
          parsed.vendorName.toLowerCase().includes(v.name.toLowerCase())
      );

      if (found) {
        matchedVendorId = found.id;
        await supabase.from('vendors').update({
          name: parsed.vendorName,
          gst_number: parsed.gstNumber || found.gst_number,
          phone: parsed.phone || found.phone,
          email: parsed.email || found.email,
          address: parsed.address || found.address,
        }).eq('id', found.id);
      } else {
        const { data: newVen } = await supabase
          .from('vendors')
          .insert({
            name: parsed.vendorName,
            gst_number: parsed.gstNumber || null,
            phone: parsed.phone || null,
            email: parsed.email || null,
            address: parsed.address || null,
            notes: `Auto-registered from invoice ${parsed.billNumber || file.name}`,
          })
          .select()
          .single();

        if (newVen) matchedVendorId = newVen.id;
      }
    }

    const mappedItems: BillLineItem[] = parsed.lineItems.map((it: any) => {
      const matched = items.find((ex) =>
        ex.name.toLowerCase().includes(it.name.toLowerCase()) ||
        it.name.toLowerCase().includes(ex.name.toLowerCase())
      );
      return {
        ...it,
        matched_item_id: matched ? matched.id : '__new__',
        category_id: matched ? matched.category_id : null,
        sku: matched?.part_number || '',
        reorder_level: matched?.reorder_level || 10,
      };
    });

    const linesSum = Math.round(mappedItems.reduce((s, it) => s + (it.amount || 0), 0) * 100) / 100;
    const billSubtotal = linesSum > 0 ? linesSum : parsed.subtotal;
    const billTax = parsed.taxAmount || Math.round((parsed.cgst + parsed.sgst + parsed.igst) * 100) / 100;
    const billAmount = Math.round((billSubtotal + billTax + parsed.rounding) * 100) / 100;

    const { data: newBill, error: insErr } = await supabase
      .from('bills')
      .insert({
        file_name: file.name,
        storage_path: path,
        status: 'pending',
        vendor_id: matchedVendorId,
        bill_number: parsed.billNumber,
        bill_date: parsed.billDate,
        amount: billAmount,
        subtotal: billSubtotal,
        cgst: parsed.cgst,
        sgst: parsed.sgst,
        igst: parsed.igst,
        tax_amount: billTax,
        rounding: parsed.rounding,
        extracted_text: parsed.rawText,
        line_items: mappedItems,
      })
      .select('*, vendor:vendor_id(name)')
      .single();

    setUploading(false);
    if (insErr || !newBill) {
      toast.error('Failed to save bill record: ' + (insErr?.message ?? 'unknown'));
      return;
    }

    const gstLabel = parsed.taxAmount > 0 ? ` (GST: ₹${parsed.taxAmount.toLocaleString('en-IN')})` : '';
    toast.success(`Parsed: ₹${parsed.amount.toLocaleString('en-IN')} Total${gstLabel}`);
    setActiveBillId(newBill.id);
    load();
  };

  // Upload handler with strict pre-upload duplicate detection
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);

    try {
      // 1. Fetch fresh persistent database state
      const [bRes, vRes, mRes] = await Promise.all([
        supabase.from('bills').select('*, vendor:vendor_id(name)').order('created_at', { ascending: false }),
        supabase.from('vendors').select('*').order('name'),
        supabase.from('stock_movements').select('*, vendor:vendor_id(name)').eq('type', 'in'),
      ]);
      const currentBills = (bRes.data as Bill[] | null) ?? [];
      const currentVendors = (vRes.data as Vendor[] | null) ?? [];
      const currentMovements = (mRes.data as StockMovement[] | null) ?? [];

      // 2. Scan file content in-memory first
      const parsed = await scanDocumentFile(file, file.name, currentVendors);

      // 3. Check for duplicates against existing bills
      const billConflict = findDuplicateInBills(
        null,
        parsed.billNumber,
        parsed.vendorName,
        null,
        parsed.gstNumber,
        currentBills,
        currentVendors
      );

      // 4. Check for duplicates against inventory stock movements
      const movementConflict = findDuplicateInMovements(
        parsed.billNumber,
        parsed.vendorName,
        null,
        currentMovements,
        currentVendors
      );

      // 5. Check if exact same file name was already uploaded
      const fileConflict = currentBills.find(
        (b) => b.file_name.toLowerCase().trim() === file.name.toLowerCase().trim()
      );

      const conflict: DuplicateConflict | null =
        billConflict ||
        movementConflict ||
        (fileConflict
          ? {
              type: 'bill',
              billNumber: fileConflict.bill_number || parsed.billNumber,
              vendorName: fileConflict.vendor?.name || parsed.vendorName || 'Supplier',
              existingId: fileConflict.id,
              existingFileName: fileConflict.file_name,
              existingStatus: fileConflict.status,
              existingAmount: Number(fileConflict.amount || 0),
              existingDate: fileConflict.bill_date || undefined,
              message: `A bill file named "${file.name}" has already been uploaded (Invoice #${fileConflict.bill_number || '—'}).`,
            }
          : null);

      // IF DUPLICATE IS DETECTED:
      // PREVENT silent duplicate insertion! Show modal warning immediately.
      if (conflict) {
        setUploading(false);
        setDuplicateWarning({
          conflict,
          currentFileName: file.name,
          pendingFile: file,
          pendingParsed: parsed,
          isPostingAttempt: false,
        });
        if (fileRef.current) fileRef.current.value = '';
        return;
      }

      // No duplicate: proceed to upload and persist
      await saveScannedBill(file, parsed, currentVendors);
    } catch (err) {
      setUploading(false);
      toast.error('Upload failed: ' + (err as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const scanBill = async (billId: string, directFile?: File) => {
    setScanningId(billId);

    try {
      const { data: bill } = await supabase.from('bills').select('*').eq('id', billId).maybeSingle();
      if (!bill) throw new Error('Bill not found');

      const { data: currentVendors } = await supabase.from('vendors').select('*');
      const vendorList: Vendor[] = (currentVendors as Vendor[]) || vendors;

      let fileBlob: Blob | File | null = directFile || null;
      if (!fileBlob) {
        const localData = await getFile(bill.storage_path);
        if (localData) {
          fileBlob = dataUrlToBlob(localData);
        } else if (isSupabaseConfigured()) {
          const dl = await supabase.storage.from('bills').download(bill.storage_path);
          if (dl.data) fileBlob = dl.data;
        }
      }

      let parsed;
      if (fileBlob) {
        parsed = await scanDocumentFile(fileBlob, bill.file_name, vendorList);
      } else if (bill.extracted_text) {
        parsed = parseInvoiceText(bill.extracted_text, bill.file_name, vendorList);
      } else {
        throw new Error('Could not access document file for scanning');
      }

      let matchedVendorId = bill.vendor_id;
      if (parsed.vendorName) {
        const found = vendorList.find(
          (v) =>
            v.name.toLowerCase() === parsed.vendorName.toLowerCase() ||
            v.name.toLowerCase().includes(parsed.vendorName.toLowerCase()) ||
            parsed.vendorName.toLowerCase().includes(v.name.toLowerCase())
        );

        if (found) {
          matchedVendorId = found.id;
          await supabase.from('vendors').update({
            name: parsed.vendorName,
            gst_number: parsed.gstNumber || found.gst_number,
            phone: parsed.phone || found.phone,
            email: parsed.email || found.email,
            address: parsed.address || found.address,
          }).eq('id', found.id);
        } else {
          const { data: newVen } = await supabase
            .from('vendors')
            .insert({
              name: parsed.vendorName,
              gst_number: parsed.gstNumber || null,
              phone: parsed.phone || null,
              email: parsed.email || null,
              address: parsed.address || null,
              notes: `Auto-registered from invoice ${parsed.billNumber || bill.file_name}`,
            })
            .select()
            .single();

          if (newVen) {
            matchedVendorId = newVen.id;
          }
        }
      }

      // Map line items with raw_ocr and auto-matches
      const mappedItems: BillLineItem[] = parsed.lineItems.map((it) => {
        const matched = items.find((ex) =>
          ex.name.toLowerCase().includes(it.name.toLowerCase()) ||
          it.name.toLowerCase().includes(ex.name.toLowerCase())
        );
        return {
          ...it,
          matched_item_id: matched ? matched.id : '__new__',
          category_id: matched ? matched.category_id : null,
          sku: matched?.part_number || '',
          reorder_level: matched?.reorder_level || 10,
        };
      });

      const linesSum = Math.round(mappedItems.reduce((s, it) => s + (it.amount || 0), 0) * 100) / 100;
      const billSubtotal = linesSum > 0 ? linesSum : parsed.subtotal;
      const billTax = parsed.taxAmount || Math.round((parsed.cgst + parsed.sgst + parsed.igst) * 100) / 100;
      const billAmount = Math.round((billSubtotal + billTax + parsed.rounding) * 100) / 100;

      const updatedFields: Partial<Bill> = {
        status: bill.status === 'processed' ? 'processed' : 'pending',
        vendor_id: matchedVendorId || null,
        bill_number: parsed.billNumber,
        bill_date: parsed.billDate,
        amount: billAmount,
        subtotal: billSubtotal,
        cgst: parsed.cgst,
        sgst: parsed.sgst,
        igst: parsed.igst,
        tax_amount: billTax,
        rounding: parsed.rounding,
        extracted_text: parsed.rawText || bill.extracted_text,
        line_items: mappedItems,
      };

      await supabase.from('bills').update(updatedFields).eq('id', billId);
      const gstLabel = billTax > 0 ? ` (GST: ₹${billTax.toLocaleString('en-IN')})` : '';
      toast.success(`Parsed: ₹${billAmount.toLocaleString('en-IN')} Total${gstLabel}`);

      // Check for duplicate against other bills
      const conflict = findDuplicateInBills(
        billId,
        parsed.billNumber,
        parsed.vendorName,
        matchedVendorId,
        parsed.gstNumber,
        bills,
        vendorList
      );

      if (conflict) {
        setDuplicateWarning({
          conflict,
          currentBillId: billId,
          currentFileName: bill.file_name,
        });
      }
    } catch (err) {
      console.error('Scan error:', err);
      toast.error('Scanning error: ' + (err as Error).message);
    } finally {
      setScanningId(null);
      load();
    }
  };

  const deleteBill = async (bill: Bill) => {
    try {
      await supabase.storage.from('bills').remove([bill.storage_path]);
      await supabase.from('bills').delete().eq('id', bill.id);
      toast.success('Bill deleted');
      if (activeBillId === bill.id) {
        const remaining = bills.filter((b) => b.id !== bill.id);
        setActiveBillId(remaining.length > 0 ? remaining[0].id : null);
      }
      load();
    } catch (err) {
      toast.error('Delete failed: ' + (err as Error).message);
    }
  };

  const activeBill = bills.find((b) => b.id === activeBillId) || null;

  return (
    <div className="space-y-6">
      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        onChange={handleFile}
        className="hidden"
      />

      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between border-b border-zinc-800/80 pb-5">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-400 border border-amber-500/20 mb-2">
            <Sparkles size={12} className="text-amber-400" /> AI Bill Scanner &middot; OCR &amp; Parser
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Upload &amp; Scan Vendor Bill</h1>
          <p className="mt-1 text-sm text-zinc-400 max-w-3xl leading-relaxed">
            Upload the vendor's invoice (photo or PDF). AI reads the vendor, bill number, dates, every line item and GST exactly as printed. Review, correct if needed, and post — stock and payment reminder are created together.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {activeBill && (
            <button
              onClick={() => setActiveBillId(null)}
              className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            >
              All Bills ({bills.length})
            </button>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-800 border border-zinc-700 px-3.5 py-2 text-xs font-semibold text-zinc-100 hover:bg-zinc-700 shadow-sm transition-colors"
          >
            <Upload size={14} className="text-amber-400" />
            {uploading ? 'Processing...' : 'New Bill'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      ) : activeBill ? (
        <ScannerDetailingView
          bill={activeBill}
          allBills={bills}
          vendors={vendors}
          items={items}
          categories={categories}
          isScanning={scanningId === activeBill.id}
          onRescan={() => scanBill(activeBill.id)}
          onClose={() => setActiveBillId(null)}
          onDelete={() => deleteBill(activeBill)}
          onRefresh={load}
          onSwitchBill={(id) => setActiveBillId(id)}
          onShowDuplicateWarning={(conflictState, onConfirmPost) => {
            setDuplicateWarning(conflictState);
            if (onConfirmPost) {
              setPendingPostCallback(() => onConfirmPost);
            }
          }}
        />
      ) : (
        /* Bills Overview / Empty State */
        <div className="space-y-6">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-800 bg-zinc-900/30 py-12 text-center transition-colors hover:border-amber-500/40 hover:bg-amber-500/5">
            <input type="file" accept="image/*,application/pdf" onChange={handleFile} className="hidden" />
            <div className="h-12 w-12 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400 mb-3 border border-amber-500/20">
              <FileScan size={26} />
            </div>
            <p className="text-sm font-semibold text-zinc-200">Click or drop to upload a vendor bill</p>
            <p className="mt-1 text-xs text-zinc-500">Supports PDF, PNG, or JPG — automatic text, GST, and line item extraction</p>
          </label>

          {bills.length === 0 ? (
            <EmptyState
              icon={<FileText size={36} />}
              title="No bills uploaded yet"
              subtitle="Upload your first vendor bill above to scan line items and compute GST"
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {bills.map((b) => (
                <div
                  key={b.id}
                  onClick={() => setActiveBillId(b.id)}
                  className="group cursor-pointer rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 transition-all hover:border-amber-500/40 hover:bg-zinc-900/70"
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <FileText size={16} className="text-zinc-500 shrink-0 group-hover:text-amber-400" />
                        <span className="truncate text-sm font-semibold text-zinc-100">{b.file_name}</span>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {new Date(b.created_at).toLocaleDateString('en-IN')}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <Badge color={b.status === 'processed' ? 'emerald' : 'amber'}>
                        {b.status === 'processed' ? 'Posted' : 'Pending Review'}
                      </Badge>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteBill(b);
                        }}
                        className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400 transition-colors cursor-pointer"
                        title="Delete bill"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1.5 text-xs text-zinc-400">
                    <div className="truncate">
                      <span className="text-zinc-500">Vendor:</span>{' '}
                      <span className="font-medium text-zinc-200">{b.vendor?.name || 'Supplier'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Bill #: <span className="font-mono text-zinc-300">{b.bill_number || '—'}</span></span>
                      <span>{b.line_items?.length || 0} item(s)</span>
                    </div>
                    <div className="pt-2 border-t border-zinc-800/80 flex items-baseline justify-between">
                      <span className="text-xs text-zinc-500">Total:</span>
                      <span className="text-base font-bold text-amber-400 font-mono">
                        ₹{Number(b.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Duplicate / Double Entry Warning Modal */}
      <DuplicateWarningModal
        warningState={duplicateWarning}
        onClose={() => {
          setDuplicateWarning(null);
          setPendingPostCallback(null);
        }}
        onViewExisting={(id) => {
          if (duplicateWarning?.conflict.type === 'bill') {
            setActiveBillId(id);
            toast.success(`Switched to existing Bill #${duplicateWarning.conflict.billNumber}`);
          } else {
            toast.info(`Matched existing Stock Receipt #${duplicateWarning?.conflict.billNumber} (${duplicateWarning?.conflict.vendorName})`);
          }
          setDuplicateWarning(null);
          setPendingPostCallback(null);
        }}
        onDiscard={async () => {
          if (duplicateWarning?.currentBillId) {
            const b = bills.find((item) => item.id === duplicateWarning.currentBillId);
            if (b) await deleteBill(b);
          }
          if (duplicateWarning?.conflict.existingId) {
            setActiveBillId(duplicateWarning.conflict.existingId);
          }
          setDuplicateWarning(null);
          setPendingPostCallback(null);
          toast.success('Duplicate entry discarded');
        }}
        onProceedAnyway={async () => {
          if (duplicateWarning?.isPostingAttempt && pendingPostCallback) {
            pendingPostCallback();
            setPendingPostCallback(null);
            setDuplicateWarning(null);
          } else if (duplicateWarning?.pendingFile && duplicateWarning?.pendingParsed) {
            const file = duplicateWarning.pendingFile;
            const parsed = duplicateWarning.pendingParsed;
            setDuplicateWarning(null);
            await saveScannedBill(file, parsed, vendors);
          } else {
            setDuplicateWarning(null);
          }
        }}
      />
    </div>
  );
}

function ScannerDetailingView({
  bill,
  allBills,
  vendors,
  items,
  categories,
  isScanning,
  onRescan,
  onClose,
  onDelete,
  onRefresh,
  onSwitchBill,
  onShowDuplicateWarning,
}: {
  bill: Bill;
  allBills: Bill[];
  vendors: Vendor[];
  items: Item[];
  categories: Category[];
  isScanning: boolean;
  onRescan: () => void;
  onClose: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  onSwitchBill: (billId: string) => void;
  onShowDuplicateWarning: (conflictState: DuplicateWarningState, onConfirmPost?: () => void) => void;
}) {
  const [fileUrl, setFileUrl] = useState<string>('');
  const [zoom, setZoom] = useState<number>(100);

  // Form states
  const [selectedVendorOption, setSelectedVendorOption] = useState<string>(bill.vendor_id || '__new__');
  const [vendorName, setVendorName] = useState<string>(bill.vendor?.name || '');
  const [gstNumber, setGstNumber] = useState<string>(bill.vendor?.gst_number || '');
  const [phone, setPhone] = useState<string>(bill.vendor?.phone || '');
  const [address, setAddress] = useState<string>(bill.vendor?.address || '');
  const [creditDays, setCreditDays] = useState<number>(bill.credit_days || 30);

  const [billNumber, setBillNumber] = useState<string>(bill.bill_number || '');
  const [billDate, setBillDate] = useState<string>(bill.bill_date || new Date().toISOString().slice(0, 10));

  // Line items state
  const [lineItems, setLineItems] = useState<BillLineItem[]>(() => {
    return (bill.line_items || []).map((it, idx) => ({
      ...it,
      num: it.num || String(idx + 1),
      matched_item_id: it.matched_item_id || '__new__',
      unit: it.unit || 'pcs',
      category_id: it.category_id || categories[0]?.id || null,
      reorder_level: it.reorder_level ?? 10,
      sku: it.sku || '',
      rack_location: it.rack_location || '',
    }));
  });

  // Financials & Payment states (with automatic ground truth from line items)
  const parsedLinesSum = Math.round(
    (bill.line_items || []).reduce((s, it) => s + (Number(it.amount) || 0), 0) * 100
  ) / 100;
  const initialSub = parsedLinesSum > 0 && (Number(bill.subtotal) === 0 || Math.abs(parsedLinesSum - Number(bill.subtotal)) > 2)
    ? parsedLinesSum
    : Number(bill.subtotal) || parsedLinesSum;

  const [subtotal, setSubtotal] = useState<number>(initialSub);
  const [cgst, setCgst] = useState<number>(Number(bill.cgst) || 0);
  const [sgst, setSgst] = useState<number>(Number(bill.sgst) || 0);
  const [igst, setIgst] = useState<number>(Number(bill.igst) || 0);
  const initialTax = Number(bill.tax_amount) || Math.round((Number(bill.cgst || 0) + Number(bill.sgst || 0) + Number(bill.igst || 0)) * 100) / 100;
  const [taxAmount, setTaxAmount] = useState<number>(initialTax);
  const [rounding, setRounding] = useState<number>(Number(bill.rounding) || 0);
  const calculatedInitTotal = Math.round((initialSub + initialTax + Number(bill.rounding || 0)) * 100) / 100;
  const initialAmt = initialSub > 0 && (Number(bill.amount) === 0 || Math.abs(Number(bill.amount) - calculatedInitTotal) > 1)
    ? calculatedInitTotal
    : Number(bill.amount) || calculatedInitTotal;
  const [amount, setAmount] = useState<number>(initialAmt);

  const [addToPayments, setAddToPayments] = useState<boolean>(true);
  const [dueDate, setDueDate] = useState<string>(bill.due_date || '');
  const [notes, setNotes] = useState<string>(bill.notes || '');
  const [posting, setPosting] = useState<boolean>(false);

  // Check if this bill has already been posted to inventory
  const isAlreadyProcessed = bill.status === 'processed';

  // Dynamic double entry check against all other bills
  const duplicateConflict = findDuplicateInBills(
    bill.id,
    billNumber,
    vendorName,
    selectedVendorOption !== '__new__' ? selectedVendorOption : null,
    gstNumber,
    allBills,
    vendors
  );

  // Sync state whenever active bill data updates (e.g. scanning finishes)
  useEffect(() => {
    setSelectedVendorOption(bill.vendor_id || '__new__');
    setVendorName(bill.vendor?.name || '');
    setGstNumber(bill.vendor?.gst_number || '');
    setPhone(bill.vendor?.phone || '');
    setAddress(bill.vendor?.address || '');
    setCreditDays(bill.credit_days || 30);
    setBillNumber(bill.bill_number || '');
    setBillDate(bill.bill_date || new Date().toISOString().slice(0, 10));
    setLineItems(
      (bill.line_items || []).map((it, idx) => ({
        ...it,
        num: it.num || String(idx + 1),
        matched_item_id: it.matched_item_id || '__new__',
        unit: it.unit || 'pcs',
        category_id: it.category_id || categories[0]?.id || null,
        reorder_level: it.reorder_level ?? 10,
        sku: it.sku || '',
        rack_location: it.rack_location || '',
      }))
    );
    const currentLinesSum = Math.round(
      (bill.line_items || []).reduce((s, it) => s + (Number(it.amount) || 0), 0) * 100
    ) / 100;
    let syncSub = Number(bill.subtotal) || 0;
    if (currentLinesSum > 0 && (syncSub === 0 || Math.abs(currentLinesSum - syncSub) > 2)) {
      syncSub = currentLinesSum;
    }
    const initialCgst = Number(bill.cgst) || 0;
    const initialSgst = Number(bill.sgst) || 0;
    const initialIgst = Number(bill.igst) || 0;
    const initialTax = Number(bill.tax_amount) || Math.round((initialCgst + initialSgst + initialIgst) * 100) / 100;
    const initialRound = Number(bill.rounding) || 0;
    let initialAmt = Number(bill.amount) || 0;

    const expectedTotal = Math.round((syncSub + initialTax + initialRound) * 100) / 100;
    if (syncSub > 0 && initialTax > 0) {
      if (initialAmt === 0 || Math.abs(initialAmt - syncSub) < 2 || Math.abs(initialAmt - expectedTotal) > 1) {
        initialAmt = expectedTotal;
      }
    } else if (initialAmt === 0 && syncSub > 0) {
      initialAmt = Math.round((syncSub + initialRound) * 100) / 100;
    }

    setSubtotal(syncSub);
    setCgst(initialCgst);
    setSgst(initialSgst);
    setIgst(initialIgst);
    setTaxAmount(initialTax);
    setRounding(initialRound);
    setAmount(initialAmt);
    if (bill.due_date) setDueDate(bill.due_date);
    if (bill.notes) setNotes(bill.notes);
  }, [
    bill.id,
    bill.status,
    bill.vendor_id,
    bill.vendor?.name,
    bill.bill_number,
    bill.bill_date,
    bill.amount,
    bill.subtotal,
    bill.tax_amount,
    bill.line_items,
    bill.due_date,
    bill.notes,
    categories,
  ]);

  // Sync preview url
  useEffect(() => {
    (async () => {
      const url = await getBillPreviewUrl(bill.storage_path);
      setFileUrl(url);
    })();
  }, [bill.storage_path]);

  // Compute payment due date automatically from billDate + creditDays
  useEffect(() => {
    if (billDate) {
      const d = new Date(billDate);
      if (!isNaN(d.getTime())) {
        d.setDate(d.getDate() + (Number(creditDays) || 30));
        setDueDate(d.toISOString().slice(0, 10));
      }
    }
  }, [billDate, creditDays]);

  // Update vendor profile if vendor dropdown changes
  const handleVendorSelect = (val: string) => {
    setSelectedVendorOption(val);
    if (val !== '__new__') {
      const v = vendors.find((vend) => vend.id === val);
      if (v) {
        setVendorName(v.name);
        setGstNumber(v.gst_number || '');
        setPhone(v.phone || '');
        setAddress(v.address || '');
      }
    }
  };

  const handleOpenInNewTab = () => {
    if (!fileUrl) return;
    try {
      if (fileUrl.startsWith('data:')) {
        const blob = dataUrlToBlob(fileUrl);
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank');
      } else {
        window.open(fileUrl, '_blank');
      }
    } catch {
      window.open(fileUrl, '_blank');
    }
  };

  // Recalculate line amounts
  const handleItemFieldChange = (idx: number, field: keyof BillLineItem, val: any) => {
    const updated = [...lineItems];
    const item = { ...updated[idx], [field]: val };

    if (field === 'qty' || field === 'rate') {
      const q = field === 'qty' ? parseFloat(val) || 0 : item.qty;
      const r = field === 'rate' ? parseFloat(val) || 0 : item.rate;
      item.amount = Math.round(q * r * 100) / 100;
    }

    if (field === 'matched_item_id') {
      if (val !== '__new__') {
        const found = items.find((i) => i.id === val);
        if (found) {
          item.name = found.name;
          item.unit = found.unit;
          item.sku = found.part_number || '';
          item.category_id = found.category_id;
          item.reorder_level = found.reorder_level;
        }
      }
    }

    updated[idx] = item;
    setLineItems(updated);

    const newSub = Math.round(updated.reduce((s, it) => s + (it.amount || 0), 0) * 100) / 100;
    setSubtotal(newSub);
    const newTotal = Math.round((newSub + taxAmount + rounding) * 100) / 100;
    setAmount(newTotal);
  };

  const handleAddLine = () => {
    const newLine: BillLineItem = {
      num: String(lineItems.length + 1),
      name: 'New Material Item',
      qty: 1,
      unit: 'pc',
      rate: 100,
      amount: 100,
      matched_item_id: '__new__',
      category_id: categories[0]?.id || null,
      reorder_level: 10,
      sku: '',
      rack_location: '',
      raw_ocr: `Manual Line ${lineItems.length + 1}`,
    };
    const updated = [...lineItems, newLine];
    setLineItems(updated);
    const newSub = Math.round(updated.reduce((s, it) => s + (it.amount || 0), 0) * 100) / 100;
    setSubtotal(newSub);
    setAmount(Math.round((newSub + taxAmount + rounding) * 100) / 100);
  };

  const handleDeleteLine = (idx: number) => {
    const updated = lineItems.filter((_, i) => i !== idx);
    setLineItems(updated);
    const newSub = Math.round(updated.reduce((s, it) => s + (it.amount || 0), 0) * 100) / 100;
    setSubtotal(newSub);
    setAmount(Math.round((newSub + taxAmount + rounding) * 100) / 100);
  };

  // Update Bill Details Only (Without duplicate posting to stock or ledger)
  const handleUpdateDetailsOnly = async () => {
    setPosting(true);
    try {
      let finalVendorId = selectedVendorOption !== '__new__' ? selectedVendorOption : null;
      if (!finalVendorId && vendorName.trim()) {
        const { data: newV } = await supabase
          .from('vendors')
          .insert({
            name: vendorName.trim(),
            gst_number: gstNumber || null,
            phone: phone || null,
            address: address || null,
            notes: `Auto-registered from bill ${billNumber}`,
          })
          .select()
          .single();
        if (newV) finalVendorId = newV.id;
      }

      const finalTax = Math.round((cgst + sgst + igst) * 100) / 100 || taxAmount;
      const finalAmount = Math.round((subtotal + finalTax + rounding) * 100) / 100 || amount;

      await supabase
        .from('bills')
        .update({
          vendor_id: finalVendorId,
          bill_number: billNumber,
          bill_date: billDate,
          subtotal: subtotal,
          cgst: cgst,
          sgst: sgst,
          igst: igst,
          tax_amount: finalTax,
          rounding: rounding,
          amount: finalAmount,
          credit_days: creditDays,
          due_date: dueDate,
          notes: notes || null,
          line_items: lineItems,
        })
        .eq('id', bill.id);

      toast.success('Bill details updated successfully');
      onRefresh();
    } catch (err) {
      toast.error('Update failed: ' + (err as Error).message);
    } finally {
      setPosting(false);
    }
  };

  // Confirm and Post Entry (Atomic pipeline with double entry protection)
  const handleConfirmAndPost = async (forcePost = false) => {
    if (!billNumber) {
      toast.error('Please enter a Bill / Invoice number');
      return;
    }
    if (lineItems.length === 0) {
      toast.error('At least one line item is required');
      return;
    }

    // Double entry check against persistent stock movements table
    const { data: currentMovements } = await supabase
      .from('stock_movements')
      .select('*, vendor:vendor_id(name)')
      .eq('type', 'in');

    const movementConflict = findDuplicateInMovements(
      billNumber,
      vendorName,
      selectedVendorOption !== '__new__' ? selectedVendorOption : null,
      (currentMovements as StockMovement[]) || [],
      vendors
    );

    const activeConflict = duplicateConflict || movementConflict;

    if (activeConflict && !forcePost) {
      onShowDuplicateWarning(
        {
          conflict: activeConflict,
          currentBillId: bill.id,
          currentFileName: bill.file_name,
          isPostingAttempt: true,
        },
        () => handleConfirmAndPost(true)
      );
      return;
    }

    setPosting(true);
    try {
      // 1. Resolve or Create Vendor
      let finalVendorId = selectedVendorOption !== '__new__' ? selectedVendorOption : null;
      if (!finalVendorId && vendorName.trim()) {
        const { data: newV } = await supabase
          .from('vendors')
          .insert({
            name: vendorName.trim(),
            gst_number: gstNumber || null,
            phone: phone || null,
            address: address || null,
            notes: `Auto-registered from bill ${billNumber}`,
          })
          .select()
          .single();
        if (newV) finalVendorId = newV.id;
      }

      // 2. Resolve / Create Items & Post Material Entry (Stock Movements)
      let postedItemsCount = 0;
      for (const it of lineItems) {
        let itemId = it.matched_item_id !== '__new__' ? it.matched_item_id : null;

        // Create new item if needed
        if (!itemId) {
          const { data: createdItem } = await supabase
            .from('items')
            .insert({
              name: it.name.trim(),
              part_number: it.sku || null,
              unit: it.unit || 'pc',
              category_id: it.category_id || null,
              reorder_level: Number(it.reorder_level) || 10,
              notes: it.rack_location ? `Location: ${it.rack_location}` : null,
            })
            .select()
            .single();
          if (createdItem) itemId = createdItem.id;
        }

        // Post stock inward movement
        if (itemId) {
          await supabase.from('stock_movements').insert({
            item_id: itemId,
            type: 'in',
            quantity: Number(it.qty) || 1,
            rate: Number(it.rate) || null,
            vendor_id: finalVendorId,
            bill_number: billNumber,
            bill_id: bill.id,
            movement_date: billDate || new Date().toISOString().slice(0, 10),
            notes: `Inward receipt from ${bill.file_name}`,
          });

          // Update vendor items catalog
          if (finalVendorId && it.rate) {
            await supabase.from('vendor_items').upsert(
              {
                vendor_id: finalVendorId,
                item_id: itemId,
                last_rate: it.rate,
              },
              { onConflict: 'vendor_id,item_id' }
            );
          }
          postedItemsCount++;
        }
      }

      const finalTax = Math.round((cgst + sgst + igst) * 100) / 100 || taxAmount;
      const finalAmount = Math.round((subtotal + finalTax + rounding) * 100) / 100 || amount;

      // 3. Create Payment Reminder if selected
      if (addToPayments && finalVendorId && finalAmount > 0) {
        await supabase.from('payments').insert({
          vendor_id: finalVendorId,
          amount: finalAmount,
          due_date: dueDate || new Date().toISOString().slice(0, 10),
          bill_number: billNumber,
          paid: false,
          notes: `Vendor Bill #${billNumber} (Incl. GST ₹${finalTax.toLocaleString('en-IN')})`,
        });
      }

      // 4. Update Bill record to 'processed'
      await supabase
        .from('bills')
        .update({
          status: 'processed',
          vendor_id: finalVendorId,
          bill_number: billNumber,
          bill_date: billDate,
          subtotal: subtotal,
          cgst: cgst,
          sgst: sgst,
          igst: igst,
          tax_amount: finalTax,
          rounding: rounding,
          amount: finalAmount,
          credit_days: creditDays,
          due_date: dueDate,
          notes: notes || null,
          line_items: lineItems,
        })
        .eq('id', bill.id);

      toast.success(`Bill #${billNumber} posted! ${postedItemsCount} item(s) received into stock.`);
      onRefresh();
      onClose();
    } catch (err) {
      console.error('Post entry error:', err);
      toast.error('Failed to post entry: ' + (err as Error).message);
    } finally {
      setPosting(false);
    }
  };

  const isPdf = bill.file_name.toLowerCase().endsWith('.pdf');
  const linesSum = Math.round(lineItems.reduce((s, it) => s + (it.amount || 0), 0) * 100) / 100;
  const hasDiscrepancy = subtotal > 0 && Math.abs(linesSum - subtotal) > 2;

  return (
    <div className="space-y-4">
      {/* DOUBLE ENTRY WARNING ALERT IF DUPLICATE IS DETECTED */}
      {duplicateConflict && (
        <div className="rounded-xl border border-amber-500/50 bg-amber-500/15 p-4 text-xs text-amber-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-lg shadow-amber-500/10">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-amber-500/20 p-2 text-amber-400 shrink-0 mt-0.5">
              <AlertTriangle size={18} />
            </div>
            <div>
              <div className="font-bold text-sm text-amber-300">
                Warning: Double Entry Detected
              </div>
              <p className="mt-0.5 text-xs text-amber-200/90 leading-relaxed">
                Bill <strong>#{billNumber}</strong> from vendor "<strong>{vendorName}</strong>" matches an existing record{' '}
                <span className="font-mono text-zinc-100 font-semibold">{duplicateConflict.existingFileName || duplicateConflict.billNumber}</span>{' '}
                (Amount: <span className="font-mono font-bold text-emerald-400">₹{Number(duplicateConflict.existingAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>).
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {duplicateConflict.existingId && (
              <button
                onClick={() => onSwitchBill(duplicateConflict.existingId)}
                className="rounded-lg border border-amber-500/40 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <ExternalLink size={13} /> View Existing Bill
              </button>
            )}
            <button
              onClick={() => {
                onShowDuplicateWarning(
                  {
                    conflict: duplicateConflict,
                    currentBillId: bill.id,
                    currentFileName: bill.file_name,
                    isPostingAttempt: true,
                  },
                  () => handleConfirmAndPost(true)
                );
              }}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition-colors cursor-pointer"
            >
              Review Warning
            </button>
          </div>
        </div>
      )}

      {/* 1. DOCUMENT VIEWER CARD */}
      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-xl">
        {/* Viewer Header / Toolbar */}
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={15} className="text-amber-400 shrink-0" />
            <span className="font-mono text-xs font-semibold text-zinc-100 truncate">{bill.file_name}</span>
            <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 border border-zinc-700">1 / 1</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(50, z - 15))}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
              title="Zoom out"
            >
              <ZoomOut size={14} />
            </button>
            <span className="text-[11px] font-mono text-zinc-400">{zoom}%</span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(200, z + 15))}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
              title="Zoom in"
            >
              <ZoomIn size={14} />
            </button>

            {fileUrl && (
              <button
                type="button"
                onClick={handleOpenInNewTab}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-emerald-400 ml-1 cursor-pointer"
                title="Open document in new tab"
              >
                <ExternalLink size={14} />
              </button>
            )}

            <button
              type="button"
              onClick={onRescan}
              disabled={isScanning}
              className="rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 ml-1 disabled:opacity-50 cursor-pointer"
              title="Re-run AI extraction"
            >
              <Sparkles size={12} /> {isScanning ? 'Scanning...' : 'Re-scan'}
            </button>

            <button
              type="button"
              onClick={onDelete}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400 ml-1 cursor-pointer"
              title="Delete bill"
            >
              <Trash2 size={14} />
            </button>

            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 ml-2 border-l border-zinc-700 pl-2 cursor-pointer"
              title="Close detailing"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Viewer Content */}
        <div className="flex h-[450px] w-full items-start justify-center overflow-auto bg-zinc-900/60 p-4">
          {fileUrl ? (
            isPdf ? (
              <div
                style={{
                  width: `${Math.max(100, zoom)}%`,
                  height: `${Math.max(420, Math.round((420 * zoom) / 100))}px`,
                  minWidth: '100%',
                }}
                className="transition-all duration-150 h-full w-full"
              >
                <iframe
                  src={fileUrl}
                  className="h-full w-full rounded-lg border border-zinc-800 bg-white"
                  title="Bill preview"
                />
              </div>
            ) : (
              <div
                style={{
                  width: `${zoom}%`,
                  minWidth: '50%',
                  maxWidth: 'none',
                }}
                className="transition-all duration-150 flex items-center justify-center"
              >
                <img
                  src={fileUrl}
                  alt="Bill document"
                  className="max-h-none w-full rounded-lg object-contain"
                />
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center text-zinc-500 text-xs">
              <div className="mb-2">
                <Spinner size={20} />
              </div>
              Loading document preview...
            </div>
          )}
        </div>
      </div>

      {/* 2. EXTRACTION STATUS PILL BAR */}
      <div
        className={`rounded-xl border px-4 py-3 flex items-center justify-between text-xs ${
          isScanning
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-200 animate-pulse'
            : isAlreadyProcessed
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
            : 'border-sky-500/20 bg-sky-500/10 text-sky-200'
        }`}
      >
        <div className="flex items-center gap-2">
          {isAlreadyProcessed ? (
            <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
          ) : (
            <Sparkles size={15} className={isScanning ? 'text-amber-400 animate-spin' : 'text-sky-400 shrink-0'} />
          )}
          {isScanning ? (
            <span>
              <strong className="text-white">Scanning document:</strong> Fast OCR &amp; parser extracting vendor, lines, and GST...
            </span>
          ) : (
            <span>
              <strong className="text-white">Extracted from bill:</strong> {vendorName || 'Supplier'}{' '}
              <span className="text-amber-400 font-medium">
                ({selectedVendorOption === '__new__' ? 'new vendor will be created' : 'matched existing vendor'})
              </span>{' '}
              &bull; Bill# <span className="font-mono font-semibold">{billNumber || '—'}</span> &bull; Total{' '}
              <span className="font-bold text-emerald-400">
                ₹{amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>{' '}
              &bull; {lineItems.length} line(s)
            </span>
          )}
        </div>
        <div className="hidden sm:block text-[11px] text-zinc-300 font-mono">
          Taxable: ₹{subtotal.toLocaleString('en-IN')} | GST: ₹{taxAmount.toLocaleString('en-IN')}
        </div>
      </div>

      {/* Discrepancy warning banner */}
      {hasDiscrepancy && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300 flex items-center gap-2">
          <AlertTriangle size={15} className="shrink-0 text-amber-400" />
          <span>
            Line amounts add up to <strong className="font-mono">₹{linesSum.toLocaleString('en-IN')}</strong> but bill subtotal is{' '}
            <strong className="font-mono">₹{subtotal.toLocaleString('en-IN')}</strong> — please verify lines below.
          </span>
        </div>
      )}

      {/* 3. VENDOR & BILL DETAILS CARD */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3.5">
        <div className="text-xs font-bold uppercase tracking-wider text-zinc-400">
          Vendor &amp; Bill Details
        </div>

        {/* Row 1: Vendor, Bill No, Bill Date */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Vendor *
            </label>
            <select
              value={selectedVendorOption}
              onChange={(e) => handleVendorSelect(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-xs font-medium text-zinc-100 focus:border-amber-500 focus:outline-none"
            >
              <option value="__new__">{vendorName ? `${vendorName} (new vendor)` : '— Register as New Vendor —'}</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Bill / Invoice No. *
            </label>
            <input
              type="text"
              value={billNumber}
              onChange={(e) => setBillNumber(e.target.value)}
              placeholder="e.g. 465 or 2108/26-27"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Bill Date
            </label>
            <input
              type="date"
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Row 2: Vendor profile fields */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 border-t border-zinc-800/80 pt-3">
          <div className="sm:col-span-1">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              New Vendor Name
            </label>
            <input
              type="text"
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              placeholder="Vendor name"
              className="w-full rounded-lg border border-zinc-700/80 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="sm:col-span-1">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              GSTIN
            </label>
            <input
              type="text"
              value={gstNumber}
              onChange={(e) => setGstNumber(e.target.value)}
              placeholder="GST Number"
              className="w-full rounded-lg border border-zinc-700/80 bg-zinc-800/50 px-2.5 py-1.5 text-xs font-mono text-zinc-200 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="sm:col-span-1">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Phone
            </label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone"
              className="w-full rounded-lg border border-zinc-700/80 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="sm:col-span-1">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Address
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Address"
              className="w-full rounded-lg border border-zinc-700/80 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="sm:col-span-1">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Credit Days
            </label>
            <input
              type="number"
              min={0}
              value={creditDays}
              onChange={(e) => setCreditDays(Number(e.target.value))}
              placeholder="30"
              className="w-full rounded-lg border border-zinc-700/80 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none text-right font-mono"
            />
          </div>
        </div>
      </div>

      {/* 4. ITEMS RECEIVED CARD */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
          <div className="flex items-center gap-2">
            <Package size={16} className="text-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
              Items Received ({lineItems.length})
            </h3>
          </div>
          <button
            onClick={handleAddLine}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors"
          >
            <Plus size={13} /> Add line
          </button>
        </div>

        {lineItems.length === 0 ? (
          <div className="py-8 text-center text-xs text-zinc-500">
            No items extracted.{' '}
            <button onClick={handleAddLine} className="text-amber-400 hover:underline">
              Click to add an item manually
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {lineItems.map((it, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-3.5 space-y-2.5 transition-colors hover:border-zinc-700"
              >
                {/* Top OCR chip */}
                <div className="flex items-center justify-between text-[11px] font-mono text-cyan-400">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shrink-0" />
                    <span className="truncate">
                      OCR: {it.raw_ocr || `${idx + 1} | ${it.name} - ${it.qty} ${it.unit} - ₹${it.amount}`}
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-500 font-sans shrink-0">Line #{idx + 1}</span>
                </div>

                {/* Main Row: Item Selection & Numbers */}
                <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-12 lg:items-center">
                  {/* Item Matcher Dropdown */}
                  <div className="lg:col-span-5">
                    <select
                      value={it.matched_item_id || '__new__'}
                      onChange={(e) => handleItemFieldChange(idx, 'matched_item_id', e.target.value)}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 focus:border-amber-500 focus:outline-none"
                    >
                      <option value="__new__">{it.name} (new item)</option>
                      {items.map((ex) => (
                        <option key={ex.id} value={ex.id}>
                          {ex.name} ({ex.unit})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Quantity */}
                  <div className="flex items-center gap-2 lg:col-span-2">
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider lg:hidden">Qty:</label>
                    <input
                      type="number"
                      step="any"
                      value={it.qty}
                      onChange={(e) => handleItemFieldChange(idx, 'qty', e.target.value)}
                      placeholder="Qty"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-right font-mono text-zinc-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  {/* Unit */}
                  <div className="flex items-center gap-2 lg:col-span-1">
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider lg:hidden">Unit:</label>
                    <input
                      type="text"
                      value={it.unit || 'pc'}
                      onChange={(e) => handleItemFieldChange(idx, 'unit', e.target.value)}
                      placeholder="Unit"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-center font-mono text-zinc-300 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  {/* Rate */}
                  <div className="flex items-center gap-2 lg:col-span-2">
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider lg:hidden">Rate:</label>
                    <input
                      type="number"
                      step="0.01"
                      value={it.rate}
                      onChange={(e) => handleItemFieldChange(idx, 'rate', e.target.value)}
                      placeholder="Rate"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-right font-mono text-zinc-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  {/* Amount & Delete Button */}
                  <div className="flex items-center justify-between lg:col-span-2 lg:justify-end gap-3">
                    <div className="font-mono text-xs font-bold text-zinc-100">
                      ₹{it.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </div>
                    <button
                      onClick={() => handleDeleteLine(idx)}
                      className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400 transition-colors"
                      title="Delete line item"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Sub-inputs for item catalog details */}
                {it.matched_item_id === '__new__' && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-2 text-xs">
                    <div className="sm:col-span-2">
                      <input
                        type="text"
                        value={it.name}
                        onChange={(e) => handleItemFieldChange(idx, 'name', e.target.value)}
                        placeholder="Catalog Item Name"
                        className="w-full rounded bg-zinc-800/80 border border-zinc-700/60 px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        value={it.sku || ''}
                        onChange={(e) => handleItemFieldChange(idx, 'sku', e.target.value)}
                        placeholder="Code / SKU"
                        className="w-full rounded bg-zinc-800/80 border border-zinc-700/60 px-2 py-1 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <select
                        value={it.category_id || ''}
                        onChange={(e) => handleItemFieldChange(idx, 'category_id', e.target.value)}
                        className="w-full rounded bg-zinc-800/80 border border-zinc-700/60 px-2 py-1 text-[11px] text-zinc-300 focus:outline-none"
                      >
                        <option value="">Category: Other</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <input
                        type="number"
                        min={0}
                        value={it.reorder_level ?? 10}
                        onChange={(e) => handleItemFieldChange(idx, 'reorder_level', Number(e.target.value))}
                        placeholder="Min Stock"
                        className="w-full rounded bg-zinc-800/80 border border-zinc-700/60 px-2 py-1 text-[11px] text-zinc-200 text-right focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 5. BOTTOM SPLIT GRID */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Left Column: Payment Due Date, Checkbox, Notes */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-4">
          <div className="text-xs font-bold uppercase tracking-wider text-zinc-400">
            Payment &amp; Terms
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Payment Due Date
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none font-mono"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Auto: {dueDate ? new Date(dueDate).toLocaleDateString('en-IN') : '—'} ({creditDays} days credit)
            </p>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-zinc-300">
            <input
              type="checkbox"
              checked={addToPayments}
              onChange={(e) => setAddToPayments(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 text-amber-500 focus:ring-amber-500"
            />
            <span>Add to payment reminders</span>
          </label>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Notes
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="PO no., vehicle no., remarks..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/80 p-2.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Right Column: Financials & Confirm/Post CTA */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 flex flex-col justify-between">
          <div className="space-y-2.5">
            <div className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Receipt size={14} className="text-amber-400" />
              Bill Financials &amp; Taxes
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-2.5 text-xs">
              <div className="flex items-center justify-between text-zinc-400">
                <span className="font-medium">Subtotal (taxable)</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-500 font-mono">₹</span>
                  <input
                    type="number"
                    step="0.01"
                    value={subtotal}
                    onChange={(e) => {
                      const newSub = parseFloat(e.target.value) || 0;
                      setSubtotal(newSub);
                      setAmount(Math.round((newSub + taxAmount + rounding) * 100) / 100);
                    }}
                    className="w-28 rounded bg-zinc-900 border border-zinc-700/80 px-2.5 py-1 text-zinc-100 font-mono text-right text-xs focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-zinc-400">
                <span className="font-medium flex items-center gap-1">
                  <span>GST amount</span>
                  <span className="text-[10px] text-zinc-500 font-mono">(CGST+SGST+IGST)</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-amber-500 font-mono font-semibold">₹</span>
                  <input
                    type="number"
                    step="0.01"
                    value={taxAmount}
                    onChange={(e) => {
                      const newTax = parseFloat(e.target.value) || 0;
                      setTaxAmount(newTax);
                      if (igst === 0) {
                        const half = Math.round((newTax / 2) * 100) / 100;
                        setCgst(half);
                        setSgst(half);
                      } else {
                        setIgst(newTax);
                      }
                      setAmount(Math.round((subtotal + newTax + rounding) * 100) / 100);
                    }}
                    className="w-28 rounded bg-zinc-900 border border-zinc-700/80 px-2.5 py-1 text-amber-400 font-mono text-right text-xs font-bold focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {/* Editable GST breakdown */}
              <div className="grid grid-cols-3 gap-2 pt-1 border-t border-zinc-800/60 text-[11px]">
                <div>
                  <span className="text-[10px] text-zinc-500 block">CGST (₹)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={cgst}
                    onChange={(e) => {
                      const c = parseFloat(e.target.value) || 0;
                      setCgst(c);
                      let s = sgst;
                      if (igst === 0) {
                        s = c;
                        setSgst(c);
                      }
                      const t = Math.round((c + s + igst) * 100) / 100;
                      setTaxAmount(t);
                      setAmount(Math.round((subtotal + t + rounding) * 100) / 100);
                    }}
                    className="w-full rounded bg-zinc-900 border border-zinc-700/80 px-2 py-0.5 text-zinc-300 font-mono text-right focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 block">SGST (₹)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={sgst}
                    onChange={(e) => {
                      const s = parseFloat(e.target.value) || 0;
                      setSgst(s);
                      let c = cgst;
                      if (igst === 0) {
                        c = s;
                        setCgst(s);
                      }
                      const t = Math.round((c + s + igst) * 100) / 100;
                      setTaxAmount(t);
                      setAmount(Math.round((subtotal + t + rounding) * 100) / 100);
                    }}
                    className="w-full rounded bg-zinc-900 border border-zinc-700/80 px-2 py-0.5 text-zinc-300 font-mono text-right focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 block">IGST (₹)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={igst}
                    onChange={(e) => {
                      const i = parseFloat(e.target.value) || 0;
                      setIgst(i);
                      const t = Math.round((cgst + sgst + i) * 100) / 100;
                      setTaxAmount(t);
                      setAmount(Math.round((subtotal + t + rounding) * 100) / 100);
                    }}
                    className="w-full rounded bg-zinc-900 border border-zinc-700/80 px-2 py-0.5 text-zinc-300 font-mono text-right focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-zinc-400 pt-1">
                <span>Freight / round-off / other</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-500 font-mono">₹</span>
                  <input
                    type="number"
                    step="0.01"
                    value={rounding}
                    onChange={(e) => {
                      const r = parseFloat(e.target.value) || 0;
                      setRounding(r);
                      setAmount(Math.round((subtotal + taxAmount + r) * 100) / 100);
                    }}
                    placeholder="0.00"
                    className="w-28 rounded bg-zinc-900 border border-zinc-700/80 px-2.5 py-1 text-zinc-200 font-mono text-right text-xs focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-zinc-300 font-medium pt-1.5 border-t border-zinc-800">
                <span>Bill total (Subtotal + GST + Rounding)</span>
                <span className="font-mono text-zinc-100 font-bold">
                  ₹{amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {hasDiscrepancy && (
              <div className="flex items-center justify-between text-[11px] text-amber-400 font-medium pt-1">
                <span>Calculated lines: ₹{linesSum.toLocaleString('en-IN')}</span>
                <button
                  type="button"
                  onClick={() => {
                    setSubtotal(linesSum);
                    setAmount(Math.round((linesSum + taxAmount + rounding) * 100) / 100);
                  }}
                  className="text-amber-300 underline hover:text-amber-200 text-[10px]"
                >
                  Sync subtotal from lines
                </button>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-zinc-800 mt-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <div>
                <span className="text-xs uppercase tracking-wider text-zinc-400 font-semibold block">
                  Grand Total
                </span>
                <span className="text-[11px] font-mono text-zinc-500">
                  ₹{subtotal.toFixed(2)} + ₹{taxAmount.toFixed(2)}{rounding !== 0 ? ` ${rounding >= 0 ? '+' : '-'} ₹${Math.abs(rounding).toFixed(2)}` : ''}
                </span>
              </div>
              <span className="text-2xl font-extrabold text-amber-400 font-mono">
                ₹{amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>

            {isAlreadyProcessed ? (
              <div className="space-y-2">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
                  <span className="text-emerald-400 font-bold text-sm flex items-center justify-center gap-2">
                    <CheckCircle2 size={18} /> Entry Already Posted to Inventory
                  </span>
                  <p className="text-xs text-zinc-400 mt-1">
                    Stock movements and payment obligations have already been recorded.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={handleUpdateDetailsOnly}
                    disabled={posting}
                    className="flex-1 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Save size={14} /> Update Details Only
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfirmAndPost(false)}
                    disabled={posting}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 font-bold text-xs shadow-md shadow-amber-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    title="Re-post line items to stock movements"
                  >
                    {posting ? <Spinner size={14} /> : <CheckCircle2 size={15} />}
                    {posting ? 'Posting...' : 'Re-Post to Stock'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleConfirmAndPost(false)}
                disabled={posting}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 font-bold text-sm shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
              >
                {posting ? (
                  <>
                    <Spinner size={16} /> Posting to Inventory...
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={18} /> Confirm &amp; Post Entry
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DuplicateWarningModal({
  warningState,
  onClose,
  onViewExisting,
  onDiscard,
  onProceedAnyway,
}: {
  warningState: DuplicateWarningState | null;
  onClose: () => void;
  onViewExisting: (existingId: string) => void;
  onDiscard: () => void;
  onProceedAnyway: () => void;
}) {
  if (!warningState) return null;
  const { conflict, currentFileName, isPostingAttempt } = warningState;

  return (
    <Modal
      open={true}
      title="⚠️ Double Entry Detected"
      onClose={onClose}
      size="md"
    >
      <div className="space-y-4">
        {/* Warning Banner */}
        <div className="rounded-xl border border-amber-500/50 bg-amber-500/15 p-4 text-amber-200">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-amber-500/20 p-2 text-amber-400 shrink-0 mt-0.5">
              <AlertTriangle size={22} />
            </div>
            <div>
              <h4 className="text-sm font-bold text-amber-300">
                Warning: Duplicate Invoice Detected
              </h4>
              <p className="mt-1 text-xs text-amber-200/90 leading-relaxed">
                An entry with <strong>Invoice #{conflict.billNumber}</strong> from{' '}
                <strong>Vendor "{conflict.vendorName}"</strong> already exists in your records.
                {isPostingAttempt
                  ? ' Posting this entry will add duplicate stock quantities to inventory and duplicate payable balances!'
                  : ' Uploading this bill will result in a double entry in your database.'}
              </p>
            </div>
          </div>
        </div>

        {/* Existing Record Details Card */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3.5 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-400 uppercase tracking-wider text-[10px]">
              Existing Record in System
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                conflict.existingStatus === 'processed' || conflict.existingStatus === 'inward_received'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}
            >
              {conflict.existingStatus === 'processed'
                ? 'Posted'
                : conflict.existingStatus === 'inward_received'
                ? 'Received into Stock'
                : 'Pending'}
            </span>
          </div>

          <div className="space-y-1.5 text-zinc-300">
            {conflict.existingFileName && (
              <div className="flex justify-between text-zinc-400">
                <span>File Name:</span>
                <span className="font-mono text-zinc-100 font-semibold truncate max-w-[200px]">
                  {conflict.existingFileName}
                </span>
              </div>
            )}
            <div className="flex justify-between text-zinc-400">
              <span>Vendor:</span>
              <span className="text-zinc-200 font-medium">{conflict.vendorName}</span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>Invoice #:</span>
              <span className="font-mono text-zinc-100 font-bold">{conflict.billNumber}</span>
            </div>
            {conflict.existingAmount !== undefined && conflict.existingAmount > 0 && (
              <div className="flex justify-between text-zinc-400">
                <span>Total Amount:</span>
                <span className="font-mono font-bold text-emerald-400">
                  ₹{conflict.existingAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}
            {conflict.existingDate && (
              <div className="flex justify-between text-zinc-500 text-[10px] pt-1 border-t border-zinc-800">
                <span>Date:</span>
                <span>{new Date(conflict.existingDate).toLocaleDateString('en-IN')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Current Document being processed */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs flex items-center justify-between">
          <div className="truncate">
            <span className="text-zinc-500">Attempted Entry:</span>{' '}
            <span className="font-mono text-zinc-200 font-semibold">{currentFileName}</span>
          </div>
          <span className="text-[11px] font-medium text-amber-400 shrink-0 ml-2">Duplicate Entry</span>
        </div>

        {/* Action Buttons */}
        <div className="pt-3 border-t border-zinc-800 flex flex-col sm:flex-row items-center justify-end gap-2.5">
          <button
            onClick={onDiscard}
            className="w-full sm:w-auto px-4 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Trash2 size={14} /> Discard / Cancel
          </button>
          {conflict.type === 'bill' && conflict.existingId && (
            <button
              type="button"
              onClick={() => onViewExisting(conflict.existingId)}
              className="w-full sm:w-auto px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <ExternalLink size={14} /> View Existing Bill
            </button>
          )}
          <button
            onClick={onProceedAnyway}
            className="w-full sm:w-auto px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
          >
            {isPostingAttempt ? 'Force Post Anyway' : 'Force Upload Anyway'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
