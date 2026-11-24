import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  Package,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Truck,
  Wallet,
  FileScan,
  Factory,
  Menu,
  X,
  AlertTriangle,
} from 'lucide-react';
import { PageKey } from '@/lib/types';
import { ToastContainer } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { Dashboard } from '@/pages/Dashboard';
import { ItemsPage } from '@/pages/ItemsPage';
import { MaterialEntryPage } from '@/pages/MaterialEntryPage';
import { MaterialIssuePage } from '@/pages/MaterialIssuePage';
import { LiveStockPage } from '@/pages/LiveStockPage';
import { VendorsPage } from '@/pages/VendorsPage';
import { PaymentsPage } from '@/pages/PaymentsPage';
import { BillsPage } from '@/pages/BillsPage';

interface NavItem {
  key: PageKey;
  label: string;
  icon: typeof LayoutDashboard;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    group: 'OVERVIEW',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { key: 'live-stock', label: 'Live Stock', icon: Boxes },
    ],
  },
  {
    group: 'TRANSACTIONS',
    items: [
      { key: 'material-entry', label: 'Material Entry', icon: ArrowDownToLine },
      { key: 'material-issue', label: 'Material Issue', icon: ArrowUpFromLine },
      { key: 'bills', label: 'Upload & Scan Bill', icon: FileScan },
    ],
  },
  {
    group: 'MASTERS',
    items: [
      { key: 'items', label: 'Items', icon: Package },
      { key: 'vendors', label: 'Vendors', icon: Truck },
    ],
  },
  {
    group: 'ACCOUNTS',
    items: [
      { key: 'payments', label: 'Payments Due', icon: Wallet },
    ],
  },
];

const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export default function App() {
  const [page, setPage] = useState<PageKey>('bills');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lowStockCount, setLowStockCount] = useState<number>(0);
  const [payableTotal, setPayableTotal] = useState<number>(0);

  const refreshHeaderStats = useCallback(async () => {
    try {
      const [sRes, pRes] = await Promise.all([
        supabase.from('live_stock').select('*'),
        supabase.from('payments').select('amount').eq('paid', false),
      ]);
      if (sRes.data) {
        const low = (sRes.data as any[]).filter((s) => s.is_low_stock);
        setLowStockCount(low.length);
      }
      if (pRes.data) {
        const total = (pRes.data as any[]).reduce((sum, p) => sum + Number(p.amount || 0), 0);
        setPayableTotal(total);
      }
    } catch (e) {
      console.warn('Failed to refresh header stats:', e);
    }
  }, []);

  useEffect(() => {
    refreshHeaderStats();
    const interval = setInterval(refreshHeaderStats, 10000);
    return () => clearInterval(interval);
  }, [refreshHeaderStats]);

  const navigate = (k: PageKey) => {
    setPage(k);
    setMobileOpen(false);
    refreshHeaderStats();
  };

  const current = ALL_NAV_ITEMS.find((n) => n.key === page) || ALL_NAV_ITEMS[0];
  const currentDateFormatted = new Date().toLocaleDateString('en-GB');

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <ToastContainer />
      {/* Sidebar - desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-zinc-800/80 bg-zinc-900/60 backdrop-blur lg:flex">
        <SidebarContent current={page} onNavigate={navigate} />
      </aside>

      {/* Sidebar - mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-zinc-800 bg-zinc-900">
            <SidebarContent current={page} onNavigate={navigate} onClose={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="lg:pl-60">
        {/* Top bar matching reference screenshot */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-zinc-800/80 bg-zinc-950/80 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 lg:hidden"
            >
              <Menu size={20} />
            </button>
            <current.icon size={18} className="text-amber-500" />
            <span className="font-semibold text-zinc-100">{current.label}</span>
          </div>

          {/* Right Header Status Pills */}
          <div className="flex items-center gap-2.5">
            {/* Live date badge */}
            <div className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-xs text-zinc-400">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              <span>{currentDateFormatted}</span>
            </div>

            {/* Low stock badge */}
            <button
              onClick={() => navigate('live-stock')}
              className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400 hover:bg-amber-500/20 transition-colors"
              title="Click to view low stock items"
            >
              <AlertTriangle size={13} />
              <span>{lowStockCount} low stock</span>
            </button>

            {/* Total payable badge */}
            <button
              onClick={() => navigate('payments')}
              className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-300 hover:border-zinc-700 hover:text-zinc-100 transition-colors"
              title="Click to view pending payments"
            >
              <span className="font-mono">₹ {payableTotal.toLocaleString('en-IN')} payable</span>
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          {page === 'dashboard' && <Dashboard onNavigate={navigate} />}
          {page === 'items' && <ItemsPage />}
          {page === 'material-entry' && <MaterialEntryPage />}
          {page === 'material-issue' && <MaterialIssuePage />}
          {page === 'live-stock' && <LiveStockPage />}
          {page === 'vendors' && <VendorsPage />}
          {page === 'payments' && <PaymentsPage />}
          {page === 'bills' && <BillsPage />}
        </main>
      </div>
    </div>
  );
}

interface SidebarContentProps {
  current: PageKey;
  onNavigate: (k: PageKey) => void;
  onClose?: () => void;
}

function SidebarContent({ current, onNavigate, onClose }: SidebarContentProps) {
  return (
    <div className="flex h-full flex-col justify-between">
      <div>
        {/* Brand header */}
        <div className="flex h-14 items-center gap-2.5 border-b border-zinc-800/80 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-600 text-white font-bold shadow-md shadow-orange-600/20">
            <Factory size={18} />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight text-zinc-100">BT_inventory</div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-orange-400">INVENTORY OS</div>
          </div>
          <button
            type="button"
            onClick={onClose || (() => onNavigate('dashboard'))}
            className="ml-auto rounded-lg p-1 text-zinc-500 hover:text-zinc-100 lg:hidden cursor-pointer"
            title="Close menu"
          >
            <X size={16} />
          </button>
        </div>

        {/* Categorized Navigation */}
        <nav className="space-y-4 overflow-y-auto p-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.group} className="space-y-1">
              <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                {group.group}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = current === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => onNavigate(item.key)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                        active
                          ? 'bg-amber-500/15 text-amber-400 font-semibold'
                          : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200'
                      }`}
                    >
                      <Icon size={16} className={active ? 'text-amber-400' : 'text-zinc-500'} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* Bottom Action Section matching reference screenshot */}
      <div className="border-t border-zinc-800/80 p-3 space-y-2 bg-zinc-950/40">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onNavigate('material-entry')}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <ArrowDownToLine size={13} className="text-emerald-400" />
            Entry
          </button>
          <button
            onClick={() => onNavigate('material-issue')}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <ArrowUpFromLine size={13} className="text-amber-400" />
            Issue
          </button>
        </div>

        <button
          onClick={() => onNavigate('bills')}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 hover:bg-orange-600 px-3 py-2 text-xs font-bold text-zinc-950 shadow-md shadow-orange-500/20 transition-all cursor-pointer"
        >
          <FileScan size={15} />
          Scan vendor bill
        </button>
      </div>
    </div>
  );
}
