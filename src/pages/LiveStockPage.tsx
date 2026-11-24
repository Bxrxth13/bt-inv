import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Category, LiveStockRow } from '@/lib/types';
import { Badge, EmptyState, PageHeader, Spinner, toast } from '@/components/ui';
import { Boxes, Search, AlertTriangle, Trash2, X } from 'lucide-react';

export function LiveStockPage() {
  const [rows, setRows] = useState<LiveStockRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [showLowOnly, setShowLowOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, c] = await Promise.all([
      supabase.from('live_stock').select('*'),
      supabase.from('categories').select('*').order('name'),
    ]);
    setRows((s.data as LiveStockRow[] | null) ?? []);
    setCategories((c.data as Category[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? 'Uncategorized';

  const filtered = rows
    .filter((r) => {
      const ms = !search || r.name.toLowerCase().includes(search.toLowerCase()) || (r.part_number ?? '').toLowerCase().includes(search.toLowerCase());
      const mc = catFilter === 'all' || r.category_id === catFilter;
      const ml = !showLowOnly || r.is_low_stock;
      return ms && mc && ml;
    })
    .sort((a, b) => {
      if (a.is_low_stock && !b.is_low_stock) return -1;
      if (!a.is_low_stock && b.is_low_stock) return 1;
      if (a.is_low_stock && b.is_low_stock) return a.stock - b.stock;
      return a.name.localeCompare(b.name);
    });

  const lowCount = rows.filter((r) => r.is_low_stock).length;

  const deleteItem = async (id: string) => {
    try {
      await supabase.from('items').delete().eq('id', id);
      toast.success('Item deleted from inventory');
      load();
    } catch (err) {
      toast.error('Failed to delete item: ' + (err as Error).message);
    }
  };

  return (
    <div>
      <PageHeader title="Live Stock" subtitle={`${lowCount} low-stock item${lowCount !== 1 ? 's' : ''} shown first`} />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items..."
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
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none">
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button
          onClick={() => setShowLowOnly((v) => !v)}
          className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${showLowOnly ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30' : 'border border-zinc-700 bg-zinc-800/60 text-zinc-300 hover:bg-zinc-800'}`}
        >
          <AlertTriangle size={15} /> Low stock only
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Boxes size={36} />} title="No stock data" subtitle="Add items and record material entries to see live stock" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium">Part #</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Stock</th>
                <th className="px-4 py-3 font-medium">Reorder Level</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filtered.map((r) => (
                <tr key={r.id} className={`transition-colors hover:bg-zinc-900/50 ${r.is_low_stock ? 'bg-amber-500/[0.04]' : 'bg-zinc-900/20'}`}>
                  <td className="px-4 py-3">
                    {r.is_low_stock ? <Badge color="red"><AlertTriangle size={11} /> Low</Badge> : <Badge color="emerald">OK</Badge>}
                  </td>
                  <td className="px-4 py-3 font-medium text-zinc-100">{r.name}</td>
                  <td className="px-4 py-3 text-zinc-400">{r.part_number || '—'}</td>
                  <td className="px-4 py-3 text-zinc-400">{catName(r.category_id)}</td>
                  <td className="px-4 py-3">
                    <span className={`font-semibold ${r.is_low_stock ? 'text-amber-400' : 'text-zinc-100'}`}>{r.stock}</span>
                    <span className="ml-1 text-xs text-zinc-500">{r.unit}</span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{r.reorder_level} {r.unit}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => deleteItem(r.id)}
                      className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-red-400 transition-colors"
                      title="Delete item from inventory"
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
  );
}
