import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Item, StockMovement, Vendor } from '@/lib/types';
import { Button, TextField, SelectField, TextAreaField } from '@/components/Field';
import { Badge, EmptyState, PageHeader, Spinner, toast } from '@/components/ui';
import { Modal } from '@/components/Modal';
import { findDuplicateInMovements, DuplicateConflict } from '@/lib/duplicateChecker';
import { ArrowDownToLine, Plus, Search, Trash2, X, AlertTriangle } from 'lucide-react';

export function MaterialEntryPage() {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // form state
  const [itemId, setItemId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [rate, setRate] = useState('');
  const [billNumber, setBillNumber] = useState('');
  const [movementDate, setMovementDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateConflict | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [m, i, v] = await Promise.all([
      supabase.from('stock_movements').select('*, item:item_id(name, unit), vendor:vendor_id(name)').eq('type', 'in').order('movement_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('items').select('*').order('name'),
      supabase.from('vendors').select('*').order('name'),
    ]);
    setMovements((m.data as StockMovement[] | null) ?? []);
    setItems((i.data as Item[] | null) ?? []);
    setVendors((v.data as Vendor[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = movements.filter((m) =>
    !search ||
    m.item?.name?.toLowerCase().includes(search.toLowerCase()) ||
    m.vendor?.name?.toLowerCase().includes(search.toLowerCase()) ||
    (m.bill_number ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const submit = async (e?: React.FormEvent, force = false) => {
    if (e) e.preventDefault();
    if (!itemId) { setError('Select an item'); return; }

    // Check for double entry if bill number is provided
    if (billNumber.trim() && !force) {
      const conflict = findDuplicateInMovements(
        billNumber,
        null,
        vendorId || null,
        movements,
        vendors
      );
      if (conflict) {
        setDuplicateWarning(conflict);
        return;
      }
    }

    setSaving(true);
    setError('');
    const res = await supabase.from('stock_movements').insert({
      item_id: itemId,
      type: 'in',
      quantity: Number(quantity),
      vendor_id: vendorId || null,
      rate: rate ? Number(rate) : null,
      bill_number: billNumber || null,
      movement_date: movementDate,
      notes: notes || null,
    });
    if (res.error) { setError(res.error.message); setSaving(false); return; }
    if (vendorId && rate) {
      await supabase.from('vendor_items').upsert({ vendor_id: vendorId, item_id: itemId, last_rate: Number(rate) }, { onConflict: 'vendor_id,item_id' });
    }
    const itemName = items.find((i) => i.id === itemId)?.name || 'Item';
    toast.success(`${quantity} unit(s) of ${itemName} received`);
    setItemId(''); setVendorId(''); setQuantity(1); setRate(''); setBillNumber(''); setNotes('');
    setDuplicateWarning(null);
    setSaving(false);
    load();
  };

  const deleteReceipt = async (m: StockMovement) => {
    try {
      await supabase.from('stock_movements').delete().eq('id', m.id);
      toast.success('Material receipt entry deleted');
      load();
    } catch (err) {
      toast.error('Failed to delete receipt: ' + (err as Error).message);
    }
  };

  return (
    <div>
      <PageHeader title="Material Entry" subtitle="Record materials received from vendors" />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Form */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <div className="mb-4 flex items-center justify-between text-sm font-semibold text-zinc-200">
              <span className="flex items-center gap-2">
                <ArrowDownToLine size={16} className="text-emerald-400" /> New Receipt
              </span>
              {(itemId || vendorId || billNumber || notes || rate) && (
                <button
                  type="button"
                  onClick={() => {
                    setItemId('');
                    setVendorId('');
                    setQuantity(1);
                    setRate('');
                    setBillNumber('');
                    setNotes('');
                  }}
                  className="text-xs text-zinc-500 hover:text-red-400 flex items-center gap-1 transition-colors"
                  title="Clear all fields"
                >
                  <Trash2 size={12} /> Clear form
                </button>
              )}
            </div>
            <form onSubmit={(e) => submit(e, false)} className="space-y-3">
              <SelectField label="Item *" value={itemId} onChange={(e) => setItemId(e.target.value)} required>
                <option value="">Select item...</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
              </SelectField>
              <SelectField label="Vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">Select vendor...</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </SelectField>
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Quantity *" type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} required />
                <TextField label="Rate / unit" type="number" step="0.01" min={0} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.00" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Bill Number" value={billNumber} onChange={(e) => setBillNumber(e.target.value)} placeholder="Inv #" />
                <TextField label="Date" type="date" value={movementDate} onChange={(e) => setMovementDate(e.target.value)} />
              </div>
              <TextAreaField label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              {error && <p className="text-sm text-red-400">{error}</p>}
              <Button type="submit" disabled={saving} className="w-full"><Plus size={16} /> {saving ? 'Recording...' : 'Record Receipt'}</Button>
            </form>
          </div>
        </div>

        {/* History */}
        <div className="lg:col-span-2">
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search receipts..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 py-2 pl-9 pr-8 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {loading ? (
            <div className="flex justify-center py-20"><Spinner /></div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={<ArrowDownToLine size={36} />} title="No receipts recorded" subtitle="Use the form to record material received from vendors" />
          ) : (
            <div className="overflow-hidden rounded-xl border border-zinc-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Item</th>
                    <th className="px-4 py-3 font-medium">Vendor</th>
                    <th className="px-4 py-3 font-medium">Bill</th>
                    <th className="px-4 py-3 font-medium">Qty</th>
                    <th className="px-4 py-3 font-medium">Rate</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {filtered.map((m) => (
                    <tr key={m.id} className="bg-zinc-900/20 hover:bg-zinc-900/50">
                      <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">{new Date(m.movement_date).toLocaleDateString('en-IN')}</td>
                      <td className="px-4 py-3 font-medium text-zinc-100">{m.item?.name}</td>
                      <td className="px-4 py-3 text-zinc-400">{m.vendor?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-zinc-400">{m.bill_number ?? '—'}</td>
                      <td className="px-4 py-3"><Badge color="emerald">+{m.quantity}</Badge></td>
                      <td className="px-4 py-3 text-zinc-400">{m.rate ? `₹${Number(m.rate).toFixed(2)}` : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => deleteReceipt(m)}
                          className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-red-400 transition-colors"
                          title="Delete receipt record"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Double Entry Warning Modal */}
      {duplicateWarning && (
        <Modal
          open={true}
          title="⚠️ Double Entry Warning"
          onClose={() => setDuplicateWarning(null)}
          size="sm"
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-200">
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={20} className="text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-amber-300">Duplicate Bill Receipt Detected</h4>
                  <p className="mt-1 leading-relaxed">
                    A material receipt with Bill Number <strong>#{duplicateWarning.billNumber}</strong> from{' '}
                    <strong>{duplicateWarning.vendorName}</strong> has already been recorded on{' '}
                    {duplicateWarning.existingDate ? new Date(duplicateWarning.existingDate).toLocaleDateString('en-IN') : 'earlier'}.
                  </p>
                  <p className="mt-1.5 text-amber-300 font-medium">
                    Recording this entry again will increase your inventory stock count twice for the same invoice.
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-zinc-800 flex items-center justify-end gap-2.5">
              <Button variant="secondary" onClick={() => setDuplicateWarning(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setDuplicateWarning(null);
                  submit(undefined, true);
                }}
              >
                Record Anyway
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
