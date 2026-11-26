import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Category, Item, LiveStockRow } from '@/lib/types';
import { Modal } from '@/components/Modal';
import { Button, TextField, SelectField, TextAreaField } from '@/components/Field';
import { Badge, EmptyState, PageHeader, Spinner, toast } from '@/components/ui';
import { Package, Plus, Pencil, Search, Trash2, X } from 'lucide-react';

export function ItemsPage() {
  const [items, setItems] = useState<(Item & { stock?: number; is_low_stock?: boolean; category?: Category })[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [editing, setEditing] = useState<Item | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [i, s, c] = await Promise.all([
      supabase.from('items').select('*, category:category_id(*)').order('name'),
      supabase.from('live_stock').select('*'),
      supabase.from('categories').select('*').order('name'),
    ]);
    const stockMap = new Map<string, { stock: number; is_low_stock: boolean }>();
    (s.data as LiveStockRow[] | null)?.forEach((r) => stockMap.set(r.id, { stock: r.stock, is_low_stock: r.is_low_stock }));
    setItems((i.data as Item[] | null)?.map((it) => ({ ...it, stock: stockMap.get(it.id)?.stock, is_low_stock: stockMap.get(it.id)?.is_low_stock })) ?? []);
    setCategories((c.data as Category[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = items.filter((it) => {
    const matchSearch = !search || it.name.toLowerCase().includes(search.toLowerCase()) || (it.part_number ?? '').toLowerCase().includes(search.toLowerCase());
    const matchCat = catFilter === 'all' || it.category_id === catFilter;
    return matchSearch && matchCat;
  });

  const deleteItem = async (id: string) => {
    try {
      await supabase.from('items').delete().eq('id', id);
      toast.success('Item deleted');
      load();
    } catch (err) {
      toast.error('Failed to delete item: ' + (err as Error).message);
    }
  };

  return (
    <div>
      <PageHeader
        title="Items"
        subtitle="Add and manage materials you stock in the factory"
        action={<Button onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={16} /> Add Item</Button>}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or part number..."
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
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
        >
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Package size={36} />} title="No items yet" subtitle="Add your first material to start tracking stock" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-[580px] text-left text-sm">
            <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Part #</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Unit</th>
                <th className="px-4 py-3 font-medium">Reorder</th>
                <th className="px-4 py-3 font-medium">Stock</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filtered.map((it) => (
                <tr key={it.id} className="bg-zinc-900/20 transition-colors hover:bg-zinc-900/50">
                  <td className="px-4 py-3 font-medium text-zinc-100">{it.name}</td>
                  <td className="px-4 py-3 text-zinc-400">{it.part_number || '—'}</td>
                  <td className="px-4 py-3 text-zinc-400">{it.category?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-zinc-400">{it.unit}</td>
                  <td className="px-4 py-3 text-zinc-400">{it.reorder_level}</td>
                  <td className="px-4 py-3">
                    {it.stock !== undefined ? (
                      <Badge color={it.is_low_stock ? 'red' : it.stock <= it.reorder_level * 1.5 ? 'amber' : 'emerald'}>
                        {it.stock} {it.unit}
                      </Badge>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => { setEditing(it); setShowForm(true); }} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-emerald-400" title="Edit"><Pencil size={15} /></button>
                      <button onClick={() => deleteItem(it.id)} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-red-400" title="Delete"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <ItemForm
          item={editing}
          categories={categories}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); toast.success(editing ? 'Item updated' : 'Item added'); load(); }}
          onDelete={(id) => deleteItem(id)}
        />
      )}
    </div>
  );
}

function ItemForm({
  item,
  categories,
  onClose,
  onSaved,
  onDelete,
}: {
  item: Item | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [partNumber, setPartNumber] = useState(item?.part_number ?? '');
  const [unit, setUnit] = useState(item?.unit ?? 'pcs');
  const [categoryId, setCategoryId] = useState(item?.category_id ?? '');
  const [reorderLevel, setReorderLevel] = useState<number | string>(item?.reorder_level ?? 0);
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const payload = {
      name,
      part_number: partNumber || null,
      unit,
      category_id: categoryId || null,
      reorder_level: Number(reorderLevel) || 0,
      notes: notes || null,
    };
    const res = item
      ? await supabase.from('items').update(payload).eq('id', item.id)
      : await supabase.from('items').insert(payload);
    if (res.error) setError(res.error.message);
    else onSaved();
    setSaving(false);
  };

  return (
    <Modal open title={item ? 'Edit Item' : 'Add Item'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <TextField label="Name *" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. M8 Hex Bolt" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <TextField label="Part Number" value={partNumber} onChange={(e) => setPartNumber(e.target.value)} placeholder="SKU / code" />
          <TextField label="Unit *" value={unit} onChange={(e) => setUnit(e.target.value)} required placeholder="pcs, kg, m, box" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <SelectField label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— None —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectField>
          <TextField label="Reorder Level" type="number" min={0} value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} />
        </div>
        <TextAreaField label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
          {item ? (
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                onClose();
                onDelete(item.id);
              }}
              title="Delete this item"
              className="w-full sm:w-auto cursor-pointer"
            >
              <Trash2 size={15} /> Delete Item
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2 w-full sm:w-auto">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1 sm:flex-none cursor-pointer">Cancel</Button>
            <Button type="submit" disabled={saving} className="flex-1 sm:flex-none cursor-pointer">{saving ? 'Saving...' : item ? 'Save Changes' : 'Add Item'}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
