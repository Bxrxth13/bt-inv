import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { LiveStockRow, StockMovement } from '@/lib/types';
import { Button, TextField, SelectField, TextAreaField } from '@/components/Field';
import { Badge, EmptyState, PageHeader, Spinner, toast } from '@/components/ui';
import { ArrowUpFromLine, Plus, Search, Trash2, X } from 'lucide-react';

export function MaterialIssuePage() {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [stock, setStock] = useState<LiveStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [issuedTo, setIssuedTo] = useState('');
  const [movementDate, setMovementDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [m, s] = await Promise.all([
      supabase.from('stock_movements').select('*, item:item_id(name, unit)').eq('type', 'out').order('movement_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('live_stock').select('*').order('name'),
    ]);
    setMovements((m.data as StockMovement[] | null) ?? []);
    setStock((s.data as LiveStockRow[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = movements.filter((m) =>
    !search ||
    m.item?.name?.toLowerCase().includes(search.toLowerCase()) ||
    (m.issued_to ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const selectedItem = stock.find((s) => s.id === itemId);
  const maxQty = selectedItem?.stock ?? 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemId) { setError('Select an item'); return; }
    if (quantity > maxQty) { setError(`Only ${maxQty} in stock`); return; }
    if (!issuedTo.trim()) { setError('Enter who this is issued to'); return; }
    setSaving(true);
    setError('');
    const res = await supabase.from('stock_movements').insert({
      item_id: itemId,
      type: 'out',
      quantity: Number(quantity),
      issued_to: issuedTo.trim(),
      movement_date: movementDate,
      notes: notes || null,
    });
    if (res.error) { setError(res.error.message); setSaving(false); return; }
    const itemName = selectedItem?.name || 'Item';
    toast.success(`${quantity} unit(s) of ${itemName} issued to ${issuedTo.trim()}`);
    setItemId(''); setQuantity(1); setIssuedTo(''); setNotes('');
    setSaving(false);
    load();
  };

  const deleteIssue = async (m: StockMovement) => {
    try {
      await supabase.from('stock_movements').delete().eq('id', m.id);
      toast.success('Material issue deleted and stock restored');
      load();
    } catch (err) {
      toast.error('Failed to delete issue: ' + (err as Error).message);
    }
  };

  return (
    <div>
      <PageHeader title="Material Issue" subtitle="Record materials issued to staff or departments" />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <div className="mb-4 flex items-center justify-between text-sm font-semibold text-zinc-200">
              <span className="flex items-center gap-2">
                <ArrowUpFromLine size={16} className="text-amber-400" /> New Issue
              </span>
              {(itemId || issuedTo || notes) && (
                <button
                  type="button"
                  onClick={() => {
                    setItemId('');
                    setQuantity(1);
                    setIssuedTo('');
                    setNotes('');
                  }}
                  className="text-xs text-zinc-500 hover:text-red-400 flex items-center gap-1 transition-colors"
                  title="Clear all fields"
                >
                  <Trash2 size={12} /> Clear form
                </button>
              )}
            </div>
            <form onSubmit={submit} className="space-y-3">
              <SelectField label="Item *" value={itemId} onChange={(e) => setItemId(e.target.value)} required>
                <option value="">Select item...</option>
                {stock.map((s) => (
                  <option key={s.id} value={s.id} disabled={s.stock <= 0}>
                    {s.name} — {s.stock} {s.unit} {s.is_low_stock ? '(low)' : ''}
                  </option>
                ))}
              </SelectField>
              {selectedItem && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-800/40 px-3 py-2 text-xs text-zinc-400">
                  In stock: <span className="font-semibold text-zinc-200">{selectedItem.stock} {selectedItem.unit}</span>
                  {selectedItem.is_low_stock && <Badge color="amber">Low stock</Badge>}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextField label="Quantity *" type="number" min={1} max={maxQty || undefined} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} required />
                <TextField label="Date" type="date" value={movementDate} onChange={(e) => setMovementDate(e.target.value)} />
              </div>
              <TextField label="Issued To *" value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} required placeholder="Staff name / department" />
              <TextAreaField label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              {error && <p className="text-sm text-red-400">{error}</p>}
              <Button type="submit" disabled={saving} className="w-full cursor-pointer" variant="secondary"><Plus size={16} /> {saving ? 'Recording...' : 'Record Issue'}</Button>
            </form>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search issues..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 py-2 pl-9 pr-8 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200 cursor-pointer"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {loading ? (
            <div className="flex justify-center py-20"><Spinner /></div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={<ArrowUpFromLine size={36} />} title="No issues recorded" subtitle="Use the form to record material issued to staff" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-800">
              <table className="w-full min-w-[500px] text-left text-sm">
                <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Item</th>
                    <th className="px-4 py-3 font-medium">Issued To</th>
                    <th className="px-4 py-3 font-medium">Qty</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {filtered.map((m) => (
                    <tr key={m.id} className="bg-zinc-900/20 hover:bg-zinc-900/50">
                      <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">{new Date(m.movement_date).toLocaleDateString('en-IN')}</td>
                      <td className="px-4 py-3 font-medium text-zinc-100">{m.item?.name}</td>
                      <td className="px-4 py-3 text-zinc-400">{m.issued_to ?? '—'}</td>
                      <td className="px-4 py-3"><Badge color="amber">−{m.quantity}</Badge></td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => deleteIssue(m)}
                          className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-red-400 transition-colors"
                          title="Delete issue record"
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
    </div>
  );
}
