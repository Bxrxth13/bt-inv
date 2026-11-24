import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { LiveStockRow, Payment, StockMovement, PageKey } from '@/lib/types';
import { Spinner, Badge, PageHeader } from '@/components/ui';
import {
  Boxes,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Wallet,
  TrendingUp,
  TrendingDown,
  Clock,
} from 'lucide-react';

export function Dashboard({ onNavigate }: { onNavigate: (k: PageKey) => void }) {
  const [loading, setLoading] = useState(true);
  const [stock, setStock] = useState<LiveStockRow[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [recent, setRecent] = useState<StockMovement[]>([]);

  useEffect(() => {
    (async () => {
      const [s, p, r] = await Promise.all([
        supabase.from('live_stock').select('*'),
        supabase.from('payments').select('*, vendor:vendor_id(name)').eq('paid', false).order('due_date', { ascending: true }),
        supabase
          .from('stock_movements')
          .select('*, item:item_id(name, unit), vendor:vendor_id(name)')
          .order('created_at', { ascending: false })
          .limit(8),
      ]);
      if (s.data) setStock(s.data as LiveStockRow[]);
      if (p.data) setPayments(p.data as Payment[]);
      if (r.data) setRecent(r.data as StockMovement[]);
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  const totalItems = stock.length;
  const lowStock = stock.filter((s) => s.is_low_stock);
  const totalStockUnits = stock.reduce((sum, s) => sum + s.stock, 0);
  const overdue = payments.filter((p) => new Date(p.due_date) < new Date(new Date().toDateString()));
  const upcoming = payments.filter((p) => new Date(p.due_date) >= new Date(new Date().toDateString()));
  const totalDue = payments.reduce((sum, p) => sum + Number(p.amount), 0);

  const recentIn = recent.filter((r) => r.type === 'in').reduce((s, r) => s + r.quantity, 0);
  const recentOut = recent.filter((r) => r.type === 'out').reduce((s, r) => s + r.quantity, 0);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Overview of your factory inventory at a glance" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={<Boxes size={18} />} label="Total Items" value={totalItems} hint={`${totalStockUnits} units in stock`} accent="emerald" onClick={() => onNavigate('live-stock')} />
        <StatCard icon={<AlertTriangle size={18} />} label="Low Stock" value={lowStock.length} hint={lowStock.length ? 'Needs attention' : 'All healthy'} accent="amber" onClick={() => onNavigate('live-stock')} />
        <StatCard icon={<Wallet size={18} />} label="Payments Due" value={payments.length} hint={`₹${totalDue.toLocaleString('en-IN')}`} accent="blue" onClick={() => onNavigate('payments')} />
        <StatCard icon={<Clock size={18} />} label="Overdue" value={overdue.length} hint={overdue.length ? 'Past due date' : 'None overdue'} accent="red" onClick={() => onNavigate('payments')} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Recent movements */}
        <Panel title="Recent Stock Movements" icon={<TrendingUp size={16} />} action={<button onClick={() => onNavigate('material-entry')} className="text-xs text-emerald-400 hover:underline">View all</button>}>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <MiniStat icon={<ArrowDownToLine size={15} className="text-emerald-400" />} label="Received" value={recentIn} />
            <MiniStat icon={<ArrowUpFromLine size={15} className="text-amber-400" />} label="Issued" value={recentOut} />
          </div>
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">No movements yet</p>
          ) : (
            <div className="space-y-2">
              {recent.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-zinc-200">{m.item?.name ?? 'Unknown item'}</div>
                    <div className="text-xs text-zinc-500">
                      {m.type === 'in' ? `From ${m.vendor?.name ?? 'vendor'}` : `To ${m.issued_to ?? 'staff'}`} · {new Date(m.movement_date).toLocaleDateString('en-IN')}
                    </div>
                  </div>
                  <Badge color={m.type === 'in' ? 'emerald' : 'amber'}>
                    {m.type === 'in' ? '+' : '−'}
                    {m.quantity}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Low stock */}
        <Panel title="Low Stock Alerts" icon={<AlertTriangle size={16} />} action={<button onClick={() => onNavigate('live-stock')} className="text-xs text-emerald-400 hover:underline">View all</button>}>
          {lowStock.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">All items above reorder level</p>
          ) : (
            <div className="space-y-2">
              {lowStock.slice(0, 6).map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-zinc-200">{s.name}</div>
                    <div className="text-xs text-zinc-500">Reorder at {s.reorder_level} {s.unit}</div>
                  </div>
                  <Badge color="amber">{s.stock} {s.unit}</Badge>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Upcoming payments */}
        <Panel title="Upcoming & Overdue Payments" icon={<Wallet size={16} />} action={<button onClick={() => onNavigate('payments')} className="text-xs text-emerald-400 hover:underline">View all</button>}>
          {payments.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">No pending payments</p>
          ) : (
            <div className="space-y-2">
              {payments.slice(0, 6).map((p) => {
                const isOverdue = new Date(p.due_date) < new Date(new Date().toDateString());
                return (
                  <div key={p.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-zinc-200">{p.vendor?.name ?? 'Vendor'}</div>
                      <div className="text-xs text-zinc-500">{p.bill_number ? `${p.bill_number} · ` : ''}Due {new Date(p.due_date).toLocaleDateString('en-IN')}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-200">₹{Number(p.amount).toLocaleString('en-IN')}</span>
                      {isOverdue && <Badge color="red">Overdue</Badge>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {/* Quick actions */}
        <Panel title="Quick Actions" icon={<TrendingDown size={16} />}>
          <div className="grid grid-cols-2 gap-3">
            <QuickAction icon={<ArrowDownToLine size={18} />} label="Material Entry" onClick={() => onNavigate('material-entry')} />
            <QuickAction icon={<ArrowUpFromLine size={18} />} label="Material Issue" onClick={() => onNavigate('material-issue')} />
            <QuickAction icon={<Boxes size={18} />} label="Live Stock" onClick={() => onNavigate('live-stock')} />
            <QuickAction icon={<Wallet size={18} />} label="Payments" onClick={() => onNavigate('payments')} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, hint, accent, onClick }: { icon: React.ReactNode; label: string; value: number; hint: string; accent: 'emerald' | 'amber' | 'red' | 'blue'; onClick: () => void }) {
  const accents = {
    emerald: 'text-emerald-400 bg-emerald-500/10',
    amber: 'text-amber-400 bg-amber-500/10',
    red: 'text-red-400 bg-red-500/10',
    blue: 'text-blue-400 bg-blue-500/10',
  };
  return (
    <button onClick={onClick} className="group rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900">
      <div className={`mb-3 inline-flex rounded-lg p-2 ${accents[accent]}`}>{icon}</div>
      <div className="text-2xl font-semibold text-zinc-100">{value}</div>
      <div className="text-sm text-zinc-400">{label}</div>
      <div className="mt-1 text-xs text-zinc-500">{hint}</div>
    </button>
  );
}

function Panel({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
          <span className="text-zinc-500">{icon}</span>
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      {icon}
      <div>
        <div className="text-lg font-semibold text-zinc-100">{value}</div>
        <div className="text-xs text-zinc-500">{label}</div>
      </div>
    </div>
  );
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-4 text-sm text-zinc-300 transition-colors hover:border-emerald-600/40 hover:bg-emerald-600/5 hover:text-emerald-400"
    >
      {icon}
      {label}
    </button>
  );
}
